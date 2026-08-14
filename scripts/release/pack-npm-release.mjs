#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

import { packageDefinitions, releaseArtifactMetadata, repositoryRoot } from './npm-packages.mjs'

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

const id = argument('--package')
const version = argument('--version')
const channel = argument('--channel', 'next')
const prerequisiteVersion = argument('--prerequisite-version', '')
const outputDirectory = resolve(argument('--output', 'release/npm'))
const sourceSha = argument('--source-sha', '')
const treeHash = argument('--tree-hash', '')
const definition = packageDefinitions[id]

if (!definition) throw new Error(`Unknown or missing --package value: ${id ?? ''}`)
const releaseMetadata = releaseArtifactMetadata(channel, version, prerequisiteVersion)

const packageRoot = resolve(repositoryRoot, definition.directory)
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
if (packageJson.name !== definition.name) throw new Error(`Unexpected package name: ${packageJson.name}`)
if (!Array.isArray(packageJson.files) || packageJson.files.length === 0) {
  throw new Error(`${definition.name} must declare a non-empty files allowlist.`)
}

const temporaryRoot = mkdtempSync(join(tmpdir(), `slopz-${id}-release-`))
const stagingRoot = join(temporaryRoot, 'package')
const temporaryPack = join(temporaryRoot, 'pack')
const npmCache = join(temporaryRoot, 'npm-cache')
const userConfig = join(temporaryRoot, 'npmrc')
const npmEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith('npm_config_')),
)
npmEnvironment.npm_config_cache = npmCache
npmEnvironment.npm_config_userconfig = userConfig

try {
  mkdirSync(stagingRoot)
  mkdirSync(temporaryPack)
  writeFileSync(userConfig, '')
  for (const entry of packageJson.files) {
    if (entry.includes('*') || entry.startsWith('..')) {
      throw new Error(`Unsupported package files entry: ${entry}`)
    }
    cpSync(join(packageRoot, entry), join(stagingRoot, entry), { recursive: true })
  }
  writeFileSync(join(stagingRoot, 'package.json'), `${JSON.stringify({
    ...packageJson,
    version,
  }, null, 2)}\n`)

  const packOutput = execFileSync('npm', [
    'pack',
    '--json',
    '--pack-destination',
    temporaryPack,
  ], {
    cwd: stagingRoot,
    env: npmEnvironment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const [packed] = JSON.parse(packOutput)
  if (packed.name !== definition.name || packed.version !== version) {
    throw new Error(`Packed unexpected release: ${packed.name}@${packed.version}`)
  }

  mkdirSync(outputDirectory, { recursive: true })
  const tarball = `${id}.tgz`
  renameSync(join(temporaryPack, packed.filename), join(outputDirectory, tarball))
  const manifest = {
    id,
    name: definition.name,
    baseVersion: packageJson.version,
    version,
    ...releaseMetadata,
    sourceSha,
    treeHash,
    tarball,
    integrity: packed.integrity,
    shasum: packed.shasum,
    files: packed.files.map((file) => file.path).sort(),
  }
  writeFileSync(
    join(outputDirectory, `${id}.release.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  process.stdout.write(`Prepared ${definition.name}@${version} as ${basename(tarball)}\n`)
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
