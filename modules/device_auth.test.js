import assert from 'node:assert/strict';
import test from 'node:test';

import { authHeaders, setDeviceToken } from './device_auth.js';

test('changes carry the password of the access point as token', () => {
  const base = 'http://indianavi.local';
  assert.deepEqual(authHeaders(base, 'PUT'), {});
  setDeviceToken(base, 'abc123def456');
  for (const method of ['PUT', 'POST', 'DELETE']) {
    assert.deepEqual(authHeaders(base, method), { Authorization: 'Bearer abc123def456' });
  }
  // reading needs none, and the token is not sent to other devices
  assert.deepEqual(authHeaders(base, 'GET'), {});
  assert.deepEqual(authHeaders('http://192.168.4.1', 'PUT'), {});
  setDeviceToken(base, '');
  assert.deepEqual(authHeaders(base, 'PUT'), {});
});
