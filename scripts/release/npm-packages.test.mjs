import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createReleasePlan,
  githubOutputs,
  prereleaseVersion,
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
  })
  assert.deepEqual(plan.selected, [{
    id: 'cli',
    name: '@slopz/cli',
    directory: 'packages/cli',
    baseVersion: '0.2.0',
    treeHash: packages.cli.treeHash,
    version: '0.2.0-next.g123456abcdef',
  }])
  const outputs = githubOutputs(plan)
  assert.match(outputs, /^sdk=false$/m)
  assert.match(outputs, /^cli=true$/m)
  assert.match(outputs, /^cli_version=0\.2\.0-next\.g123456abcdef$/m)
})
