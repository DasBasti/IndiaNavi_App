import assert from 'node:assert/strict';
import test from 'node:test';

import { updateFirmwareOverBle } from './firmware_update.js';
import {
  OTA_ACK_INTERVAL,
  OTA_CMD_ABORT,
  OTA_CMD_FINISH,
  OTA_CMD_RESTART,
  OTA_CMD_START,
  OTA_ERROR,
  OTA_STATE,
  OTA_WINDOW,
} from './protocol.js';

// Behaves like src/esp32/ble_ota.c: the chunks go into a buffer of 2 * OTA_WINDOW bytes, a task writes them to
// flash in pieces of OTA_ACK_INTERVAL bytes and reports the offset. A rest that is smaller is written when
// nothing else arrives.
class FakeDevice {
  constructor({ battery = true, flashDelay = 1, state = OTA_STATE.IDLE } = {}) {
    this.state = state;
    this.error = OTA_ERROR.NONE;
    this.batteryOk = battery;
    this.flashDelay = flashDelay;
    this.total = 0;
    this.flash = [];
    this.pending = [];
    this.received = 0;
    this.maxBuffered = 0;
    this.restarted = false;
    this.aborted = 0;
    this.finishes = 0;
    this.listeners = new Set();
    this.timer = null;
  }

  get flashed() {
    return this.flash.length;
  }

  status() {
    return { state: this.state, error: this.error, offset: this.flashed };
  }

  notify() {
    const status = this.status();
    setImmediate(() => [...this.listeners].forEach((listener) => listener(status)));
  }

  fail(error) {
    this.state = OTA_STATE.ERROR;
    this.error = error;
    this.pending = [];
    clearTimeout(this.timer);
    this.notify();
  }

  // the task of the device
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const buffered = this.pending.length;
      if (buffered === 0) {
        return;
      }
      // a full piece, or the rest when nothing arrived for a while
      const piece = this.pending.splice(0, OTA_ACK_INTERVAL);
      this.flash.push(...piece);
      this.state = OTA_STATE.RECEIVING;
      this.notify();
      this.schedule();
    }, this.flashDelay);
  }

  transport() {
    return {
      readStatus: async () => this.status(),
      onStatus: (listener) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
      writeControl: async (bytes) => {
        const command = bytes[0];
        if (command === OTA_CMD_START) {
          if (this.state === OTA_STATE.READY || this.state === OTA_STATE.RECEIVING) {
            throw new Error('Value not allowed');
          }
          if (!this.batteryOk) {
            return this.fail(OTA_ERROR.BATTERY);
          }
          this.total = new DataView(bytes.buffer, bytes.byteOffset).getUint32(1, true);
          this.flash = [];
          this.pending = [];
          this.received = 0;
          this.error = OTA_ERROR.NONE;
          this.state = OTA_STATE.READY;
          this.notify();
        } else if (command === OTA_CMD_ABORT) {
          this.aborted++;
          this.pending = [];
          this.state = OTA_STATE.IDLE;
          this.error = OTA_ERROR.ABORTED;
          this.notify();
        } else if (command === OTA_CMD_FINISH) {
          this.finishes++;
          if (this.flashed !== this.total) {
            return this.fail(OTA_ERROR.SEQUENCE);
          }
          this.state = OTA_STATE.VERIFYING;
          this.notify();
          setTimeout(() => {
            this.state = OTA_STATE.DONE;
            this.notify();
          }, 5);
        } else if (command === OTA_CMD_RESTART) {
          if (this.state !== OTA_STATE.DONE) {
            throw new Error('Value not allowed');
          }
          this.restarted = true;
        }
      },
      writeData: async (bytes) => {
        if (this.state !== OTA_STATE.READY && this.state !== OTA_STATE.RECEIVING) {
          return;
        }
        if (this.received + bytes.length > this.total) {
          return this.fail(OTA_ERROR.SEQUENCE);
        }
        this.pending.push(...bytes);
        this.received += bytes.length;
        this.maxBuffered = Math.max(this.maxBuffered, this.pending.length);
        if (this.pending.length > 2 * OTA_WINDOW) {
          return this.fail(OTA_ERROR.OVERFLOW);
        }
        this.schedule();
      },
    };
  }
}

const image = (length) => Uint8Array.from({ length }, (_, i) => (i * 7 + 3) & 0xff);

test('the image arrives complete and the device restarts', async () => {
  const device = new FakeDevice();
  const data = image(100000);
  const progress = [];
  await updateFirmwareOverBle(device.transport(), data, { mtu: 247, onProgress: (p) => progress.push(p) });

  assert.deepEqual(Uint8Array.from(device.flash), data);
  assert.equal(device.restarted, true);
  assert.equal(device.finishes, 1);
  assert.equal(device.state, OTA_STATE.DONE);

  const sending = progress.filter((p) => p.phase === 'sending').map((p) => p.done);
  assert.deepEqual(sending, [...sending].sort((a, b) => a - b), 'progress never goes back');
  assert.equal(sending.at(-1), data.length);
  assert.deepEqual(progress.slice(-2).map((p) => p.phase), ['verifying', 'restarting']);
});

test('the phone never sends more than the window beyond the report of the device', async () => {
  // a slow flash writes 4 KiB per 3 ms, the link would deliver much more
  const device = new FakeDevice({ flashDelay: 3 });
  await updateFirmwareOverBle(device.transport(), image(200000), { mtu: 247 });
  assert.ok(device.maxBuffered <= OTA_WINDOW, `buffered ${device.maxBuffered} bytes`);
  assert.equal(device.flashed, 200000);
});

test('a size that is no multiple of the chunk or the report interval works', async () => {
  for (const size of [1, 243, 244, 245, 4095, 4096, 4097, 8192, 12345]) {
    const device = new FakeDevice();
    const data = image(size);
    await updateFirmwareOverBle(device.transport(), data, { mtu: 247 });
    assert.deepEqual(Uint8Array.from(device.flash), data, `size ${size}`);
    assert.equal(device.restarted, true, `size ${size}`);
  }
});

test('the smallest accepted MTU works', async () => {
  const device = new FakeDevice();
  const data = image(30000);
  await updateFirmwareOverBle(device.transport(), data, { mtu: 185 });
  assert.deepEqual(Uint8Array.from(device.flash), data);
});

test('a link that is too slow is refused before anything is sent', async () => {
  const device = new FakeDevice();
  await assert.rejects(updateFirmwareOverBle(device.transport(), image(1000), { mtu: 23 }), /too slow/);
  assert.equal(device.state, OTA_STATE.IDLE);
});

test('an error of the device ends the update with its reason', async () => {
  const device = new FakeDevice({ battery: false });
  await assert.rejects(updateFirmwareOverBle(device.transport(), image(5000), { mtu: 247 }), /battery/);
  assert.equal(device.restarted, false);
});

test('an update that was stopped on the device side is reported', async () => {
  const device = new FakeDevice({ flashDelay: 5 });
  const transport = device.transport();
  const writeData = transport.writeData;
  let calls = 0;
  transport.writeData = async (bytes) => {
    await writeData(bytes);
    if (++calls === 30) {
      device.fail(OTA_ERROR.TIMEOUT);
    }
  };
  await assert.rejects(updateFirmwareOverBle(transport, image(100000), { mtu: 247 }), /no data for too long/);
  assert.equal(device.restarted, false);
});

test('cancelling tells the device to abort', async () => {
  const device = new FakeDevice({ flashDelay: 5 });
  const controller = new AbortController();
  const done = updateFirmwareOverBle(device.transport(), image(200000), {
    mtu: 247,
    signal: controller.signal,
    onProgress: ({ done: bytes }) => {
      if (bytes > 20000) {
        controller.abort();
      }
    },
  });
  await assert.rejects(done, /cancelled/);
  assert.equal(device.aborted, 1);
  assert.equal(device.state, OTA_STATE.IDLE);
  assert.equal(device.restarted, false);
});

test('an update of an earlier try is aborted first', async () => {
  const device = new FakeDevice({ state: OTA_STATE.RECEIVING });
  const data = image(20000);
  await updateFirmwareOverBle(device.transport(), data, { mtu: 247 });
  assert.equal(device.aborted, 1);
  assert.deepEqual(Uint8Array.from(device.flash), data);
  assert.equal(device.restarted, true);
});

test('a firmware that is already stored only needs the restart', async () => {
  const device = new FakeDevice({ state: OTA_STATE.DONE });
  const progress = [];
  await updateFirmwareOverBle(device.transport(), image(20000), { mtu: 247, onProgress: (p) => progress.push(p.phase) });
  assert.equal(device.restarted, true);
  assert.equal(device.aborted, 0);
  assert.deepEqual(progress, ['restarting']);
});

test('a write that fails ends the update', async () => {
  const device = new FakeDevice();
  const transport = device.transport();
  let calls = 0;
  const writeData = transport.writeData;
  transport.writeData = async (bytes) => {
    if (++calls === 10) {
      throw new Error('Bluetooth write failed');
    }
    return writeData(bytes);
  };
  await assert.rejects(updateFirmwareOverBle(transport, image(100000), { mtu: 247 }), /Bluetooth write failed/);
  assert.equal(device.restarted, false);
});

test('a device that never answers ends the update with a message', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const transport = {
    readStatus: async () => ({ state: OTA_STATE.IDLE, error: 0, offset: 0 }),
    onStatus: () => () => { },
    writeControl: async () => { },
    writeData: async () => { },
  };
  const result = updateFirmwareOverBle(transport, image(1000), { mtu: 247 });
  // let the update reach the wait for READY, then pass the time
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(20000);
  await assert.rejects(result, /did not answer while starting the update/);
});
