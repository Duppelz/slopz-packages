#!/usr/bin/env node

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoot = mkdtempSync(join(tmpdir(), 'slopz-cli-package-'))
const packDirectory = join(temporaryRoot, 'pack')
const consumerRoot = join(temporaryRoot, 'consumer')
const npmCache = join(temporaryRoot, 'npm-cache')
const configPath = join(temporaryRoot, 'config', 'config.json')
const cliPackage = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'))
const cleanEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => {
    const normalized = key.toLowerCase()
    return !normalized.startsWith('npm_config_') && !normalized.startsWith('slopz_')
  }),
)
const npmEnvironment = {
  ...cleanEnvironment,
  npm_config_cache: npmCache,
}
const cliEnvironment = {
  ...cleanEnvironment,
  SLOPZ_CONFIG_PATH: configPath,
}

const expectedFiles = [
  'LICENSE',
  'README.md',
  'dist/api.d.ts',
  'dist/api.js',
  'dist/auth.d.ts',
  'dist/auth.js',
  'dist/config.d.ts',
  'dist/config.js',
  'dist/draft.d.ts',
  'dist/draft.js',
  'dist/index.d.ts',
  'dist/index.js',
  'dist/manifest.d.ts',
  'dist/manifest.js',
  'dist/project.d.ts',
  'dist/project.js',
  'dist/slots.d.ts',
  'dist/slots.js',
  'package.json',
]

function run(command, arguments_, options = {}) {
  return execFileSync(command, arguments_, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...options,
  })
}

function parseJson(output, command) {
  try {
    return JSON.parse(output)
  } catch {
    assert.fail(`${command} did not return valid JSON:\n${output}`)
  }
}

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

try {
  mkdirSync(packDirectory)
  mkdirSync(consumerRoot)

  const packOutput = run('npm', ['pack', '--json', '--pack-destination', packDirectory], {
    cwd: cliRoot,
    env: npmEnvironment,
  })
  const [packed] = JSON.parse(packOutput)
  assert.equal(packed.name, cliPackage.name)
  assert.equal(packed.version, cliPackage.version)
  assert.deepEqual(packed.files.map((file) => file.path).sort(), expectedFiles)

  const tarball = join(packDirectory, packed.filename)
  writeFileSync(join(consumerRoot, 'package.json'), `${JSON.stringify({
    name: 'slopz-cli-consumer-fixture',
    private: true,
  }, null, 2)}\n`)

  run('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    tarball,
  ], {
    cwd: consumerRoot,
    env: npmEnvironment,
    stdio: 'inherit',
  })

  const installedRoot = join(consumerRoot, 'node_modules/@slopz/cli')
  const installedPackage = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'))
  assert.equal(installedPackage.version, cliPackage.version)
  assert.equal(Object.hasOwn(installedPackage, 'private'), false)
  assert.equal(installedPackage.license, 'MIT')
  assert.equal(installedPackage.repository.url, 'https://github.com/Duppelz/slopz-packages.git')
  assert.equal(installedPackage.repository.directory, 'packages/cli')
  assert.equal(installedPackage.publishConfig.access, 'public')
  assert.equal(installedPackage.bin.slopz, './dist/index.js')
  assert.match(readFileSync(join(installedRoot, 'dist/index.js'), 'utf8'), /^#!\/usr\/bin\/env node\n/)

  const executable = join(
    consumerRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'slopz.cmd' : 'slopz',
  )
  if (process.platform !== 'win32') {
    chmodSync(executable, statSync(executable).mode | 0o100)
  }

  const invoke = (arguments_, options = {}) => spawnSync(executable, arguments_, {
    cwd: consumerRoot,
    env: cliEnvironment,
    encoding: 'utf8',
    ...options,
  })

  const version = invoke(['version'])
  assert.equal(version.error, undefined)
  assert.equal(version.status, 0, version.stderr)
  assert.equal(version.stdout, `${cliPackage.version}\n`)

  const help = invoke(['help'])
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, new RegExp(`Slopz CLI ${cliPackage.version.replaceAll('.', '\\.')}`))
  assert.match(help.stdout, /slopz project create/)
  assert.match(help.stdout, /slopz project draft apply/)
  assert.match(help.stdout, /slopz slots validate/)

  const configure = invoke([
    'env',
    'set',
    'staging',
    '--api-url',
    'https://staging-api.example',
    '--app-url',
    'https://staging.example',
    '--default',
    '--json',
  ])
  assert.equal(configure.status, 0, configure.stderr)
  assert.deepEqual(parseJson(configure.stdout, 'slopz env set'), {
    name: 'staging',
    default: true,
    apiUrl: 'https://staging-api.example',
    appUrl: 'https://staging.example',
  })

  const environments = invoke(['env', 'list', '--json'])
  assert.equal(environments.status, 0, environments.stderr)
  assert.deepEqual(parseJson(environments.stdout, 'slopz env list'), [
    {
      name: 'production',
      default: false,
      apiUrl: 'https://api.slopz.fun/api',
      appUrl: 'https://slopz.fun',
      connected: false,
    },
    {
      name: 'staging',
      default: true,
      apiUrl: 'https://staging-api.example',
      appUrl: 'https://staging.example',
      connected: false,
    },
  ])
  const defaultProduction = invoke(['env', 'default', 'production', '--json'])
  assert.equal(defaultProduction.status, 0, defaultProduction.stderr)
  assert.deepEqual(parseJson(defaultProduction.stdout, 'slopz env default'), { name: 'production', default: true })
  assert.equal(statSync(configPath).mode & 0o777, 0o600)

  writeFileSync(join(consumerRoot, 'slopz.slots.json'), `${JSON.stringify({
    version: 1,
    slots: [{
      key: 'billboard',
      placement: {
        label: 'Arena billboard',
        description: 'Beside the starting line',
        width: 720,
        height: 500,
      },
      rental: {
        approval: 'manual',
        offers: [{ key: 'day', duration: '1d', price: '5' }],
      },
    }],
  }, null, 2)}\n`)

  const validSlots = invoke(['slots', 'validate', '--json'])
  assert.equal(validSlots.status, 0, validSlots.stderr)
  const validManifest = parseJson(validSlots.stdout, 'slopz slots validate')
  assert.equal(validManifest.version, 1)
  assert.equal(validManifest.slots.length, 1)
  assert.equal(validManifest.slots[0].key, 'billboard')

  writeFileSync(join(consumerRoot, 'invalid.slots.json'), `${JSON.stringify({
    version: 1,
    slots: [{
      key: 'Invalid Key',
      placement: {
        label: 'Invalid',
        description: 'Invalid fixture',
        width: 720,
        height: 500,
      },
      rental: {
        offers: [{ key: 'day', duration: '1d', price: '5' }],
      },
    }],
  }, null, 2)}\n`)
  const invalidSlots = invoke(['slots', 'validate', '--file', 'invalid.slots.json'])
  assert.equal(invalidSlots.status, 1)
  assert.match(invalidSlots.stderr, /key must start with a lowercase letter/)

  writeFileSync(join(consumerRoot, 'icon.webp'), webp(800, 800))
  writeFileSync(join(consumerRoot, 'cover.webp'), webp(1600, 900))
  writeFileSync(join(consumerRoot, 'slopz.game.json'), `${JSON.stringify({
    version: 1,
    game: {
      title: 'Packaged Slop',
      pitch: 'A complete packaged CLI manifest.',
      description: 'The installed CLI validates complete game metadata and local media before it changes a remote draft.',
      engineTags: ['webgl'],
      genreTags: ['browser'],
      links: [],
    },
    runtime: { entryUrl: 'https://game.example', launchMode: 'embedded' },
    coin: {
      economyDeployment: 'lukso-mainnet-staging',
      name: 'Packaged Slop Coin',
      symbol: 'PACK',
      description: 'The Packaged Slop game coin. It can lose value.',
      graduationLyx: '3',
      curveFeeBps: 200,
      iconSameAsGame: true,
      linksSameAsGame: true,
      links: [],
    },
    media: { gameIcon: 'icon.webp', cover: 'cover.webp', screenshots: [] },
  }, null, 2)}\n`)
  const validGame = invoke(['project', 'draft', 'validate', '--json'])
  assert.equal(validGame.status, 0, validGame.stderr)
  const gameManifest = parseJson(validGame.stdout, 'slopz project draft validate')
  assert.equal(gameManifest.title, 'Packaged Slop')
  assert.equal(gameManifest.media.length, 2)

  process.stdout.write(`CLI package validation passed: ${packed.filename}\n`)
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
