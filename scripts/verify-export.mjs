#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(repositoryRoot, '.slopz-export.json'), 'utf8'))
const ignoredNames = new Set(['dist', 'node_modules', 'tsconfig.tsbuildinfo'])

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

function filesUnder(root) {
  const files = []
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (ignoredNames.has(entry.name)) continue
      const absolutePath = join(directory, entry.name)
      const path = relative(root, absolutePath).split(sep).join('/')
      const stats = lstatSync(absolutePath)
      assert.equal(stats.isSymbolicLink(), false, `Export contains a symbolic link: ${path}`)
      if (stats.isDirectory()) walk(absolutePath)
      else {
        assert.equal(stats.isFile(), true, `Export contains an unsupported entry: ${path}`)
        files.push(path)
      }
    }
  }
  walk(root)
  return files.sort()
}

assert.equal(manifest.schemaVersion, 1)
assert.deepEqual(Object.keys(manifest.packages).sort(), ['cli', 'sdk'])

for (const id of ['sdk', 'cli']) {
  const packageRoot = join(repositoryRoot, 'packages', id)
  const recorded = manifest.packages[id]
  const actualFiles = filesUnder(packageRoot)
  assert.deepEqual(actualFiles, recorded.files.map(({ path }) => path).sort(), `${id} export file list changed`)
  const verified = recorded.files.map(({ path, sha256: expectedDigest }) => {
    const content = readFileSync(join(packageRoot, path))
    const actualDigest = sha256(content)
    assert.equal(actualDigest, expectedDigest, `${id}/${path} does not match its export digest`)
    return { path, sha256: actualDigest }
  })
  const treeContent = verified.map(({ path, sha256: digest }) => `${path}\0${digest}\n`).join('')
  assert.equal(sha256(treeContent), recorded.sha256, `${id} export tree hash changed`)
}

process.stdout.write('Verified the private-to-public package export manifest.\n')
