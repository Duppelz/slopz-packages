import {
  SlopzSdkError,
  type SlopzAd,
  type SlopzAdBooking,
  type SlopzAdPaymentIntent,
  type SlopzAdSlot,
  type SlopzGameDraft,
  type SlopzGameDraftContent,
  type SlopzGameDraftMedia,
  type SlopzGameDraftMediaRole,
  type SlopzGameDraftPage,
  type SlopzGameRuntime,
  type SlopzLeaderboard,
  type SlopzMetadataSource,
  type SlopzMetadataUploadRole,
  type SlopzOwnedGame,
  type SlopzPlayer,
  type SlopzPreparedGameMetadata,
  type SlopzPublishedGamePage,
  type SlopzProvider,
  type SlopzRun,
  type SlopzRentPage,
  type SlopzScoreResult,
  type SlopzUniversalProfile,
} from './types.js'

type ApiEnvelope<T> = { ok: true } & T

function shortAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`
}

export class SlopzApiClient {
  readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  private async post<T>(path: string, payload: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body: unknown = await response.json().catch(() => null)
    if (!body || typeof body !== 'object') throw new SlopzSdkError('INVALID_API_RESPONSE')
    const envelope = body as { ok?: boolean; error?: string }
    if (!response.ok || envelope.ok !== true) {
      throw new SlopzSdkError(envelope.error ?? `HTTP_${response.status}`)
    }
    return body as T
  }

  async createChallenge(args: {
    profileAddress: string
    purpose: 'platform' | 'game'
    gameId?: string
    origin: string
  }): Promise<{ challengeId: string; message: string; expiresAt: number }> {
    return this.post<ApiEnvelope<{
      challengeId: string
      message: string
      expiresAt: number
    }>>('/auth/challenge', args)
  }

  async verifyChallenge(challengeId: string, signature: string): Promise<{
    sessionToken: string
    profileAddress: string
    profile: SlopzUniversalProfile | null
    expiresAt: number
    gameId?: string
  }> {
    return this.post<ApiEnvelope<{
      sessionToken: string
      profileAddress: string
      profile: SlopzUniversalProfile | null
      expiresAt: number
      gameId?: string
    }>>('/auth/verify', { challengeId, signature })
  }

  async validateSession(sessionToken: string): Promise<{
    sessionId: string
    profileAddress: string
    profile: SlopzUniversalProfile | null
    purpose: 'platform' | 'game'
    gameId?: string
    expiresAt: number
  } | null> {
    const response = await this.post<ApiEnvelope<{ session: {
      sessionId: string
      profileAddress: string
      profile: SlopzUniversalProfile | null
      purpose: 'platform' | 'game'
      gameId?: string
      expiresAt: number
    } | null }>>('/auth/session', { sessionToken })
    return response.session
  }

  async revokeSession(sessionToken: string): Promise<void> {
    await this.post<ApiEnvelope<Record<string, never>>>('/auth/revoke', { sessionToken })
  }

  async authorizeCli(args: {
    sessionToken: string
    codeChallenge: string
    redirectUri: string
    clientName?: string
  }): Promise<{ code: string; redirectUri: string; profileAddress: string; expiresAt: number }> {
    return this.post<ApiEnvelope<{
      code: string
      redirectUri: string
      profileAddress: string
      expiresAt: number
    }>>('/cli/authorize', args)
  }

  async signInWithProvider(args: {
    provider: SlopzProvider
    purpose: 'platform' | 'game'
    gameId?: string
    origin: string
  }): Promise<{ sessionToken: string; player: SlopzPlayer; expiresAt: number }> {
    const accounts = await args.provider.request({ method: 'eth_requestAccounts' })
    if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') throw new SlopzSdkError('NO_UP_ACCOUNT')
    const profileAddress = accounts[0]
    const challenge = await this.createChallenge({
      profileAddress,
      purpose: args.purpose,
      gameId: args.gameId,
      origin: args.origin,
    })
    let signature: unknown
    try {
      signature = await args.provider.request({
        method: 'personal_sign',
        params: [challenge.message, profileAddress],
      })
    } catch {
      signature = await args.provider.request({
        method: 'eth_sign',
        params: [profileAddress, challenge.message],
      })
    }
    if (typeof signature !== 'string') throw new SlopzSdkError('INVALID_UP_SIGNATURE')
    const session = await this.verifyChallenge(challenge.challengeId, signature)
    return {
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,
      player: {
        connected: true,
        profileAddress: session.profileAddress,
        displayName: session.profile?.name ?? shortAddress(session.profileAddress),
        profile: session.profile,
      },
    }
  }

  async resolveUniversalProfiles(addresses: readonly string[]): Promise<readonly (SlopzUniversalProfile | null)[]> {
    const response = await this.post<ApiEnvelope<{
      profiles: readonly (SlopzUniversalProfile | null)[]
    }>>('/profiles/resolve', { addresses })
    return response.profiles
  }

  async createGameDraft(args: {
    sessionToken: string
    title: string
    pitch: string
  }): Promise<SlopzGameDraft> {
    const response = await this.post<ApiEnvelope<{ game: SlopzGameDraft }>>('/games/drafts', args)
    return response.game
  }

  async saveGameRuntime(args: {
    sessionToken: string
    gameId: string
    runtimeId: string
    entryUrl: string
  }): Promise<SlopzGameRuntime> {
    const response = await this.post<ApiEnvelope<{ runtime: SlopzGameRuntime }>>('/games/runtime', args)
    return response.runtime
  }

  async saveGameDraftContent(args: {
    sessionToken: string
    gameId: string
    content: SlopzGameDraftContent
  }): Promise<{ gameId: string; slug: string; status: 'draft' }> {
    const response = await this.post<ApiEnvelope<{
      game: { gameId: string; slug: string; status: 'draft' }
    }>>('/games/draft-content', args)
    return response.game
  }

  async readGameDraftPage(args: { sessionToken: string; slug: string }): Promise<SlopzGameDraftPage | null> {
    const response = await this.post<ApiEnvelope<{ draft: SlopzGameDraftPage | null }>>('/games/draft-page', args)
    return response.draft
  }

  async uploadGameDraftMedia(args: {
    sessionToken: string
    gameId: string
    mediaId: string
    role: SlopzGameDraftMediaRole
    file: File
    width: number
    height: number
  }): Promise<SlopzGameDraftMedia> {
    const signed = await this.post<ApiEnvelope<{ uploadUrl: string }>>('/games/draft-media/upload-url', {
      sessionToken: args.sessionToken,
      gameId: args.gameId,
    })
    const uploadResponse = await fetch(signed.uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': args.file.type },
      body: args.file,
    })
    const uploaded: unknown = await uploadResponse.json().catch(() => null)
    const storageId = uploaded && typeof uploaded === 'object'
      ? (uploaded as { storageId?: unknown }).storageId
      : null
    if (!uploadResponse.ok || typeof storageId !== 'string') throw new SlopzSdkError('DRAFT_MEDIA_UPLOAD_FAILED')
    const response = await this.post<ApiEnvelope<{ media: SlopzGameDraftMedia }>>('/games/draft-media/commit', {
      sessionToken: args.sessionToken,
      gameId: args.gameId,
      mediaId: args.mediaId,
      role: args.role,
      storageId,
      fileName: args.file.name,
      width: args.width,
      height: args.height,
    })
    return response.media
  }

  async removeGameDraftMedia(args: { sessionToken: string; gameId: string; mediaId: string }): Promise<void> {
    await this.post<ApiEnvelope<Record<string, never>>>('/games/draft-media/remove', args)
  }

  async downloadGameDraftMedia(args: { sessionToken: string; gameId: string; mediaId: string }): Promise<File> {
    const response = await this.post<ApiEnvelope<{ media: { url: string; fileName: string; contentType: string } }>>(
      '/games/draft-media/url',
      args,
    )
    const fileResponse = await fetch(response.media.url)
    if (!fileResponse.ok) throw new SlopzSdkError('DRAFT_MEDIA_DOWNLOAD_FAILED')
    return new File([await fileResponse.blob()], response.media.fileName, { type: response.media.contentType })
  }

  async publishGame(args: {
    sessionToken: string
    gameId: string
    txHash: `0x${string}`
  }): Promise<{ gameId: string; clientId: string; slug: string }> {
    const response = await this.post<ApiEnvelope<{
      game: { gameId: string; clientId: string; slug: string }
    }>>('/games/publish', args)
    return response.game
  }

  async readGamePage(args: { slug: string }): Promise<SlopzPublishedGamePage | null> {
    const response = await this.post<ApiEnvelope<{ game: SlopzPublishedGamePage | null }>>('/games/page', args)
    return response.game
  }

  async listPublishedGames(): Promise<readonly SlopzPublishedGamePage[]> {
    const response = await this.post<ApiEnvelope<{ games: readonly SlopzPublishedGamePage[] }>>('/games/catalog', {})
    return response.games
  }

  async heartbeatGamePresence(args: { gameId: string; presenceId: string }): Promise<{ playCount: number; livePlayers: number }> {
    const response = await this.post<ApiEnvelope<{ metrics: { playCount: number; livePlayers: number } }>>('/games/presence', args)
    return response.metrics
  }

  async listOwnedGames(args: { sessionToken: string }): Promise<readonly SlopzOwnedGame[]> {
    const response = await this.post<ApiEnvelope<{ games: readonly SlopzOwnedGame[] }>>('/games/owned', args)
    return response.games
  }

  async updateOwnedGameListing(args: {
    sessionToken: string
    gameId: string
    title: string
    pitch: string
    description: string
  }): Promise<{ gameId: string; slug: string; title: string; pitch: string; description: string }> {
    const response = await this.post<ApiEnvelope<{ game: {
      gameId: string
      slug: string
      title: string
      pitch: string
      description: string
    } }>>('/games/listing', args)
    return response.game
  }

  async beginGamePublishPreparation(args: {
    sessionToken: string
    gameId: string
    runtimeId: string
  }): Promise<{ gameId: string; status: 'ready' }> {
    const response = await this.post<ApiEnvelope<{
      game: { gameId: string; status: 'ready' }
    }>>('/games/prepare-publish', args)
    return response.game
  }

  async uploadMetadataSource(args: {
    sessionToken: string
    gameId: string
    role: SlopzMetadataUploadRole
    file: File
    width: number
    height: number
  }): Promise<SlopzMetadataSource> {
    const signed = await this.post<ApiEnvelope<{ uploadId: string; uploadUrl: string }>>('/metadata/upload-url', {
      sessionToken: args.sessionToken,
      gameId: args.gameId,
      role: args.role,
      fileName: args.file.name,
      contentType: args.file.type,
      size: args.file.size,
      width: args.width,
      height: args.height,
    })
    const form = new FormData()
    form.set('network', 'public')
    form.set('file', args.file)
    const uploadResponse = await fetch(signed.uploadUrl, { method: 'POST', body: form })
    const uploaded: unknown = await uploadResponse.json().catch(() => null)
    const data = uploaded && typeof uploaded === 'object'
      ? (uploaded as { data?: { id?: unknown; cid?: unknown } }).data
      : null
    if (!uploadResponse.ok || typeof data?.id !== 'string' || typeof data.cid !== 'string') {
      throw new SlopzSdkError('METADATA_UPLOAD_FAILED')
    }
    return {
      uploadId: signed.uploadId,
      cid: data.cid,
      ipfsUri: `ipfs://${data.cid}`,
      pinataFileId: data.id,
      width: args.width,
      height: args.height,
    }
  }

  async prepareGameMetadata(args: {
    sessionToken: string
    gameId: string
    game: {
      title: string
      description: string
      canonicalUrl: string
      tags: readonly string[]
      links: readonly { title: string; url: string }[]
    }
    coin: {
      name: string
      description: string
      links: readonly { title: string; url: string }[]
    }
    sources: {
      gameIcon: readonly Pick<SlopzMetadataSource, 'uploadId' | 'cid' | 'width' | 'height'>[]
      cover: readonly Pick<SlopzMetadataSource, 'uploadId' | 'cid' | 'width' | 'height'>[]
      screenshots: readonly (readonly Pick<SlopzMetadataSource, 'uploadId' | 'cid' | 'width' | 'height'>[])[]
      coinIcon: readonly Pick<SlopzMetadataSource, 'uploadId' | 'cid' | 'width' | 'height'>[]
    }
  }): Promise<SlopzPreparedGameMetadata> {
    const response = await this.post<ApiEnvelope<{ metadata: SlopzPreparedGameMetadata }>>('/metadata/prepare', args)
    return response.metadata
  }

  async listAdSlots(gameId: string): Promise<readonly SlopzAdSlot[]> {
    const response = await this.post<ApiEnvelope<{ slots: readonly SlopzAdSlot[] }>>('/ads/slots', { gameId })
    return response.slots
  }

  async readRentPage(slug: string): Promise<SlopzRentPage> {
    const response = await this.post<ApiEnvelope<{ rent: SlopzRentPage }>>('/ads/rent', { slug })
    return response.rent
  }

  async prepareAdPayment(args: {
    sessionToken: string
    gameId: string
    slotKey: string
    offerKey: string
    file: File
    destinationUrl: string
    altText: string
  }): Promise<SlopzAdPaymentIntent> {
    const upload = await this.post<ApiEnvelope<{ uploadUrl: string }>>('/ads/upload-url', {
      sessionToken: args.sessionToken,
      gameId: args.gameId,
      slotKey: args.slotKey,
    })
    const uploadResponse = await fetch(upload.uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': args.file.type },
      body: args.file,
    })
    const uploaded: unknown = await uploadResponse.json().catch(() => null)
    const storageId = uploaded && typeof uploaded === 'object'
      ? (uploaded as { storageId?: unknown }).storageId
      : null
    if (!uploadResponse.ok || typeof storageId !== 'string') throw new SlopzSdkError('AD_UPLOAD_FAILED')
    const response = await this.post<ApiEnvelope<{ booking: SlopzAdPaymentIntent }>>('/ads/prepare', {
      sessionToken: args.sessionToken,
      gameId: args.gameId,
      slotKey: args.slotKey,
      offerKey: args.offerKey,
      imageStorageId: storageId,
      destinationUrl: args.destinationUrl,
      altText: args.altText,
    })
    return response.booking
  }

  async confirmAdPayment(args: {
    sessionToken: string
    bookingId: string
    txHash: string
  }): Promise<SlopzAdBooking> {
    const response = await this.post<ApiEnvelope<{ booking: SlopzAdBooking }>>('/ads/confirm-payment', args)
    return response.booking
  }

  async getAd(gameId: string, slotKey: string): Promise<SlopzAd | null> {
    const response = await this.post<ApiEnvelope<{ ad: SlopzAd | null }>>('/ads/current', { gameId, slotKey })
    return response.ad
  }

  async getDraftAd(args: { sessionToken: string; gameId: string; slotKey: string }): Promise<SlopzAd | null> {
    const response = await this.post<ApiEnvelope<{ ad: SlopzAd | null }>>('/ads/draft-preview', args)
    return response.ad
  }

  async uploadDraftAdPreview(args: {
    sessionToken: string
    gameId: string
    slotKey: string
    file: File
    altText: string
  }): Promise<void> {
    const upload = await this.post<ApiEnvelope<{ uploadUrl: string }>>('/ads/draft-preview/upload-url', {
      sessionToken: args.sessionToken,
      gameId: args.gameId,
      slotKey: args.slotKey,
    })
    const uploadResponse = await fetch(upload.uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': args.file.type },
      body: args.file,
    })
    const uploaded: unknown = await uploadResponse.json().catch(() => null)
    const storageId = uploaded && typeof uploaded === 'object'
      ? (uploaded as { storageId?: unknown }).storageId
      : null
    if (!uploadResponse.ok || typeof storageId !== 'string') throw new SlopzSdkError('AD_UPLOAD_FAILED')
    await this.post<ApiEnvelope<Record<string, never>>>('/ads/draft-preview/set', {
      sessionToken: args.sessionToken,
      gameId: args.gameId,
      slotKey: args.slotKey,
      imageStorageId: storageId,
      altText: args.altText,
    })
  }

  async beginRun(args: { gameId: string; boardKey: string; build: string; sessionToken?: string }): Promise<SlopzRun> {
    const response = await this.post<ApiEnvelope<{
      runToken: string
      runId: string
      expiresAt: number
    }>>('/runs/begin', args)
    return { ...response, gameId: args.gameId, boardKey: args.boardKey }
  }

  async submitScore(args: { sessionToken: string; runToken: string; score: number }): Promise<SlopzScoreResult> {
    const response = await this.post<ApiEnvelope<{ result: SlopzScoreResult }>>('/scores/submit', args)
    return response.result
  }

  async listLeaderboard(args: { gameId: string; boardKey: string; limit?: number; sessionToken?: string }): Promise<SlopzLeaderboard> {
    const response = await this.post<ApiEnvelope<{ leaderboard: SlopzLeaderboard }>>('/leaderboards/list', args)
    return response.leaderboard
  }
}
