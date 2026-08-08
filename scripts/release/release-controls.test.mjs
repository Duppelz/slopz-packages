import assert from 'node:assert/strict'
import test from 'node:test'

import { verifyReleaseControls } from './release-controls.mjs'

const automaticEnvironment = {
  protection_rules: [{ type: 'branch_policy' }],
  deployment_branch_policy: {
    protected_branches: true,
    custom_branch_policies: false,
  },
}

test('accepts automated next releases from protected public branches', () => {
  assert.doesNotThrow(() => verifyReleaseControls({
    repository: { visibility: 'public' },
    environment: automaticEnvironment,
  }))
})

test('rejects private repositories because provenance and free protection are unavailable', () => {
  assert.throws(() => verifyReleaseControls({
    repository: { visibility: 'private' },
    environment: automaticEnvironment,
  }), /must be public/)
})

test('rejects routine approval and unprotected release branches', () => {
  assert.throws(() => verifyReleaseControls({
    repository: { visibility: 'public' },
    environment: {
      ...automaticEnvironment,
      protection_rules: [{
        type: 'required_reviewers',
        prevent_self_review: false,
        reviewers: [{ type: 'User', reviewer: { login: 'aj-maz' } }],
      }],
    },
  }), /must not wait/)
  assert.throws(() => verifyReleaseControls({
    repository: { visibility: 'public' },
    environment: {
      protection_rules: [],
      deployment_branch_policy: null,
    },
  }), /only protected branches/)
})
