import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  DEFAULT_ENVIRONMENT,
  OFFICIAL_ENVIRONMENTS,
  readUserConfig,
  resolveEnvironment,
} from '../dist/config.js'

test('fresh installs default to the built-in production environment', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'slopz-cli-config-'))
  const previous = process.env.SLOPZ_CONFIG_PATH
  process.env.SLOPZ_CONFIG_PATH = join(directory, 'config.json')
  try {
    const config = await readUserConfig()
    assert.equal(DEFAULT_ENVIRONMENT, 'production')
    assert.equal(config.defaultEnvironment, 'production')
    assert.deepEqual(config.environments, {})
    assert.deepEqual(await resolveEnvironment('production'), OFFICIAL_ENVIRONMENTS.production)
    assert.deepEqual(await resolveEnvironment('staging'), OFFICIAL_ENVIRONMENTS.staging)
  } finally {
    if (previous === undefined) delete process.env.SLOPZ_CONFIG_PATH
    else process.env.SLOPZ_CONFIG_PATH = previous
    await rm(directory, { recursive: true, force: true })
  }
})
