import assert from 'node:assert/strict'
import test from 'node:test'

import { planFiles } from './plan.mjs'

test('SDK changes do not rebuild the CLI', () => {
  assert.deepEqual(planFiles(['packages/sdk/src/index.ts']), { sdk: true, cli: false })
})

test('CLI changes do not rebuild the SDK', () => {
  assert.deepEqual(planFiles(['packages/cli/src/index.ts']), { sdk: false, cli: true })
})

test('workspace dependency changes validate both packages', () => {
  assert.deepEqual(planFiles(['pnpm-lock.yaml']), { sdk: true, cli: true })
})

test('documentation-only changes do not rebuild packages', () => {
  assert.deepEqual(planFiles(['README.md']), { sdk: false, cli: false })
})
