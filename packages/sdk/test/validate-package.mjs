#!/usr/bin/env node

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoot = mkdtempSync(join(tmpdir(), 'slopz-sdk-package-'))
const packDirectory = join(temporaryRoot, 'pack')
const consumerRoot = join(temporaryRoot, 'consumer')
const npmCache = join(temporaryRoot, 'npm-cache')
const sdkPackage = JSON.parse(readFileSync(join(sdkRoot, 'package.json'), 'utf8'))
const npmEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith('npm_config_')),
)
npmEnvironment.npm_config_cache = npmCache

const expectedFiles = [
  'LICENSE',
  'README.md',
  'dist/api.d.ts',
  'dist/api.js',
  'dist/host.d.ts',
  'dist/host.js',
  'dist/index.d.ts',
  'dist/index.js',
  'dist/protocol.d.ts',
  'dist/protocol.js',
  'dist/types.d.ts',
  'dist/types.js',
  'package.json',
]

function run(command, arguments_, options = {}) {
  return execFileSync(command, arguments_, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...options,
  })
}

try {
  mkdirSync(packDirectory)
  mkdirSync(join(consumerRoot, 'src'), { recursive: true })

  const packOutput = run('npm', ['pack', '--json', '--pack-destination', packDirectory], {
    cwd: sdkRoot,
    env: npmEnvironment,
  })
  const [packed] = JSON.parse(packOutput)
  assert.equal(packed.name, sdkPackage.name)
  assert.equal(packed.version, sdkPackage.version)
  assert.deepEqual(packed.files.map((file) => file.path).sort(), expectedFiles)

  const tarball = join(packDirectory, packed.filename)
  writeFileSync(join(consumerRoot, 'package.json'), `${JSON.stringify({
    name: 'slopz-sdk-consumer-fixture',
    private: true,
    type: 'module',
  }, null, 2)}\n`)
  writeFileSync(join(consumerRoot, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2022', 'DOM'],
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
    include: ['src'],
  }, null, 2)}\n`)
  writeFileSync(join(consumerRoot, 'src/index.ts'), `import {
  SlopzGameClient,
  SlopzSdkError,
  createSlopzGame,
  type SlopzPlayer,
} from '@slopz/sdk'
import { SlopzHostBroker, type SlopzHostRequest } from '@slopz/sdk/host'

const client: SlopzGameClient = createSlopzGame({
  gameId: 'consumer_game',
  parentOrigin: 'https://slopz.fun',
})

export async function readPlayer(): Promise<SlopzPlayer> {
  return client.getPlayer()
}

export function connectHost(
  iframe: HTMLIFrameElement,
  handleRequest: (request: SlopzHostRequest) => Promise<unknown>,
): SlopzHostBroker {
  return new SlopzHostBroker({
    iframe,
    gameId: 'consumer_game',
    gameOrigin: 'https://game.example',
    handleRequest,
  })
}

export { SlopzSdkError }
`)
  writeFileSync(join(consumerRoot, 'verify-runtime.mjs'), `import assert from 'node:assert/strict'
import * as sdk from '@slopz/sdk'
import * as host from '@slopz/sdk/host'

assert.deepEqual(Object.keys(sdk).sort(), [
  'SlopzApiClient',
  'SlopzGameClient',
  'SlopzSdkError',
  'createSlopzGame',
])
assert.deepEqual(Object.keys(host).sort(), ['SlopzHostBroker'])
`)

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

  const installedPackage = JSON.parse(readFileSync(
    join(consumerRoot, 'node_modules/@slopz/sdk/package.json'),
    'utf8',
  ))
  assert.equal(installedPackage.license, 'MIT')
  assert.equal(installedPackage.repository.url, 'https://github.com/Duppelz/slopz-packages.git')
  assert.equal(installedPackage.repository.directory, 'packages/sdk')
  assert.equal(installedPackage.publishConfig.access, 'public')
  assert.deepEqual(Object.keys(installedPackage.exports).sort(), ['.', './host'])

  run(process.execPath, [join(consumerRoot, 'verify-runtime.mjs')], { stdio: 'inherit' })
  run(process.execPath, [
    join(sdkRoot, 'node_modules/typescript/bin/tsc'),
    '--project',
    join(consumerRoot, 'tsconfig.json'),
  ], { stdio: 'inherit' })

  process.stdout.write(`SDK package validation passed: ${packed.filename}\n`)
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
