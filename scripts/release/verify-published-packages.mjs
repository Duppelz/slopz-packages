#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

const releaseDirectory = resolve(argument('--release-directory', 'release/npm'))
const manifests = readdirSync(releaseDirectory)
  .filter((file) => file.endsWith('.release.json'))
  .map((file) => JSON.parse(readFileSync(join(releaseDirectory, file), 'utf8')))
const temporaryRoot = mkdtempSync(join(tmpdir(), 'slopz-published-packages-'))
const consumerRoot = join(temporaryRoot, 'consumer')
const npmCache = join(temporaryRoot, 'npm-cache')
const userConfig = join(temporaryRoot, 'npmrc')
const cleanEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith('npm_config_')),
)
const environment = {
  ...cleanEnvironment,
  npm_config_cache: npmCache,
  npm_config_userconfig: userConfig,
}

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: consumerRoot,
    env: environment,
    encoding: 'utf8',
    ...options,
  })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr)
  return result
}

try {
  mkdirSync(consumerRoot)
  writeFileSync(userConfig, '')
  writeFileSync(join(consumerRoot, 'package.json'), `${JSON.stringify({
    name: 'slopz-public-package-verification',
    private: true,
    type: 'module',
  }, null, 2)}\n`)
  run('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    ...manifests.map((manifest) => `${manifest.name}@${manifest.version}`),
  ])

  const sdk = manifests.find((manifest) => manifest.id === 'sdk')
  if (sdk) {
    writeFileSync(join(consumerRoot, 'verify-sdk.mjs'), `import assert from 'node:assert/strict'
import * as sdk from '@slopz/sdk'
import * as host from '@slopz/sdk/host'
assert.deepEqual(Object.keys(sdk).sort(), ['SlopzApiClient', 'SlopzGameClient', 'SlopzSdkError', 'createSlopzGame'])
assert.deepEqual(Object.keys(host).sort(), ['SlopzHostBroker'])
`)
    run(process.execPath, ['verify-sdk.mjs'])
  }

  const cli = manifests.find((manifest) => manifest.id === 'cli')
  if (cli) {
    const executable = join(consumerRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'slopz.cmd' : 'slopz')
    const version = run(executable, ['version'])
    assert.equal(version.stdout, `${cli.version}\n`)
    const help = run(executable, ['help'])
    assert.match(help.stdout, /slopz slots validate/)
  }

  process.stdout.write(`Installed and executed ${manifests.map((manifest) => `${manifest.name}@${manifest.version}`).join(', ')}.\n`)
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
