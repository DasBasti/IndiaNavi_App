import assert from 'node:assert/strict';
import test from 'node:test';

import { createAutoConnect } from './auto_connect.js';

const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

const POSITION = { latitude: 49.1, longitude: 7.7, altitude: 300, accuracy: 50, timestamp: 1800000000 };

class FakeConnection {
  constructor(id, onDisconnected) {
    this.id = id;
    this.onDisconnected = onDisconnected;
    this.calls = [];
  }
  async syncTime() {
    this.calls.push('time');
  }
  async sendPosition(position) {
    this.calls.push(['position', position]);
  }
  async disconnect() {
    this.calls.push('disconnect');
  }
}

const setup = (t, { visible = true, position = POSITION, connectError = null } = {}) => {
  const env = { visible, connections: [], scans: 0, connectError, position };
  const auto = createAutoConnect({
    waitForDevice: async (id, { signal, timeout }) => {
      env.scans += 1;
      if (env.visible) {
        return true;
      }
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), timeout);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve(false);
        });
      });
    },
    connect: async (id, { onDisconnected }) => {
      if (env.connectError) {
        throw env.connectError;
      }
      const connection = new FakeConnection(id, onDisconnected);
      env.connections.push(connection);
      return connection;
    },
    getPosition: async () => {
      if (!env.position) {
        throw new Error('no permission');
      }
      return env.position;
    },
    scanTimeout: 50,
    scanPause: 10,
    reconnectDelay: 5,
  });
  t.after(() => {
    auto.setDevice(undefined);
    auto.setActive(false);
  });
  return { auto, env };
};

test('connects to the remembered device when it is visible and sends time and position', async (t) => {
  const { auto, env } = setup(t);
  auto.setDevice({ id: 'AA', name: 'IndiaNavi-1234' });
  await wait();
  assert.equal(env.connections.length, 1);
  assert.deepEqual(env.connections[0].calls, ['time', ['position', POSITION]]);
  assert.equal(auto.getState().state, 'connected');
  assert.deepEqual(auto.getState().sent, { time: true, position: true });
});

test('does nothing without a remembered device', async (t) => {
  const { auto, env } = setup(t);
  await wait();
  assert.equal(env.scans, 0);
  assert.equal(auto.getState().state, 'idle');
});

test('still sets the time when the position is not available', async (t) => {
  const { auto, env } = setup(t, { position: null });
  auto.setDevice({ id: 'AA' });
  await wait();
  assert.deepEqual(env.connections[0].calls, ['time']);
  assert.deepEqual(auto.getState().sent, { time: true, position: false });
});

test('waits for the device to show up', async (t) => {
  const { auto, env } = setup(t, { visible: false });
  auto.setDevice({ id: 'AA' });
  await wait();
  assert.equal(env.connections.length, 0);
  assert.equal(auto.getState().state, 'searching');
  env.visible = true;
  await wait(150);
  assert.equal(env.connections.length, 1);
});

test('connects again after the connection is lost', async (t) => {
  const { auto, env } = setup(t);
  auto.setDevice({ id: 'AA' });
  await wait();
  env.connections[0].onDisconnected();
  await wait();
  assert.equal(env.connections.length, 2);
  assert.deepEqual(env.connections[1].calls, ['time', ['position', POSITION]]);
});

test('gives up after repeated failures and tries again when the app comes back', async (t) => {
  const { auto, env } = setup(t, { connectError: new Error('refused') });
  auto.setDevice({ id: 'AA' });
  await wait(600);
  const scans = env.scans;
  assert.equal(scans, 5);
  await wait(100);
  assert.equal(env.scans, scans);
  env.connectError = null;
  auto.setActive(false);
  auto.setActive(true);
  await wait();
  assert.equal(env.connections.length, 1);
});

test('does not scan while the app is in the background or paused', async (t) => {
  const { auto, env } = setup(t, { visible: false });
  auto.setActive(false);
  auto.setDevice({ id: 'AA' });
  await wait();
  assert.equal(env.scans, 0);
  auto.setActive(true);
  await wait();
  assert.equal(env.scans, 1);
  const resume = auto.pause();
  const scans = env.scans;
  await wait(100);
  assert.equal(env.scans, scans);
  resume();
  await wait();
  assert.equal(env.scans, scans + 1);
});

test('connectNow reuses the background connection', async (t) => {
  const { auto, env } = setup(t);
  auto.setDevice({ id: 'AA' });
  await wait();
  const connection = await auto.connectNow({ id: 'AA' });
  assert.equal(connection, env.connections[0]);
  assert.equal(env.connections.length, 1);
});

test('connectNow connects to a device that is not remembered', async (t) => {
  const { auto, env } = setup(t, { visible: false });
  const connection = await auto.connectNow({ id: 'BB' });
  assert.equal(connection.id, 'BB');
  assert.deepEqual(connection.calls, ['time', ['position', POSITION]]);
  assert.equal(env.connections.length, 1);
});

test('forgetting the device disconnects', async (t) => {
  const { auto, env } = setup(t);
  auto.setDevice({ id: 'AA' });
  await wait();
  auto.setDevice(undefined);
  assert.deepEqual(env.connections[0].calls.at(-1), 'disconnect');
  assert.equal(auto.getState().connection, null);
  await wait(50);
  assert.equal(env.connections.length, 1);
});

test('tells the listeners about the connection', async (t) => {
  const { auto } = setup(t);
  const states = [];
  auto.subscribe(({ state }) => states.push(state));
  auto.setDevice({ id: 'AA' });
  await wait();
  assert.deepEqual([...new Set(states)], ['searching', 'connecting', 'connected']);
});
