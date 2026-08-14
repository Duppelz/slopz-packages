import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createReleasePlan,
  githubOutputs,
  prereleaseVersion,
  releaseArtifactMetadata,
  releaseVersion,
  selectedPackageIds,
} from './npm-packages.mjs'

const packages = {
  sdk: { baseVersion: '0.1.0', treeHash: 'abcdef1234567890abcdef1234567890abcdef12' },
  cli: { baseVersion: '0.2.0', treeHash: '123456abcdef7890123456abcdef789012345678' },
}

test('prerelease versions are stable for one package tree', () => {
  assert.equal(
    prereleaseVersion('0.1.0', packages.sdk.treeHash),
    '0.1.0-next.gabcdef123456',
  )
  assert.throws(() => prereleaseVersion('0.1.0-next.1', packages.sdk.treeHash), /stable semantic version/)
})

test('stable releases use the declared version and require an explicit channel', () => {
  assert.equal(releaseVersion('0.2.0', packages.cli.treeHash, 'stable'), '0.2.0')
  assert.equal(releaseVersion('0.2.0', packages.cli.treeHash, 'next'), '0.2.0-next.g123456abcdef')
  assert.throws(() => releaseVersion('0.2.0', packages.cli.treeHash, 'latest'), /Unknown release channel/)
})

test('release artifacts carry an explicit npm tag and stable prerequisite', () => {
  assert.deepEqual(releaseArtifactMetadata('next', '0.2.0-next.g123456abcdef'), {
    channel: 'next', tag: 'next', prerequisiteVersion: null,
  })
  assert.deepEqual(releaseArtifactMetadata('stable', '0.2.0', '0.2.0-next.g123456abcdef'), {
    channel: 'stable', tag: 'latest', prerequisiteVersion: '0.2.0-next.g123456abcdef',
  })
  assert.throws(() => releaseArtifactMetadata('stable', '0.2.0', ''), /stable prerequisite/)
})

test('automatic releases select only changed package trees', () => {
  assert.deepEqual(selectedPackageIds([
    'docs/ci-cd-operations-spec.md',
    'packages/sdk/src/index.ts',
  ], 'auto'), ['sdk'])
  assert.deepEqual(selectedPackageIds(['scripts/release/npm-packages.mjs'], 'auto'), [])
})

test('manual selection remains explicit', () => {
  assert.deepEqual(selectedPackageIds([], 'sdk'), ['sdk'])
  assert.deepEqual(selectedPackageIds([], 'cli'), ['cli'])
  assert.deepEqual(selectedPackageIds([], 'all'), ['sdk', 'cli'])
})

test('release plans expose deterministic GitHub job outputs', () => {
  const plan = createReleasePlan({
    changedFiles: ['packages/cli/src/index.ts'],
    selection: 'auto',
    packages,
    channel: 'next',
  })
  assert.deepEqual(plan.selected, [{
    id: 'cli',
    name: '@slopz/cli',
    directory: 'packages/cli',
    baseVersion: '0.2.0',
    treeHash: packages.cli.treeHash,
    channel: 'next',
    version: '0.2.0-next.g123456abcdef',
    prerequisiteVersion: null,
  }])
  const outputs = githubOutputs(plan)
  assert.match(outputs, /^sdk=false$/m)
  assert.match(outputs, /^cli=true$/m)
  assert.match(outputs, /^cli_version=0\.2\.0-next\.g123456abcdef$/m)
})

test('stable plans bind each release to its deterministic next prerequisite', () => {
  const plan = createReleasePlan({ changedFiles: [], selection: 'all', packages, channel: 'stable' })
  assert.equal(plan.channel, 'stable')
  assert.deepEqual(plan.selected.map(({ id, version, prerequisiteVersion }) => ({ id, version, prerequisiteVersion })), [
    { id: 'sdk', version: '0.1.0', prerequisiteVersion: '0.1.0-next.gabcdef123456' },
    { id: 'cli', version: '0.2.0', prerequisiteVersion: '0.2.0-next.g123456abcdef' },
  ])
  assert.match(githubOutputs(plan), /^channel=stable$/m)
  assert.match(githubOutputs(plan), /^cli_prerequisite_version=0\.2\.0-next\.g123456abcdef$/m)
})
