import {
  SLOPZ_PROTOCOL_VERSION,
  type SlopzConnectMessage,
  type SlopzHostRequest,
  type SlopzHostResponse,
} from './protocol.js'
import {
  SlopzSdkError,
  type SlopzAd,
  type SlopzAdSlotDefinition,
  type SlopzAdSlotDefinitionResult,
  type SlopzAdMount,
  type SlopzAdMountOptions,
  type SlopzAdWatch,
  type SlopzAdWatchOptions,
  type SlopzGameOptions,
  type SlopzLeaderboard,
  type SlopzPlayer,
  type SlopzRun,
  type SlopzScoreResult,
} from './types.js'

type PendingRequest = {
  resolve(value: unknown): void
  reject(error: Error): void
  timeout: number
}

function currentOption(name: string): string | undefined {
  if (typeof window === 'undefined') return undefined
  return new URL(window.location.href).searchParams.get(name) ?? undefined
}

export class SlopzGameClient {
  readonly gameId: string
  readonly clientId?: string
  private readonly build: string
  private readonly parentOrigin?: string
  private readonly pending = new Map<string, PendingRequest>()
  private readonly adMounts = new Set<SlopzAdMount>()
  private readonly adWatches = new Set<SlopzAdWatch>()
  private readonly nonce = crypto.randomUUID()
  private announceTimer: number | null = null
  private port: MessagePort | null = null
  private readonly listener: (event: MessageEvent) => void

  constructor(options: SlopzGameOptions) {
    this.gameId = options.gameId ?? currentOption('slopzGameId') ?? ''
    this.clientId = options.clientId ?? currentOption('slopzClientId')
    this.build = options.build ?? 'unknown'
    this.parentOrigin = options.parentOrigin ?? currentOption('slopzParentOrigin')
    this.listener = (event) => this.onWindowMessage(event)
    window.addEventListener('message', this.listener)
    this.announce()
    if (window.parent !== window && this.parentOrigin) {
      this.announceTimer = window.setInterval(() => this.announce(), 500)
    }
  }

  private announce(): void {
    if (window.parent === window || !this.parentOrigin || !this.gameId) return
    window.parent.postMessage(
      {
        source: 'slopz-game',
        type: 'slopz:ready',
        version: SLOPZ_PROTOCOL_VERSION,
        gameId: this.gameId,
        nonce: this.nonce,
      },
      this.parentOrigin,
    )
  }

  private onWindowMessage(event: MessageEvent): void {
    if (!this.parentOrigin || event.origin !== this.parentOrigin || event.source !== window.parent) return
    const message = event.data as Partial<SlopzConnectMessage> | undefined
    if (!message || message.source !== 'slopz-host' || message.type !== 'slopz:connect') return
    if (message.version !== SLOPZ_PROTOCOL_VERSION || message.gameId !== this.gameId || message.nonce !== this.nonce) return
    const port = event.ports[0]
    if (!port) return
    this.port?.close()
    this.port = port
    if (this.announceTimer !== null) {
      window.clearInterval(this.announceTimer)
      this.announceTimer = null
    }
    this.port.onmessage = (portEvent) => this.onPortMessage(portEvent)
    this.port.start()
  }

  private onPortMessage(event: MessageEvent): void {
    const response = event.data as Partial<SlopzHostResponse> | undefined
    if (!response || response.type !== 'slopz:response' || typeof response.requestId !== 'string') return
    const pending = this.pending.get(response.requestId)
    if (!pending) return
    window.clearTimeout(pending.timeout)
    this.pending.delete(response.requestId)
    if (response.error) pending.reject(new SlopzSdkError(response.error))
    else pending.resolve(response.result)
  }

  private async hostRequest<T>(method: SlopzHostRequest['method'], payload: Record<string, unknown>): Promise<T> {
    if (!this.port) throw new SlopzSdkError('SLOPZ_HOST_UNAVAILABLE')
    const requestId = crypto.randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(requestId)
        reject(new SlopzSdkError('SLOPZ_HOST_TIMEOUT'))
      }, 10_000)
      this.pending.set(requestId, { resolve: (value) => resolve(value as T), reject, timeout })
      this.port!.postMessage({ type: 'slopz:request', requestId, method, payload } satisfies SlopzHostRequest)
    })
  }

  async getPlayer(): Promise<SlopzPlayer> {
    return this.hostRequest('get-player', {})
  }

  async signIn(): Promise<SlopzPlayer> {
    return this.hostRequest('sign-in', {})
  }

  async beginRun(boardKey = 'high-score'): Promise<SlopzRun> {
    return this.hostRequest('begin-run', { boardKey, build: this.build })
  }

  async submitScore(args: { run: SlopzRun; score: number; signInIfNeeded?: boolean }): Promise<SlopzScoreResult> {
    try {
      return await this.hostRequest('submit-score', { runToken: args.run.runToken, score: args.score })
    } catch (error) {
      if (!(error instanceof SlopzSdkError) || error.code !== 'AUTH_REQUIRED' || args.signInIfNeeded === false) throw error
      await this.signIn()
      return this.hostRequest('submit-score', { runToken: args.run.runToken, score: args.score })
    }
  }

  async listLeaderboard(boardKey = 'high-score', limit = 20): Promise<SlopzLeaderboard> {
    return this.hostRequest('list-leaderboard', { boardKey, limit })
  }

  /**
   * @deprecated Runtime declarations are discovery-only and are no longer
   * persisted. Submit the reviewed repository manifest with `slopz slots sync`.
   */
  async defineAdSlots(slots: readonly SlopzAdSlotDefinition[]): Promise<SlopzAdSlotDefinitionResult> {
    const deadline = Date.now() + 10_000
    while (true) {
      try {
        return await this.hostRequest('define-ad-slots', { slots })
      } catch (error) {
        if (!(error instanceof SlopzSdkError) || error.code !== 'SLOPZ_HOST_UNAVAILABLE' || Date.now() >= deadline) throw error
        await new Promise((resolve) => window.setTimeout(resolve, 250))
      }
    }
  }

  async getAd(slotKey: string): Promise<SlopzAd | null> {
    return this.hostRequest('get-ad', { slotKey })
  }

  async mountAd(options: SlopzAdMountOptions): Promise<SlopzAdMount> {
    const container = typeof options.container === 'string'
      ? document.querySelector(options.container)
      : options.container
    if (!container) throw new SlopzSdkError('AD_CONTAINER_NOT_FOUND')
    const refreshIntervalMs = Math.max(15_000, options.refreshIntervalMs ?? 30_000)
    let destroyed = false
    let retryTimeout: number | null = null

    const refresh = async (): Promise<SlopzAd | null> => {
      const ad = await this.getAd(options.slotKey)
      if (destroyed) return ad
      container.replaceChildren()
      container.setAttribute('data-slopz-ad-state', ad ? 'live' : 'empty')
      if (!ad) {
        container.setAttribute('hidden', '')
        return null
      }
      container.removeAttribute('hidden')
      const image = document.createElement('img')
      image.src = ad.imageUrl
      image.alt = ad.altText
      image.width = ad.width
      image.height = ad.height
      image.loading = 'eager'
      image.decoding = 'async'
      image.className = 'slopz-sdk-ad-image'
      if (ad.source === 'draft-preview') {
        container.setAttribute('data-slopz-ad-state', 'draft-preview')
        container.append(image)
      } else {
        const link = document.createElement('a')
        link.href = ad.destinationUrl
        link.target = '_blank'
        link.rel = 'noopener noreferrer sponsored'
        link.className = 'slopz-sdk-ad-link'
        link.setAttribute('aria-label', `Sponsored: ${ad.altText}`)
        link.append(image)
        container.append(link)
      }
      return ad
    }

    const interval = window.setInterval(() => void refresh().catch(() => undefined), refreshIntervalMs)
    const mount: SlopzAdMount = {
      refresh,
      destroy: () => {
        if (destroyed) return
        destroyed = true
        window.clearInterval(interval)
        if (retryTimeout !== null) window.clearTimeout(retryTimeout)
        container.replaceChildren()
        container.setAttribute('hidden', '')
        this.adMounts.delete(mount)
      },
    }
    this.adMounts.add(mount)
    try {
      await refresh()
    } catch {
      container.setAttribute('hidden', '')
      container.setAttribute('data-slopz-ad-state', 'connecting')
      retryTimeout = window.setTimeout(() => void refresh().catch(() => undefined), 750)
    }
    return mount
  }

  async watchAd(options: SlopzAdWatchOptions): Promise<SlopzAdWatch> {
    const refreshIntervalMs = Math.max(15_000, options.refreshIntervalMs ?? 30_000)
    let destroyed = false
    let retryTimeout: number | null = null
    let lastIdentity: string | null | undefined

    const refresh = async (): Promise<SlopzAd | null> => {
      const ad = await this.getAd(options.slotKey)
      if (destroyed) return ad
      const identity = ad ? `${ad.bookingId}:${ad.imageUrl}:${ad.endsAt}` : null
      if (identity !== lastIdentity) {
        lastIdentity = identity
        options.onChange(ad)
      }
      return ad
    }

    const interval = window.setInterval(() => void refresh().catch(() => undefined), refreshIntervalMs)
    const watch: SlopzAdWatch = {
      refresh,
      destroy: () => {
        if (destroyed) return
        destroyed = true
        window.clearInterval(interval)
        if (retryTimeout !== null) window.clearTimeout(retryTimeout)
        this.adWatches.delete(watch)
      },
    }
    this.adWatches.add(watch)
    try {
      await refresh()
    } catch {
      retryTimeout = window.setTimeout(() => void refresh().catch(() => undefined), 750)
    }
    return watch
  }

  dispose(): void {
    window.removeEventListener('message', this.listener)
    if (this.announceTimer !== null) window.clearInterval(this.announceTimer)
    this.port?.close()
    for (const mount of [...this.adMounts]) mount.destroy()
    for (const watch of [...this.adWatches]) watch.destroy()
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeout)
      pending.reject(new SlopzSdkError('SLOPZ_SDK_DISPOSED'))
    }
    this.pending.clear()
  }
}

export function createSlopzGame(options: SlopzGameOptions = {}): SlopzGameClient {
  return new SlopzGameClient(options)
}

export { SlopzApiClient } from './api.js'
export { SlopzSdkError } from './types.js'
export type {
  SlopzAd,
  SlopzAdBooking,
  SlopzAdPaymentIntent,
  SlopzAdSlotDefinition,
  SlopzAdSlotDefinitionResult,
  SlopzAdMount,
  SlopzAdMountOptions,
  SlopzAdWatch,
  SlopzAdWatchOptions,
  SlopzAdSlot,
  SlopzEconomyDeployment,
  SlopzGameDraft,
  SlopzGameDraftContent,
  SlopzGameDraftMedia,
  SlopzGameDraftMediaRole,
  SlopzGameDraftPage,
  SlopzGameOptions,
  SlopzGameRuntime,
  SlopzLeaderboard,
  SlopzLeaderboardEntry,
  SlopzMetadataSource,
  SlopzMetadataUploadRole,
  SlopzOwnedGame,
  SlopzPlayer,
  SlopzPreparedDocument,
  SlopzPreparedGameMetadata,
  SlopzPublishedGamePage,
  SlopzProvider,
  SlopzRun,
  SlopzRentPage,
  SlopzScheduledAd,
  SlopzScoreResult,
  SlopzUniversalProfile,
  SlopzVerifiedImage,
} from './types.js'
