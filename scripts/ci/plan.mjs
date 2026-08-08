#!/usr/bin/env node

import { appendFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

export function planFiles(files) {
  const shared = files.some((file) =>
    file === 'package.json' ||
    file === 'pnpm-lock.yaml' ||
    file === 'pnpm-workspace.yaml' ||
    file.startsWith('.github/actions/') ||
    file.startsWith('scripts/ci/'))
  return {
    sdk: shared || files.some((file) => file.startsWith('packages/sdk/')),
    cli: shared || files.some((file) => file.startsWith('packages/cli/')),
  }
}

export function changedFiles(base, head) {
  const arguments_ = !base || /^0+$/.test(base)
    ? ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', head]
    : ['diff', '--name-only', '-z', `${base}...${head}`, '--']
  return execFileSync('git', arguments_, { encoding: 'utf8' }).split('\0').filter(Boolean)
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

if (process.argv[1]?.endsWith('/scripts/ci/plan.mjs')) {
  const base = argument('--base', process.env.BASE_SHA ?? '')
  const head = argument('--head', process.env.HEAD_SHA ?? 'HEAD')
  const files = changedFiles(base, head)
  const plan = planFiles(files)
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `sdk=${plan.sdk}\ncli=${plan.cli}\n`)
  }
  process.stdout.write(`${JSON.stringify({ files, ...plan }, null, 2)}\n`)
}
