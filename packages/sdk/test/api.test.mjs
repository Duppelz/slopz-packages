import assert from 'node:assert/strict'
import test from 'node:test'

import { SlopzApiClient, SlopzSdkError } from '../dist/index.js'

test('API client normalizes its base URL and sends JSON envelopes', async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (input, init) => {
    request = { input, init }
    return new Response(JSON.stringify({
      ok: true,
      challengeId: 'challenge_123',
      message: 'Sign in to Slopz',
      expiresAt: 123456,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    const client = new SlopzApiClient('https://api.slopz.fun/')
    const challenge = await client.createChallenge({
      profileAddress: '0x1234',
      purpose: 'game',
      gameId: 'game_123',
      origin: 'https://game.example',
    })

    assert.equal(client.baseUrl, 'https://api.slopz.fun')
    assert.equal(request.input, 'https://api.slopz.fun/auth/challenge')
    assert.equal(request.init.method, 'POST')
    assert.deepEqual(JSON.parse(request.init.body), {
      profileAddress: '0x1234',
      purpose: 'game',
      gameId: 'game_123',
      origin: 'https://game.example',
    })
    assert.deepEqual(challenge, {
      ok: true,
      challengeId: 'challenge_123',
      message: 'Sign in to Slopz',
      expiresAt: 123456,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('API failures retain the server error code', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(
    JSON.stringify({ ok: false, error: 'CHALLENGE_REJECTED' }),
    { status: 403, headers: { 'Content-Type': 'application/json' } },
  )

  try {
    const client = new SlopzApiClient('https://api.slopz.fun')
    await assert.rejects(
      client.createChallenge({
        profileAddress: '0x1234',
        purpose: 'platform',
        origin: 'https://slopz.fun',
      }),
      (error) => error instanceof SlopzSdkError && error.code === 'CHALLENGE_REJECTED',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('malformed API responses fail closed', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('not-json', { status: 200 })

  try {
    const client = new SlopzApiClient('https://api.slopz.fun')
    await assert.rejects(
      client.listPublishedGames(),
      (error) => error instanceof SlopzSdkError && error.code === 'INVALID_API_RESPONSE',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
