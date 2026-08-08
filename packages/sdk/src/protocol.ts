export const SLOPZ_PROTOCOL_VERSION = '1.0.0'

export type SlopzHostMethod =
  | 'get-player'
  | 'sign-in'
  | 'begin-run'
  | 'submit-score'
  | 'list-leaderboard'
  | 'define-ad-slots'
  | 'get-ad'

const SLOPZ_HOST_METHODS = new Set<SlopzHostMethod>([
  'get-player',
  'sign-in',
  'begin-run',
  'submit-score',
  'list-leaderboard',
  'define-ad-slots',
  'get-ad',
])

export type SlopzReadyMessage = {
  readonly source: 'slopz-game'
  readonly type: 'slopz:ready'
  readonly version: typeof SLOPZ_PROTOCOL_VERSION
  readonly gameId: string
  readonly nonce: string
}

export type SlopzConnectMessage = {
  readonly source: 'slopz-host'
  readonly type: 'slopz:connect'
  readonly version: typeof SLOPZ_PROTOCOL_VERSION
  readonly gameId: string
  readonly nonce: string
}

export type SlopzHostRequest = {
  readonly type: 'slopz:request'
  readonly requestId: string
  readonly method: SlopzHostMethod
  readonly payload: Record<string, unknown>
}

export type SlopzHostResponse = {
  readonly type: 'slopz:response'
  readonly requestId: string
  readonly result?: unknown
  readonly error?: string
}

export function isReadyMessage(value: unknown): value is SlopzReadyMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<SlopzReadyMessage>
  return message.source === 'slopz-game'
    && message.type === 'slopz:ready'
    && message.version === SLOPZ_PROTOCOL_VERSION
    && typeof message.gameId === 'string'
    && typeof message.nonce === 'string'
}

export function isHostRequest(value: unknown): value is SlopzHostRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<SlopzHostRequest>
  return request.type === 'slopz:request'
    && typeof request.requestId === 'string'
    && SLOPZ_HOST_METHODS.has(request.method as SlopzHostMethod)
    && Boolean(
      request.payload
      && typeof request.payload === 'object'
      && !Array.isArray(request.payload),
    )
}
