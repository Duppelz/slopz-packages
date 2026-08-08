import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SLOPZ_PROTOCOL_VERSION,
  isHostRequest,
  isReadyMessage,
} from '../dist/protocol.js'

test('ready messages require the exact protocol identity and version', () => {
  const ready = {
    source: 'slopz-game',
    type: 'slopz:ready',
    version: SLOPZ_PROTOCOL_VERSION,
    gameId: 'game_123',
    nonce: 'nonce_123',
  }

  assert.equal(isReadyMessage(ready), true)
  assert.equal(isReadyMessage({ ...ready, source: 'other-game' }), false)
  assert.equal(isReadyMessage({ ...ready, version: '2.0.0' }), false)
  assert.equal(isReadyMessage({ ...ready, nonce: 123 }), false)
  assert.equal(isReadyMessage(null), false)
})

test('host requests accept only supported methods and object payloads', () => {
  const request = {
    type: 'slopz:request',
    requestId: 'request_123',
    method: 'get-player',
    payload: {},
  }

  assert.equal(isHostRequest(request), true)
  assert.equal(isHostRequest({ ...request, method: 'developer-admin' }), false)
  assert.equal(isHostRequest({ ...request, payload: [] }), false)
  assert.equal(isHostRequest({ ...request, requestId: 123 }), false)
  assert.equal(isHostRequest(undefined), false)
})
