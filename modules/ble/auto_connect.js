// Keeps the connection to the remembered IndiaNavi in the background: looks for it, connects as soon as it is visible
// and sends the time and the position of the phone, so the GPS module of the device finds the satellites fast.
// The Bluetooth screen uses the same connection (the device allows only one). The Bluetooth parts are passed in, so
// this works (and is tested) without native code.
//
//   waitForDevice(id, { signal, timeout }) -> true when the device was seen, false after the timeout or when
//                                             Bluetooth is not ready
//   connect(id, { onDisconnected, quiet }) -> connection with syncTime() and sendPosition()
//   getPosition({ ask })                   -> position of the phone

const SCAN_TIMEOUT = 10000;
const SCAN_PAUSE = 20000;
const RECONNECT_DELAY = 2000;
const MAX_DELAY = 5 * 60000;
// A device that is seen but cannot be connected (for example the pairing is lost on one side) is not tried forever:
// every try can show a pairing dialog of Android.
const MAX_FAILURES = 5;

export const createAutoConnect = ({
  waitForDevice,
  connect,
  getPosition,
  scanTimeout = SCAN_TIMEOUT,
  scanPause = SCAN_PAUSE,
  reconnectDelay = RECONNECT_DELAY,
}) => {
  let device = null;
  let active = true;
  let paused = 0;
  let connection = null;
  let busy = false;
  let manual = 0;
  let pending = null;
  let timer = null;
  let abort = null;
  let failures = 0;
  // 'idle', 'searching', 'connecting' or 'connected'
  let state = 'idle';
  // what the greeting after the last connect achieved
  let sent = { time: false, position: false };
  const listeners = new Set();

  const emit = () => listeners.forEach((listener) => listener(snapshot()));
  const snapshot = () => ({ state, connection, sent });
  const setState = (next) => {
    if (state !== next) {
      state = next;
      emit();
    }
  };

  const canRun = () => device !== null && active && paused === 0 && connection === null && !busy && manual === 0;

  const schedule = (delay) => {
    clearTimeout(timer);
    timer = null;
    if (canRun() && failures < MAX_FAILURES) {
      timer = setTimeout(tick, delay);
    }
  };

  const lost = (lostConnection) => {
    if (connection !== lostConnection) {
      return;
    }
    connection = null;
    sent = { time: false, position: false };
    setState('idle');
    schedule(reconnectDelay);
  };

  // Time first, it is a short write. The position was asked for while connecting, it often is there already.
  const greet = async (connected, position) => {
    const result = { time: false, position: false };
    try {
      await connected.syncTime();
      result.time = true;
    } catch {
      // the user can send it again
    }
    try {
      const phonePosition = await position;
      if (phonePosition) {
        await connected.sendPosition(phonePosition);
        result.position = true;
      }
    } catch {
      // without location permission or fix there is nothing to send
    }
    return result;
  };

  const attempt = (target, quiet) => {
    const run = async () => {
      setState('connecting');
      // the position is looked for while the connection is built up
      const position = getPosition({ ask: !quiet }).catch(() => null);
      let connected;
      try {
        connected = await connect(target.id, { quiet, onDisconnected: () => lost(connected) });
      } catch (error) {
        setState('idle');
        throw error;
      }
      failures = 0;
      connection = connected;
      sent = { time: false, position: false };
      setState('connected');
      sent = await greet(connected, position);
      if (connection === connected) {
        emit();
      }
      return connected;
    };
    pending = run().finally(() => {
      pending = null;
    });
    return pending;
  };

  const tick = async () => {
    timer = null;
    if (!canRun() || failures >= MAX_FAILURES) {
      return;
    }
    busy = true;
    const controller = new AbortController();
    abort = controller;
    const target = device;
    let delay = scanPause;
    try {
      setState('searching');
      const seen = await waitForDevice(target.id, { signal: controller.signal, timeout: scanTimeout });
      if (seen && !controller.signal.aborted && device === target) {
        try {
          await attempt(target, true);
        } catch {
          failures += 1;
          delay = Math.min(scanPause * 2 ** failures, MAX_DELAY);
        }
      }
    } catch {
      // the scan failed, try again later
    } finally {
      busy = false;
      if (abort === controller) {
        abort = null;
      }
      if (state === 'searching') {
        setState('idle');
      }
    }
    schedule(delay);
  };

  // stops the running scan, a waiting attempt goes on
  const stopScan = () => abort?.abort();

  return {
    // { id, name } of the remembered device, undefined to stop
    setDevice(next) {
      if (device?.id === next?.id) {
        device = next ?? null;
        return;
      }
      device = next ?? null;
      failures = 0;
      stopScan();
      if (connection && connection.id !== device?.id) {
        const old = connection;
        connection = null;
        old.disconnect();
        sent = { time: false, position: false };
        setState('idle');
      }
      schedule(0);
    },

    // false while the app is not in the foreground: no scanning then, a connection stays
    setActive(value) {
      active = value;
      if (value) {
        failures = 0;
        schedule(0);
      } else {
        stopScan();
        clearTimeout(timer);
        timer = null;
      }
    },

    // the screen scans for devices itself, Android allows one scan at a time
    pause() {
      paused += 1;
      stopScan();
      clearTimeout(timer);
      timer = null;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          paused -= 1;
          schedule(0);
        }
      };
    },

    // Connects now with the dialogs the user needs (permissions, pairing code), also to a device that is not
    // remembered yet. Resolves with the connection.
    async connectNow(target) {
      manual += 1;
      try {
        stopScan();
        clearTimeout(timer);
        timer = null;
        if (pending) {
          await pending.catch(() => { });
        }
        if (connection?.id === target.id) {
          return connection;
        }
        if (connection) {
          const old = connection;
          connection = null;
          await old.disconnect();
        }
        failures = 0;
        return await attempt(target, false);
      } finally {
        manual -= 1;
        schedule(scanPause);
      }
    },

    async disconnect() {
      const old = connection;
      connection = null;
      if (old) {
        sent = { time: false, position: false };
        setState('idle');
        await old.disconnect();
      }
      // the user wants it disconnected: not before the next start of the app or the next connect
      failures = MAX_FAILURES;
    },

    getState: snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
