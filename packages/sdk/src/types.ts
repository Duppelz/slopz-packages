export type SlopzUniversalProfile = {
  readonly address: string
  readonly name?: string
  readonly description?: string
  readonly avatarUrl?: string
  readonly backgroundImageUrl?: string
  readonly tags?: readonly string[]
  readonly links?: readonly { readonly title: string; readonly url: string }[]
  readonly profileUri?: string
  readonly fetchedAt: number
}

export type SlopzPlayer = {
  readonly connected: boolean
  readonly profileAddress?: string
  readonly displayName?: string
  readonly profile?: SlopzUniversalProfile | null
}

export type SlopzRun = {
  readonly runToken: string
  readonly runId: string
  readonly gameId: string
  readonly boardKey: string
  readonly expiresAt: number
}

export type SlopzScoreResult = {
  readonly accepted: boolean
  readonly personalBest: number
  readonly improved: boolean
}

export type SlopzLeaderboardEntry = {
  readonly rank: number
  readonly profileAddress: string
  readonly profile: SlopzUniversalProfile | null
  readonly score: number
  readonly achievedAt: number
}

export type SlopzLeaderboard = {
  readonly board: {
    readonly key: string
    readonly label: string
    readonly season: string
  }
  readonly entries: readonly SlopzLeaderboardEntry[]
}

export type SlopzAdSlot = {
  readonly gameId: string
  readonly key: string
  readonly label: string
  readonly placement: string
  readonly width: number
  readonly height: number
  readonly maxFileSize: number
  readonly allowAnimated: boolean
  readonly contentRules: string
  readonly approvalMode: 'manual' | 'automatic'
  readonly availableFrom?: number
  readonly availableUntil?: number
  readonly offers: readonly {
    readonly key: string
    readonly durationSeconds: number
    readonly priceAmount: string
  }[]
}

/** Complete slot inventory declared by the game build, without platform identity. */
export type SlopzAdSlotDefinition = Omit<SlopzAdSlot, 'gameId'>

export type SlopzAdSlotDefinitionResult = {
  readonly synced: boolean
  readonly changed: boolean
  readonly slotCount: number
}

export type SlopzAd = {
  readonly bookingId: string
  readonly slotKey: string
  readonly imageUrl: string
  readonly destinationUrl: string
  readonly altText: string
  readonly width: number
  readonly height: number
  readonly startsAt: number
  readonly endsAt: number
  readonly source?: 'booking' | 'draft-preview'
}

export type SlopzAdBooking = {
  readonly bookingId: string
  readonly status: 'requested' | 'scheduled' | 'live' | 'completed' | 'rejected' | 'disabled'
  readonly startsAt: number
  readonly endsAt: number
}

export type SlopzMetadataUploadRole = 'game-icon' | 'cover' | 'screenshot' | 'coin-icon'
export type SlopzGameDraftMediaRole = SlopzMetadataUploadRole

export type SlopzGameDraftMedia = {
  readonly mediaId: string
  readonly storageId: string
  readonly url: string
  readonly contentType: string
  readonly size: number
  readonly width: number
  readonly height: number
}

export type SlopzGameDraft = {
  readonly gameId: string
  readonly clientId: string
  readonly slug: string
  readonly canonicalUrl: string
  readonly status: 'draft'
}

export type SlopzGameDraftContent = {
  readonly title: string
  readonly pitch: string
  readonly description: string
  readonly entryUrl: string
  readonly launchMode: 'embedded' | 'external'
  readonly engineTags: readonly string[]
  readonly genreTags: readonly string[]
  readonly profileLinks: readonly { title: string; url: string }[]
  readonly economyDeployment: 'lukso-mainnet-staging'
  readonly coinName: string
  readonly coinSymbol: string
  readonly coinDescription: string
  /** Decimal native-LYX amount that becomes permanent genesis liquidity. */
  readonly graduationLyx: string
  /** Total pre-graduation buy/sell fee in basis points, capped at 1,000. */
  readonly curveFeeBps: number
  readonly coinIconSameAsGame: boolean
  readonly coinLinksSameAsGame: boolean
  readonly coinLinks: readonly { title: string; url: string }[]
  readonly media: {
    readonly gameIconId: string
    readonly coverImageId: string
    readonly screenshotIds: readonly string[]
    readonly coinIconId?: string
  }
}

export type SlopzGameDraftPage = {
  readonly project: SlopzGameDraft
  readonly developerProfileAddress: string
  readonly content: SlopzGameDraftContent
  readonly runtime: SlopzGameRuntime | null
  readonly media: readonly (SlopzGameDraftMedia & {
    readonly role: SlopzGameDraftMediaRole
    readonly fileName: string
  })[]
  readonly metadataStatus?: 'preparing' | 'ready'
}

export type SlopzPublishedGamePage = {
  readonly gameId: string
  readonly clientId: string
  readonly slug: string
  readonly canonicalUrl: string
  readonly developerProfileAddress: string
  readonly title: string
  readonly pitch: string
  readonly description?: string
  readonly content: SlopzGameDraftContent
  readonly coverUrl?: string
  readonly metrics: {
    readonly playCount: number
    readonly livePlayers: number
  }
  readonly runtime: SlopzGameRuntime
  readonly onchain: {
    readonly factoryAddress: string
    readonly gameProfileAddress: string
    readonly keyManagerAddress: string
    readonly tokenAddress: string
    readonly marketAddress: string
    readonly launchConfigHash?: string
    readonly publishTxHash: string
  }
}

export type SlopzOwnedGame = {
  readonly gameId: string
  readonly clientId: string
  readonly slug: string
  readonly title: string
  readonly pitch: string
  readonly description?: string
  readonly canonicalUrl?: string
  readonly coverUrl?: string
  readonly developerProfileAddress: string
  readonly status: 'draft' | 'ready' | 'published' | 'unpublished' | 'delisted'
  readonly content: SlopzGameDraftContent | null
  readonly runtime: SlopzGameRuntime | null
  readonly onchain: SlopzPublishedGamePage['onchain'] | null
  readonly createdAt: number
  readonly updatedAt: number
  readonly publishedAt?: number
}

export type SlopzGameRuntime = {
  readonly runtimeId: string
  readonly source: 'developer_url' | 'slopz_build'
  readonly launchMode: 'embedded' | 'external'
  readonly entryUrl: string
  readonly allowedOrigin: string
  readonly ownershipStatus: 'pending' | 'verified' | 'failed'
  readonly integrationStatus: 'unknown' | 'connected' | 'failed'
  readonly status: 'draft' | 'verified' | 'active' | 'superseded' | 'disabled'
}

export type SlopzMetadataSource = {
  readonly uploadId: string
  readonly cid: string
  readonly ipfsUri: string
  readonly pinataFileId: string
  readonly width: number
  readonly height: number
}

export type SlopzVerifiedImage = {
  readonly width: number
  readonly height: number
  readonly url: string
  readonly verification: {
    readonly method: 'keccak256(bytes)'
    readonly data: `0x${string}`
  }
}

export type SlopzPreparedDocument = {
  /** Exact minified UTF-8 JSON pinned to IPFS and covered by `hash`. */
  readonly json: string
  readonly hash: `0x${string}`
  readonly ipfsUri: string
  /** LSP2 VerifiableURI bytes ready for the Slopz factory call. */
  readonly verifiableUri: `0x${string}`
}

export type SlopzPreparedGameMetadata = {
  readonly lsp3: SlopzPreparedDocument
  readonly lsp4: SlopzPreparedDocument
  readonly media: {
    readonly profileImage: readonly SlopzVerifiedImage[]
    readonly backgroundImage: readonly SlopzVerifiedImage[]
    readonly screenshots: readonly (readonly SlopzVerifiedImage[])[]
    readonly coinIcon: readonly SlopzVerifiedImage[]
  }
}

export type SlopzAdMountOptions = {
  readonly slotKey: string
  readonly container: Element | string
  readonly refreshIntervalMs?: number
}

export type SlopzAdMount = {
  refresh(): Promise<SlopzAd | null>
  destroy(): void
}

export type SlopzAdWatchOptions = {
  readonly slotKey: string
  readonly onChange: (ad: SlopzAd | null) => void
  readonly refreshIntervalMs?: number
}

export type SlopzAdWatch = {
  refresh(): Promise<SlopzAd | null>
  destroy(): void
}

export type SlopzGameOptions = {
  /** Optional when Slopz injects `slopzGameId` into an embedded runtime URL. */
  readonly gameId?: string
  /** Optional when Slopz injects `slopzClientId` into an embedded runtime URL. */
  readonly clientId?: string
  readonly parentOrigin?: string
  readonly build?: string
}

export type SlopzProvider = {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>
}

export class SlopzSdkError extends Error {
  readonly code: string

  constructor(code: string, message = code) {
    super(message)
    this.name = 'SlopzSdkError'
    this.code = code
  }
}
