#!/usr/bin/env node

import { verifyReleaseControls } from './release-controls.mjs'

const repositoryName = process.env.GITHUB_REPOSITORY
const token = process.env.GITHUB_TOKEN
const reviewerLogin = process.env.RELEASE_REVIEWER ?? 'aj-maz'
const environmentName = 'package-publishing'

if (!repositoryName || !token) throw new Error('GitHub repository metadata is unavailable.')

async function github(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2026-03-10',
    },
  })
  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status} for ${path}.`)
  }
  return response.json()
}

const repository = await github(`/repos/${repositoryName}`)
const environment = await github(`/repos/${repositoryName}/environments/${environmentName}`)
verifyReleaseControls({ repository, environment, reviewerLogin })
process.stdout.write(`Verified public repository and protected ${environmentName} environment.\n`)
