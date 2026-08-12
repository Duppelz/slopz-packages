import type { EnvironmentConfig, ProjectEnvironment } from './config.js'
import { readProjectState, writeProjectState } from './config.js'
import { post } from './api.js'
import { apiSlots, readSlotManifest } from './slots.js'

type ApiPost = <T>(baseUrl: string, path: string, body: Record<string, unknown>) => Promise<T>

type CreatedGame = ProjectEnvironment & { status: 'draft' }

type Runtime = {
  runtimeId: string
  source: 'developer_url'
  launchMode: 'embedded'
  entryUrl: string
  allowedOrigin: string
  ownershipStatus: string
  integrationStatus: string
  status: string
}

export type CreateProjectResult = {
  environment: string
  game: CreatedGame
  runtime: Runtime | null
  slotCount: number | null
  next: { action: 'review-and-publish-in-app'; url: string }
}

export async function createProject(args: {
  cwd: string
  environmentName: string
  environment: EnvironmentConfig & { cliToken: string }
  title: string
  pitch: string
  gameUrl?: string
  syncSlots: boolean
  slotFile?: string
  request?: ApiPost
}): Promise<CreateProjectResult> {
  const request = args.request ?? post
  const state = await readProjectState(args.cwd)
  const existingProject = state.environments[args.environmentName]
  if (existingProject) {
    throw new Error(`This directory is already linked to ${existingProject.gameId} in ${args.environmentName}.`)
  }
  const slots = args.syncSlots
    ? apiSlots(await readSlotManifest(args.cwd, args.slotFile ?? 'slopz.slots.json'))
    : null
  const created = await request<{ ok: true; game: CreatedGame }>(args.environment.apiUrl, '/cli/games/drafts', {
    cliToken: args.environment.cliToken,
    title: args.title,
    pitch: args.pitch,
  })
  state.environments[args.environmentName] = {
    gameId: created.game.gameId,
    clientId: created.game.clientId,
    slug: created.game.slug,
    canonicalUrl: created.game.canonicalUrl,
  }
  await writeProjectState(args.cwd, state)

  let runtime: Runtime | null = null
  if (args.gameUrl) {
    const runtimeResult = await request<{ ok: true; runtime: Runtime }>(args.environment.apiUrl, '/cli/games/runtime-url', {
      cliToken: args.environment.cliToken,
      gameId: created.game.gameId,
      runtimeId: `runtime_${created.game.gameId}_primary`,
      entryUrl: args.gameUrl,
    })
    runtime = runtimeResult.runtime
  }

  let slotCount: number | null = null
  if (slots) {
    const synced = await request<{ ok: true; gameId: string; slotCount: number }>(args.environment.apiUrl, '/cli/ads/sync', {
      cliToken: args.environment.cliToken,
      gameId: created.game.gameId,
      slots,
    })
    slotCount = synced.slotCount
  }

  return {
    environment: args.environmentName,
    game: created.game,
    runtime,
    slotCount,
    next: { action: 'review-and-publish-in-app', url: created.game.canonicalUrl },
  }
}
