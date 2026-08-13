import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apiSlots, readSlotManifest } from '../dist/slots.js'

async function fixture(value) {
  const directory = await mkdtemp(join(tmpdir(), 'slopz-cli-slots-'))
  await writeFile(join(directory, 'slopz.slots.json'), `${JSON.stringify(value)}\n`)
  return { directory, close: () => rm(directory, { recursive: true, force: true }) }
}

test('normalizes placement and rental sections for the API', async () => {
  const temporary = await fixture({
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
        offers: [{ key: 'week', duration: '7d', price: '20' }],
      },
    }],
  })
  try {
    const manifest = await readSlotManifest(temporary.directory)
    assert.deepEqual(apiSlots(manifest), [{
      key: 'billboard',
      label: 'Arena billboard',
      placement: 'Beside the starting line',
      width: 720,
      height: 500,
      maxFileSize: 1024 * 1024,
      allowAnimated: false,
      contentRules: 'No fake giveaways, malware, impersonation, gore, or deceptive wallet prompts.',
      approvalMode: 'manual',
      offers: [{ key: 'week', durationSeconds: 604_800, priceAmount: '20' }],
    }])
  } finally {
    await temporary.close()
  }
})

test('normalizes automatic screening for an ordinary developer manifest', async () => {
  const temporary = await fixture({
    version: 1,
    slots: [{
      key: 'billboard',
      placement: { label: 'Billboard', description: 'Arena wall', width: 720, height: 500 },
      rental: { approval: 'automatic', offers: [{ key: 'day', duration: '1d', price: '5' }] },
    }],
  })
  try {
    const manifest = await readSlotManifest(temporary.directory)
    assert.equal(apiSlots(manifest)[0].approvalMode, 'automatic')
  } finally {
    await temporary.close()
  }
})

test('rejects automatic screening for animated creatives', async () => {
  const temporary = await fixture({
    version: 1,
    slots: [{
      key: 'billboard',
      placement: { label: 'Billboard', description: 'Arena wall', width: 720, height: 500, allowAnimated: true },
      rental: { approval: 'automatic', offers: [{ key: 'day', duration: '1d', price: '5' }] },
    }],
  })
  try {
    await assert.rejects(() => readSlotManifest(temporary.directory), /cannot combine automatic approval with animated creatives/)
  } finally {
    await temporary.close()
  }
})
