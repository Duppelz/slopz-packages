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
  'dist/index.d.ts',
  'dist/index.js',
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
  assert.equal(installedPackage.repository.url, 'https://github.com/0xSoul/slopz-packages.git')
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
  assert.deepEqual(parseJson(environments.stdout, 'slopz env list'), [{
    name: 'staging',
    default: true,
    apiUrl: 'https://staging-api.example',
    appUrl: 'https://staging.example',
    connected: false,
  }])
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

  process.stdout.write(`CLI package validation passed: ${packed.filename}\n`)
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
