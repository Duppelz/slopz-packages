import { post } from './api.js'
import type { EnvironmentConfig, ProjectEnvironment } from './config.js'
import type { LoadedGameManifest, PreparedManifestMedia } from './manifest.js'

type ApiPost = <T>(baseUrl: string, path: string, body: Record<string, unknown>) => Promise<T>
type Upload = (uploadUrl: string, media: PreparedManifestMedia) => Promise<string>

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

type UploadedMedia = {
  mediaId: string
  role: PreparedManifestMedia['role']
  fileName: string
  width: number
  height: number
  size: number
}

type CommittedMedia = {
  mediaId: string
  size: number
  width: number
  height: number
}

export type ApplyDraftResult = {
  environment: string
  gameId: string
  canonicalUrl: string
  runtime: Runtime
  media: UploadedMedia[]
  content: {
    title: string
    pitch: string
    description: string
    engineTags: string[]
    genreTags: string[]
    coinName: string
    coinSymbol: string
    screenshotCount: number
  }
  next: { action: 'review-and-publish-in-app'; url: string }
}

async function uploadToSignedUrl(uploadUrl: string, media: PreparedManifestMedia): Promise<string> {
  const body = media.bytes.buffer.slice(
    media.bytes.byteOffset,
    media.bytes.byteOffset + media.bytes.byteLength,
  ) as ArrayBuffer
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'image/webp' },
    body,
  })
  const result: unknown = await response.json().catch(() => null)
  const storageId = result && typeof result === 'object' ? (result as { storageId?: unknown }).storageId : null
  if (!response.ok || typeof storageId !== 'string') throw new Error(`Could not upload ${media.fileName}.`)
  return storageId
}

function mediaId(gameId: string, media: PreparedManifestMedia, index?: number): string {
  const suffix = media.role === 'screenshot' ? `screenshot_${(index ?? 0) + 1}` : media.role.replace('-', '_')
  return `${gameId}_${suffix}`
}

async function saveMedia(args: {
  baseUrl: string
  cliToken: string
  gameId: string
  media: PreparedManifestMedia
  request: ApiPost
  upload: Upload
  index?: number
}): Promise<UploadedMedia> {
  const id = mediaId(args.gameId, args.media, args.index)
  const signed = await args.request<{ ok: true; uploadUrl: string }>(args.baseUrl, '/cli/games/draft-media/upload-url', {
    cliToken: args.cliToken,
    gameId: args.gameId,
  })
  const storageId = await args.upload(signed.uploadUrl, args.media)
  const committed = await args.request<{ ok: true; media: CommittedMedia }>(args.baseUrl, '/cli/games/draft-media/commit', {
    cliToken: args.cliToken,
    gameId: args.gameId,
    mediaId: id,
    role: args.media.role,
    storageId,
    fileName: args.media.fileName,
    width: args.media.width,
    height: args.media.height,
  })
  return {
    mediaId: committed.media.mediaId,
    role: args.media.role,
    fileName: args.media.fileName,
    width: committed.media.width,
    height: committed.media.height,
    size: committed.media.size,
  }
}

export async function applyProjectDraft(args: {
  environmentName: string
  environment: EnvironmentConfig & { cliToken: string }
  project: ProjectEnvironment
  loaded: LoadedGameManifest
  gameUrl?: string
  request?: ApiPost
  upload?: Upload
}): Promise<ApplyDraftResult> {
  const request = args.request ?? post
  const upload = args.upload ?? uploadToSignedUrl
  const manifest = args.loaded.manifest
  const entryUrl = args.gameUrl ?? manifest.runtime.entryUrl
  const runtimeResult = await request<{ ok: true; runtime: Runtime }>(args.environment.apiUrl, '/cli/games/runtime-url', {
    cliToken: args.environment.cliToken,
    gameId: args.project.gameId,
    runtimeId: `runtime_${args.project.gameId}_primary`,
    entryUrl,
  })

  const gameIcon = await saveMedia({
    baseUrl: args.environment.apiUrl,
    cliToken: args.environment.cliToken,
    gameId: args.project.gameId,
    media: args.loaded.media.gameIcon,
    request,
    upload,
  })
  const cover = await saveMedia({
    baseUrl: args.environment.apiUrl,
    cliToken: args.environment.cliToken,
    gameId: args.project.gameId,
    media: args.loaded.media.cover,
    request,
    upload,
  })
  const screenshots: UploadedMedia[] = []
  for (const [index, screenshot] of args.loaded.media.screenshots.entries()) {
    screenshots.push(await saveMedia({
      baseUrl: args.environment.apiUrl,
      cliToken: args.environment.cliToken,
      gameId: args.project.gameId,
      media: screenshot,
      request,
      upload,
      index,
    }))
  }
  const coinIcon = args.loaded.media.coinIcon
    ? await saveMedia({
        baseUrl: args.environment.apiUrl,
        cliToken: args.environment.cliToken,
        gameId: args.project.gameId,
        media: args.loaded.media.coinIcon,
        request,
        upload,
      })
    : null

  const content = {
    title: manifest.game.title,
    pitch: manifest.game.pitch,
    description: manifest.game.description,
    entryUrl: runtimeResult.runtime.entryUrl,
    launchMode: manifest.runtime.launchMode,
    engineTags: manifest.game.engineTags,
    genreTags: manifest.game.genreTags,
    profileLinks: manifest.game.links,
    economyDeployment: manifest.coin.economyDeployment,
    coinName: manifest.coin.name,
    coinSymbol: manifest.coin.symbol,
    coinDescription: manifest.coin.description,
    graduationLyx: manifest.coin.graduationLyx,
    curveFeeBps: manifest.coin.curveFeeBps,
    coinIconSameAsGame: manifest.coin.iconSameAsGame,
    coinLinksSameAsGame: manifest.coin.linksSameAsGame,
    coinLinks: manifest.coin.links,
    media: {
      gameIconId: gameIcon.mediaId,
      coverImageId: cover.mediaId,
      screenshotIds: screenshots.map((item) => item.mediaId),
      ...(coinIcon ? { coinIconId: coinIcon.mediaId } : {}),
    },
  }
  await request<{ ok: true; game: { gameId: string; slug: string; status: 'draft' } }>(args.environment.apiUrl, '/cli/games/draft-content', {
    cliToken: args.environment.cliToken,
    gameId: args.project.gameId,
    content,
  })

  const savedMedia = [gameIcon, cover, ...screenshots, ...(coinIcon ? [coinIcon] : [])]
  return {
    environment: args.environmentName,
    gameId: args.project.gameId,
    canonicalUrl: args.project.canonicalUrl,
    runtime: runtimeResult.runtime,
    media: savedMedia,
    content: {
      title: content.title,
      pitch: content.pitch,
      description: content.description,
      engineTags: content.engineTags,
      genreTags: content.genreTags,
      coinName: content.coinName,
      coinSymbol: content.coinSymbol,
      screenshotCount: screenshots.length,
    },
    next: { action: 'review-and-publish-in-app', url: args.project.canonicalUrl },
  }
}
