import assert from 'node:assert/strict'
import test from 'node:test'

import { SlopzGameClient, SlopzSdkError } from '../dist/index.js'
import { SlopzHostBroker } from '../dist/host.js'

const nativeSetInterval = globalThis.setInterval.bind(globalThis)
const nativeClearInterval = globalThis.clearInterval.bind(globalThis)
const nativeSetTimeout = globalThis.setTimeout.bind(globalThis)
const nativeClearTimeout = globalThis.clearTimeout.bind(globalThis)

class FixtureWindow extends EventTarget {
  constructor(href) {
    super()
    this.location = { href }
    this.parent = this
  }

  setInterval(handler, delay) {
    return nativeSetInterval(handler, delay)
  }

  clearInterval(handle) {
    nativeClearInterval(handle)
  }

  setTimeout(handler, delay) {
    return nativeSetTimeout(handler, delay)
  }

  clearTimeout(handle) {
    nativeClearTimeout(handle)
  }
}

function deliverMessage(target, { data, origin, source, ports = [] }) {
  queueMicrotask(() => {
    globalThis.window = target
    const event = new Event('message')
    Object.defineProperties(event, {
      data: { value: data },
      origin: { value: origin },
      source: { value: source },
      ports: { value: ports },
    })
    target.dispatchEvent(event)
  })
}

test('game and host establish a nonce-bound channel and exchange requests', async () => {
  const originalWindow = globalThis.window
  const hostOrigin = 'https://slopz.fun'
  const gameOrigin = 'https://game.example'
  const hostWindow = new FixtureWindow(`${hostOrigin}/play/game_123`)
  const gameWindow = new FixtureWindow(`${gameOrigin}/?slopzGameId=game_123`)
  gameWindow.parent = hostWindow

  hostWindow.postMessage = (data, targetOrigin) => {
    assert.equal(targetOrigin, hostOrigin)
    deliverMessage(hostWindow, { data, origin: gameOrigin, source: gameWindow })
  }
  gameWindow.postMessage = (data, targetOrigin, ports = []) => {
    assert.equal(targetOrigin, gameOrigin)
    deliverMessage(gameWindow, { data, origin: hostOrigin, source: hostWindow, ports })
  }

  const requests = []
  let broker
  let client

  try {
    globalThis.window = hostWindow
    broker = new SlopzHostBroker({
      iframe: { contentWindow: gameWindow },
      gameId: 'game_123',
      gameOrigin,
      handleRequest: async (request) => {
        requests.push(request)
        if (request.method === 'get-player') {
          return { connected: false, displayName: 'Guest Slopper' }
        }
        if (request.method === 'begin-run') {
          return {
            runId: 'run_123',
            runToken: 'token_123',
            boardKey: request.payload.boardKey,
            expiresAt: 123456,
          }
        }
        throw new Error('AUTH_DENIED')
      },
    })

    globalThis.window = gameWindow
    client = new SlopzGameClient({
      gameId: 'game_123',
      parentOrigin: hostOrigin,
      build: 'consumer-fixture',
    })

    await new Promise((resolve) => nativeSetTimeout(resolve, 0))
    await new Promise((resolve) => nativeSetTimeout(resolve, 0))

    assert.deepEqual(await client.getPlayer(), {
      connected: false,
      displayName: 'Guest Slopper',
    })
    assert.deepEqual(await client.beginRun('speedrun'), {
      runId: 'run_123',
      runToken: 'token_123',
      boardKey: 'speedrun',
      expiresAt: 123456,
    })
    await assert.rejects(
      client.signIn(),
      (error) => error instanceof SlopzSdkError && error.code === 'AUTH_DENIED',
    )

    assert.deepEqual(requests.map(({ method, payload }) => ({ method, payload })), [
      { method: 'get-player', payload: {} },
      { method: 'begin-run', payload: { boardKey: 'speedrun', build: 'consumer-fixture' } },
      { method: 'sign-in', payload: {} },
    ])
  } finally {
    if (client) {
      globalThis.window = gameWindow
      client.dispose()
    }
    if (broker) {
      globalThis.window = hostWindow
      broker.dispose()
    }
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
  }
})
