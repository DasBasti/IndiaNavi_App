// Firmware update of the IndiaNavi over Bluetooth, see docs/ble_api.md.
// The device writes the image to flash and tells how many bytes it has stored. The phone never sends more than
// OTA_WINDOW bytes beyond that, because the device can not store faster than the link delivers.

import {
  OTA_CMD_ABORT,
  OTA_CMD_FINISH,
  OTA_CMD_RESTART,
  OTA_MIN_MTU,
  OTA_STATE,
  OTA_WINDOW,
  describeOtaError,
  encodeOtaCommand,
  encodeOtaStart,
  otaChunkSize,
} from './protocol.js';

// answers of the device
const START_TIMEOUT = 15000;
const ACK_TIMEOUT = 30000;
// the device checks the whole image, that takes some seconds
const FINISH_TIMEOUT = 60000;
const ABORT_TIMEOUT = 5000;
// requests to the Bluetooth library that are on their way at the same time
const WRITES_IN_FLIGHT = 6;

const cancelled = () => new Error('cancelled');

// Keeps the last status of the device and lets the update wait for the next one
const statusWaiter = (transport, signal) => {
  let latest = null;
  const listeners = new Set();
  const unsubscribe = transport.onStatus((status) => {
    latest = status;
    [...listeners].forEach((listener) => listener(status));
  });

  return {
    latest: () => latest,
    reset: () => {
      latest = null;
    },
    close: unsubscribe,
    // Resolves with the first status that matches. A status with an error rejects.
    wait: (matches, timeout, what) =>
      new Promise((resolve, reject) => {
        const finish = (callback, value) => {
          clearTimeout(timer);
          listeners.delete(listener);
          signal?.removeEventListener('abort', onAbort);
          callback(value);
        };
        const listener = (status) => {
          if (status.state === OTA_STATE.ERROR) {
            finish(reject, new Error(describeOtaError(status.error)));
          } else if (matches(status)) {
            finish(resolve, status);
          }
        };
        const onAbort = () => finish(reject, cancelled());
        const timer = setTimeout(() => finish(reject, new Error(`The IndiaNavi did not answer while ${what}`)), timeout);
        if (signal?.aborted) {
          return onAbort();
        }
        signal?.addEventListener('abort', onAbort);
        listeners.add(listener);
        if (latest) {
          listener(latest);
        }
      }),
  };
};

// Sends the image (Uint8Array) to the device and restarts it with the new firmware.
// transport: { writeControl(bytes), writeData(bytes), readStatus(), onStatus(listener) -> unsubscribe }
// mtu is the negotiated MTU of the link.
// onProgress gets { phase: 'sending' | 'verifying' | 'restarting', done, total } in bytes of the image.
export const updateFirmwareOverBle = async (transport, image, { mtu, signal, onProgress } = {}) => {
  if (mtu < OTA_MIN_MTU) {
    throw new Error('The Bluetooth link is too slow for an update, move closer to the IndiaNavi and try again');
  }
  const total = image.length;
  const chunk = otaChunkSize(mtu);
  const waiter = statusWaiter(transport, signal);
  // a chunk that could not be sent
  let writeError = null;
  const throwIfStopped = () => {
    if (signal?.aborted) {
      throw cancelled();
    }
    if (writeError) {
      throw writeError;
    }
    if (waiter.latest()?.state === OTA_STATE.ERROR) {
      throw new Error(describeOtaError(waiter.latest().error));
    }
  };

  try {
    // an update that is still known to the device from an earlier try
    const current = await transport.readStatus();
    if (current.state === OTA_STATE.DONE) {
      // the new firmware is already stored, it only needs the restart
      onProgress?.({ phase: 'restarting', done: total, total });
      await transport.writeControl(encodeOtaCommand(OTA_CMD_RESTART)).catch(() => { });
      return;
    }
    if ([OTA_STATE.READY, OTA_STATE.RECEIVING, OTA_STATE.VERIFYING].includes(current.state)) {
      await transport.writeControl(encodeOtaCommand(OTA_CMD_ABORT));
      await waiter.wait((status) => status.state === OTA_STATE.IDLE, ABORT_TIMEOUT, 'stopping the earlier update');
    }

    waiter.reset();
    await transport.writeControl(encodeOtaStart(total));
    await waiter.wait((status) => status.state === OTA_STATE.READY, START_TIMEOUT, 'starting the update');

    let sent = 0;
    let acknowledged = 0;
    const inFlight = new Set();
    waiter.reset();
    const unsubscribe = transport.onStatus((status) => {
      if (status.state === OTA_STATE.RECEIVING && status.offset > acknowledged) {
        acknowledged = status.offset;
        onProgress?.({ phase: 'sending', done: acknowledged, total });
      }
    });

    try {
      onProgress?.({ phase: 'sending', done: 0, total });
      while (sent < total) {
        throwIfStopped();
        const length = Math.min(chunk, total - sent);
        if (sent + length - acknowledged > OTA_WINDOW) {
          // the device has to store what it got, wait for its report
          const before = acknowledged;
          await waiter.wait((status) => status.offset > before, ACK_TIMEOUT, 'storing the firmware');
          continue;
        }
        const write = transport.writeData(image.subarray(sent, sent + length));
        inFlight.add(write);
        write.then(
          () => inFlight.delete(write),
          (error) => {
            writeError ??= error;
            inFlight.delete(write);
          }
        );
        sent += length;
        if (inFlight.size >= WRITES_IN_FLIGHT) {
          await Promise.race(inFlight);
        }
      }
      await Promise.all(inFlight);

      while (acknowledged < total) {
        throwIfStopped();
        const before = acknowledged;
        await waiter.wait((status) => status.offset > before, ACK_TIMEOUT, 'storing the firmware');
      }
    } finally {
      unsubscribe();
    }

    onProgress?.({ phase: 'verifying', done: total, total });
    waiter.reset();
    await transport.writeControl(encodeOtaCommand(OTA_CMD_FINISH));
    await waiter.wait((status) => status.state === OTA_STATE.DONE, FINISH_TIMEOUT, 'checking the firmware');

    onProgress?.({ phase: 'restarting', done: total, total });
    // the device restarts right after it accepted the command, the link may break before the answer arrives
    await transport.writeControl(encodeOtaCommand(OTA_CMD_RESTART)).catch(() => { });
  } catch (error) {
    if (signal?.aborted) {
      // tell the device, it removes the progress from its display
      await transport.writeControl(encodeOtaCommand(OTA_CMD_ABORT)).catch(() => { });
    }
    throw error;
  } finally {
    waiter.close();
  }
};
