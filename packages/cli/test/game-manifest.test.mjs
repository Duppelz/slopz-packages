import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { applyProjectDraft } from '../dist/draft.js'
import { manifestSummary, readGameManifest } from '../dist/manifest.js'

function webp(width, height) {
  const bytes = Buffer.alloc(30)
  bytes.write('RIFF', 0, 'ascii')
  bytes.writeUInt32LE(22, 4)
  bytes.write('WEBP', 8, 'ascii')
  bytes.write('VP8X', 12, 'ascii')
  bytes.writeUInt32LE(10, 16)
  bytes.writeUIntLE(width - 1, 24, 3)
  bytes.writeUIntLE(height - 1, 27, 3)
  return bytes
}

async function fixture(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'slopz-cli-game-manifest-'))
  await writeFile(join(directory, 'icon.webp'), webp(800, 800))
  await writeFile(join(directory, 'cover.webp'), webp(1_600, 900))
  await writeFile(join(directory, 'screenshot.webp'), webp(1_920, 1_080))
  const manifest = {
    version: 1,
    game: {
      title: 'Terminal Slop',
      pitch: 'A complete game draft from the terminal.',
      description: 'This description is stored with the private game draft and becomes reviewable before publication.',
      engineTags: ['webgl'],
      genreTags: ['racing', 'browser'],
      links: [{ title: 'Game site', url: 'https://game.example' }],
    },
    runtime: { entryUrl: 'https://game.example', launchMode: 'embedded' },
    coin: {
      economyDeployment: 'lukso-mainnet-staging',
      name: 'Terminal Slop Coin',
      symbol: 'SLOP',
      description: 'The game coin for Terminal Slop. It can lose value.',
      graduationLyx: '3',
      curveFeeBps: 200,
      iconSameAsGame: true,
      linksSameAsGame: true,
      links: [],
    },
    media: {
      gameIcon: 'icon.webp',
      cover: 'cover.webp',
      screenshots: ['screenshot.webp'],
    },
    ...overrides,
  }
  await writeFile(join(directory, 'slopz.game.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return { directory, close: () => rm(directory, { recursive: true, force: true }) }
}

test('validates a complete manifest and applies runtime, WebP media, and content', async () => {
  const temporary = await fixture()
  try {
    const loaded = await readGameManifest(temporary.directory)
    const summary = manifestSummary(loaded)
    assert.equal(summary.title, 'Terminal Slop')
    assert.deepEqual(summary.media.map(({ role, width, height }) => ({ role, width, height })), [
      { role: 'game-icon', width: 800, height: 800 },
      { role: 'cover', width: 1_600, height: 900 },
      { role: 'screenshot', width: 1_920, height: 1_080 },
    ])

    const requests = []
    const uploads = []
    const request = async (_baseUrl, path, body) => {
      requests.push({ path, body })
      if (path === '/cli/games/runtime-url') {
        return { ok: true, runtime: { runtimeId: 'runtime_game_terminal123_primary', source: 'developer_url', launchMode: 'embedded', entryUrl: body.entryUrl, allowedOrigin: 'https://game.example', ownershipStatus: 'pending', integrationStatus: 'unknown', status: 'draft' } }
      }
      if (path === '/cli/games/draft-media/upload-url') return { ok: true, uploadUrl: `https://upload.example/${requests.length}` }
      if (path === '/cli/games/draft-media/commit') {
        return { ok: true, media: { mediaId: body.mediaId, size: 30, width: body.width, height: body.height } }
      }
      if (path === '/cli/games/draft-content') return { ok: true, game: { gameId: body.gameId, slug: 'terminal-slop', status: 'draft' } }
      throw new Error(`Unexpected path: ${path}`)
    }
    const result = await applyProjectDraft({
      environmentName: 'staging',
      environment: { apiUrl: 'https://staging-api.example/api', appUrl: 'https://staging.example', cliToken: 'slopz_cli_test' },
      project: { gameId: 'game_terminal123', clientId: 'slopz_pk_terminal123', slug: 'terminal-slop', canonicalUrl: 'https://staging.example/g/terminal-slop' },
      loaded,
      request,
      upload: async (uploadUrl, media) => {
        uploads.push({ uploadUrl, role: media.role, size: media.size })
        return `storage_${media.role}`
      },
    })
    assert.equal(result.media.length, 3)
    assert.equal(result.content.coinSymbol, 'SLOP')
    assert.deepEqual(uploads.map((item) => item.role), ['game-icon', 'cover', 'screenshot'])
    assert.deepEqual(requests.map((item) => item.path), [
      '/cli/games/runtime-url',
      '/cli/games/draft-media/upload-url',
      '/cli/games/draft-media/commit',
      '/cli/games/draft-media/upload-url',
      '/cli/games/draft-media/commit',
      '/cli/games/draft-media/upload-url',
      '/cli/games/draft-media/commit',
      '/cli/games/draft-content',
    ])
    const saved = requests.at(-1).body.content
    assert.equal(saved.description, loaded.manifest.game.description)
    assert.equal(saved.media.gameIconId, 'game_terminal123_game_icon')
    assert.deepEqual(saved.media.screenshotIds, ['game_terminal123_screenshot_1'])
  } finally {
    await temporary.close()
  }
})

test('rejects an incomplete or publication-invalid manifest before upload', async () => {
  const temporary = await fixture({
    coin: {
      economyDeployment: 'lukso-mainnet-staging',
      name: 'Bad Coin',
      symbol: 'bad-symbol',
      description: 'Invalid symbol.',
      graduationLyx: '0',
      curveFeeBps: 1_001,
      iconSameAsGame: true,
      linksSameAsGame: true,
      links: [],
    },
  })
  try {
    await assert.rejects(() => readGameManifest(temporary.directory), /coin\.symbol/)
  } finally {
    await temporary.close()
  }
})
