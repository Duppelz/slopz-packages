#!/usr/bin/env node

import {
  changedFilesBetween,
  createReleasePlan,
  packageDefinitions,
  packageState,
  writeGithubOutputs,
} from './npm-packages.mjs'

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

const selection = argument('--selection', 'auto')
const base = argument('--base', '')
const head = argument('--head', 'HEAD')
const changedFiles = selection === 'auto' ? changedFilesBetween(base, head) : []
const packages = Object.fromEntries(
  Object.keys(packageDefinitions).map((id) => [id, packageState(id, head)]),
)
const plan = createReleasePlan({ changedFiles, selection, packages })

writeGithubOutputs(plan)
process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
