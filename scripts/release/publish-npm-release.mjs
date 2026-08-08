#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

function registryUrl(name, version) {
  return `https://registry.npmjs.org/${name.replace('/', '%2f')}/${version}`
}

async function registryVersion(manifest) {
  const response = await fetch(registryUrl(manifest.name, manifest.version), {
    headers: { accept: 'application/json' },
  })
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`npm registry returned ${response.status} for ${manifest.name}@${manifest.version}`)
  return response.json()
}

async function waitForVersion(manifest) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const published = await registryVersion(manifest)
    if (published) return published
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 3_000))
  }
  throw new Error(`Timed out waiting for ${manifest.name}@${manifest.version} in the npm registry.`)
}

function verifyIntegrity(manifest, published) {
  if (published.dist?.integrity !== manifest.integrity) {
    throw new Error(`Registry integrity does not match the prepared ${manifest.name}@${manifest.version} tarball.`)
  }
}

if (process.env.GITHUB_ACTIONS !== 'true') {
  throw new Error('Public npm publication is restricted to GitHub Actions.')
}
if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
  throw new Error('GitHub OIDC is unavailable; the publish job needs id-token: write.')
}
if (!process.env.GITHUB_WORKFLOW_REF?.includes('/.github/workflows/release-packages.yml@')) {
  throw new Error(`Unexpected publishing workflow: ${process.env.GITHUB_WORKFLOW_REF ?? 'missing'}`)
}

const releaseDirectory = resolve(argument('--release-directory', 'release/npm'))
const manifests = readdirSync(releaseDirectory)
  .filter((file) => file.endsWith('.release.json'))
  .sort()
  .map((file) => JSON.parse(readFileSync(resolve(releaseDirectory, file), 'utf8')))

if (manifests.length === 0) throw new Error('No package release manifests were provided.')

for (const manifest of manifests) {
  const existing = await registryVersion(manifest)
  if (existing) {
    verifyIntegrity(manifest, existing)
    process.stdout.write(`Skipping existing unchanged release ${manifest.name}@${manifest.version}.\n`)
    continue
  }
  execFileSync('npm', [
    'publish',
    resolve(releaseDirectory, manifest.tarball),
    '--tag',
    'next',
    '--access',
    'public',
  ], { stdio: 'inherit' })
  const published = await waitForVersion(manifest)
  verifyIntegrity(manifest, published)
  process.stdout.write(`Published and verified ${manifest.name}@${manifest.version}.\n`)
}
