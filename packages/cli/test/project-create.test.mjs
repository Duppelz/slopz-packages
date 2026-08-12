import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createProject } from '../dist/project.js'

test('project create links a draft, attaches a runtime, and optionally syncs slots', async () => {
  const requests = []
  const request = async (_baseUrl, path, body) => {
    requests.push({ path, body })
    if (path === '/cli/games/drafts') {
      return { ok: true, game: { gameId: 'game_terminal123', clientId: 'slopz_pk_terminal123', slug: 'terminal-slop', canonicalUrl: 'https://slopz.fun/g/terminal-slop', status: 'draft' } }
    }
    if (path === '/cli/games/runtime-url') {
      return { ok: true, runtime: { runtimeId: 'runtime_game_terminal123_primary', source: 'developer_url', launchMode: 'embedded', entryUrl: 'https://game.example/', allowedOrigin: 'https://game.example', ownershipStatus: 'pending', integrationStatus: 'unknown', status: 'draft' } }
    }
    if (path === '/cli/ads/sync') return { ok: true, gameId: 'game_terminal123', slotCount: 1 }
    throw new Error(`Unexpected path: ${path}`)
  }
  const directory = await mkdtemp(join(tmpdir(), 'slopz-cli-project-'))
  await writeFile(join(directory, 'slopz.slots.json'), `${JSON.stringify({
    version: 1,
    slots: [{
      key: 'banner',
      placement: { label: 'Billboard', description: 'Inside the game', width: 720, height: 500 },
      rental: { approval: 'manual', offers: [{ key: 'week', duration: '7d', price: '20' }] },
    }],
  })}\n`)

  try {
    const result = await createProject({
      cwd: directory,
      environmentName: 'production',
      environment: { apiUrl: 'https://api.slopz.fun/api', appUrl: 'https://slopz.fun', cliToken: 'slopz_cli_test' },
      title: 'Terminal Slop',
      pitch: 'Created from the command line.',
      gameUrl: 'https://game.example/',
      syncSlots: true,
      request,
    })
    assert.equal(result.environment, 'production')
    assert.equal(result.game.gameId, 'game_terminal123')
    assert.equal(result.runtime.entryUrl, 'https://game.example/')
    assert.equal(result.slotCount, 1)
    assert.equal(result.next.url, 'https://slopz.fun/g/terminal-slop')

    const project = JSON.parse(await readFile(join(directory, '.slopz/project.json'), 'utf8'))
    assert.equal(project.environments.production.gameId, 'game_terminal123')
    assert.deepEqual(requests.map((item) => item.path), [
      '/cli/games/drafts',
      '/cli/games/runtime-url',
      '/cli/ads/sync',
    ])
    assert.equal(requests[2].body.slots[0].offers[0].durationSeconds, 604_800)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('project create refuses to replace an existing environment link', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'slopz-cli-project-linked-'))
  await mkdir(join(directory, '.slopz'))
  await writeFile(join(directory, '.slopz/project.json'), `${JSON.stringify({
    environments: {
      production: {
        gameId: 'game_existing123',
        clientId: 'slopz_pk_existing123',
        slug: 'existing',
        canonicalUrl: 'https://slopz.fun/g/existing',
      },
    },
  })}\n`)
  try {
    await assert.rejects(() => createProject({
      cwd: directory,
      environmentName: 'production',
      environment: { apiUrl: 'https://api.slopz.fun/api', appUrl: 'https://slopz.fun', cliToken: 'slopz_cli_test' },
      title: 'Duplicate',
      pitch: 'Must not create another draft.',
      syncSlots: false,
      request: async () => { throw new Error('request must not run') },
    }), /already linked to game_existing123/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
