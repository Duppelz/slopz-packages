import { appendFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export const packageDefinitions = Object.freeze({
  sdk: Object.freeze({ id: 'sdk', name: '@slopz/sdk', directory: 'packages/sdk' }),
  cli: Object.freeze({ id: 'cli', name: '@slopz/cli', directory: 'packages/cli' }),
})

export function prereleaseVersion(baseVersion, treeHash) {
  if (!/^\d+\.\d+\.\d+$/.test(baseVersion)) {
    throw new Error(`Package version must be a stable semantic version: ${baseVersion}`)
  }
  if (!/^[0-9a-f]{12,64}$/i.test(treeHash)) {
    throw new Error(`Package tree hash is invalid: ${treeHash}`)
  }
  return `${baseVersion}-next.g${treeHash.slice(0, 12).toLowerCase()}`
}

export function releaseVersion(baseVersion, treeHash, channel) {
  if (channel === 'next') return prereleaseVersion(baseVersion, treeHash)
  if (channel === 'stable') {
    if (!/^\d+\.\d+\.\d+$/.test(baseVersion)) {
      throw new Error(`Package version must be a stable semantic version: ${baseVersion}`)
    }
    return baseVersion
  }
  throw new Error(`Unknown release channel: ${channel}`)
}

export function releaseArtifactMetadata(channel, version, prerequisiteVersion = '') {
  if (!['next', 'stable'].includes(channel)) throw new Error(`Invalid release channel: ${channel}`)
  const expectedVersion = channel === 'next'
    ? /^\d+\.\d+\.\d+-next\.[0-9A-Za-z.-]+$/
    : /^\d+\.\d+\.\d+$/
  if (!expectedVersion.test(version ?? '')) throw new Error(`Invalid ${channel} release version: ${version ?? ''}`)
  if (channel === 'stable' && !/^\d+\.\d+\.\d+-next\.[0-9A-Za-z.-]+$/.test(prerequisiteVersion)) {
    throw new Error(`Invalid stable prerequisite version: ${prerequisiteVersion}`)
  }
  return {
    channel,
    tag: channel === 'stable' ? 'latest' : 'next',
    prerequisiteVersion: prerequisiteVersion || null,
  }
}

export function selectedPackageIds(changedFiles, selection) {
  if (!['auto', 'sdk', 'cli', 'all'].includes(selection)) {
    throw new Error(`Unknown package selection: ${selection}`)
  }
  if (selection === 'all') return ['sdk', 'cli']
  if (selection !== 'auto') return [selection]
  return Object.values(packageDefinitions)
    .filter((definition) => changedFiles.some((file) => file.startsWith(`${definition.directory}/`)))
    .map((definition) => definition.id)
}

export function createReleasePlan({ changedFiles, selection, packages, channel = 'next' }) {
  const selected = selectedPackageIds(changedFiles, selection).map((id) => {
    const definition = packageDefinitions[id]
    const state = packages[id]
    if (!state) throw new Error(`Missing release state for ${id}.`)
    return {
      ...definition,
      baseVersion: state.baseVersion,
      treeHash: state.treeHash,
      channel,
      version: releaseVersion(state.baseVersion, state.treeHash, channel),
      prerequisiteVersion: channel === 'stable'
        ? prereleaseVersion(state.baseVersion, state.treeHash)
        : null,
    }
  })
  return {
    selection,
    channel,
    changedFiles: [...changedFiles].sort(),
    selected,
  }
}

export function changedFilesBetween(base, head, cwd = repositoryRoot) {
  if (!base) return []
  const zeroSha = /^0+$/.test(base)
  const arguments_ = zeroSha
    ? ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', head]
    : ['diff', '--name-only', '-z', `${base}..${head}`, '--']
  return execFileSync('git', arguments_, { cwd, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
}

export function packageState(id, head = 'HEAD', cwd = repositoryRoot) {
  const definition = packageDefinitions[id]
  if (!definition) throw new Error(`Unknown package: ${id}`)
  const packageJson = JSON.parse(readFileSync(resolve(cwd, definition.directory, 'package.json'), 'utf8'))
  const treeHash = execFileSync('git', ['rev-parse', `${head}:${definition.directory}`], {
    cwd,
    encoding: 'utf8',
  }).trim()
  return { baseVersion: packageJson.version, treeHash }
}

export function githubOutputs(plan) {
  const selectedIds = new Set(plan.selected.map((entry) => entry.id))
  const lines = [`selected=${JSON.stringify(plan.selected)}`, `channel=${plan.channel}`]
  for (const id of Object.keys(packageDefinitions)) {
    const entry = plan.selected.find((candidate) => candidate.id === id)
    lines.push(`${id}=${selectedIds.has(id)}`)
    lines.push(`${id}_version=${entry?.version ?? ''}`)
    lines.push(`${id}_prerequisite_version=${entry?.prerequisiteVersion ?? ''}`)
    lines.push(`${id}_tree_hash=${entry?.treeHash ?? ''}`)
  }
  return `${lines.join('\n')}\n`
}

export function writeGithubOutputs(plan, outputPath = process.env.GITHUB_OUTPUT) {
  if (outputPath) appendFileSync(outputPath, githubOutputs(plan))
}
