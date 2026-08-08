import assert from 'node:assert/strict'
import test from 'node:test'

import { verifyReleaseControls } from './release-controls.mjs'

const protectedEnvironment = {
  protection_rules: [{
    type: 'required_reviewers',
    prevent_self_review: false,
    reviewers: [{ type: 'User', reviewer: { login: 'aj-maz' } }],
  }],
}

test('accepts the sole-operator protected public release boundary', () => {
  assert.doesNotThrow(() => verifyReleaseControls({
    repository: { visibility: 'public' },
    environment: protectedEnvironment,
    reviewerLogin: 'aj-maz',
  }))
})

test('rejects private repositories because provenance and free protection are unavailable', () => {
  assert.throws(() => verifyReleaseControls({
    repository: { visibility: 'private' },
    environment: protectedEnvironment,
    reviewerLogin: 'aj-maz',
  }), /must be public/)
})

test('rejects missing approval and sole-operator lockout configurations', () => {
  assert.throws(() => verifyReleaseControls({
    repository: { visibility: 'public' },
    environment: { protection_rules: [] },
    reviewerLogin: 'aj-maz',
  }), /must require a reviewer/)
  assert.throws(() => verifyReleaseControls({
    repository: { visibility: 'public' },
    environment: {
      protection_rules: [{
        ...protectedEnvironment.protection_rules[0],
        prevent_self_review: true,
      }],
    },
    reviewerLogin: 'aj-maz',
  }), /Self-review must remain enabled/)
})
