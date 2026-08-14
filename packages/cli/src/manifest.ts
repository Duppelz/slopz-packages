import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

export type ManifestLink = {
  title: string
  url: string
}

export type ManifestEconomyDeployment = 'lukso-mainnet-staging' | 'lukso-mainnet-production'

export type GameManifest = {
  version: 1
  game: {
    title: string
    pitch: string
    description: string
    engineTags: string[]
    genreTags: string[]
    links: ManifestLink[]
  }
  runtime: {
    entryUrl: string
    launchMode: 'embedded'
  }
  coin: {
    economyDeployment: ManifestEconomyDeployment
    name: string
    symbol: string
    description: string
    graduationLyx: string
    curveFeeBps: number
    iconSameAsGame: boolean
    linksSameAsGame: boolean
    links: ManifestLink[]
  }
  media: {
    gameIcon: string
    cover: string
    screenshots: string[]
    coinIcon?: string
  }
}

export type MediaRole = 'game-icon' | 'cover' | 'screenshot' | 'coin-icon'

export type PreparedManifestMedia = {
  role: MediaRole
  path: string
  fileName: string
  width: number
  height: number
  size: number
  bytes: Uint8Array
}

export type LoadedGameManifest = {
  path: string
  manifest: GameManifest
  media: {
    gameIcon: PreparedManifestMedia
    cover: PreparedManifestMedia
    screenshots: PreparedManifestMedia[]
    coinIcon?: PreparedManifestMedia
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object.`)
  return value as Record<string, unknown>
}

function keys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key))
  if (extra.length) throw new Error(`${path} contains unknown field${extra.length === 1 ? '' : 's'}: ${extra.join(', ')}.`)
}

function text(value: unknown, path: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} must be a non-empty string.`)
  const normalized = value.trim()
  if (normalized.length > max) throw new Error(`${path} must be at most ${max} characters.`)
  return normalized
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} must be true or false.`)
  return value
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`)
  return value
}

function url(value: unknown, path: string, runtime = false): string {
  const normalized = text(value, path, 2_000)
  if (!runtime && normalized.startsWith('ipfs://') && normalized.length > 'ipfs://'.length) return normalized
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error(`${path} must be a valid URL.`)
  }
  const loopback = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !(runtime && loopback)) {
    throw new Error(`${path} must use HTTPS${runtime ? ' or loopback HTTP' : ', or use an IPFS URI'}.`)
  }
  return parsed.toString().replace(/\/$/, '')
}

function links(value: unknown, path: string): ManifestLink[] {
  const entries = list(value, path)
  if (entries.length > 10) throw new Error(`${path} supports at most 10 links.`)
  return entries.map((entry, index) => {
    const item = record(entry, `${path}[${index}]`)
    keys(item, ['title', 'url'], `${path}[${index}]`)
    return {
      title: text(item.title, `${path}[${index}].title`, 80),
      url: url(item.url, `${path}[${index}].url`),
    }
  })
}

function tags(value: unknown, path: string): string[] {
  const entries = list(value, path)
  if (entries.length > 20) throw new Error(`${path} supports at most 20 tags.`)
  const normalized = entries.map((entry, index) => text(entry, `${path}[${index}]`, 64).toLowerCase())
  for (const tag of normalized) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(tag)) throw new Error(`${path} tags must use lowercase letters, numbers, and hyphens.`)
  }
  if (new Set(normalized).size !== normalized.length) throw new Error(`${path} contains duplicate tags.`)
  return normalized
}

function u24(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)
}

function u32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0)
    | ((bytes[offset + 1] ?? 0) << 8)
    | ((bytes[offset + 2] ?? 0) << 16)
    | ((bytes[offset + 3] ?? 0) << 24)) >>> 0
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

export function webpDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
    throw new Error('must be a WebP image.')
  }
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const chunk = ascii(bytes, offset, 4)
    const size = u32(bytes, offset + 4)
    const data = offset + 8
    if (data + size > bytes.length) throw new Error('contains an invalid WebP chunk.')
    if (chunk === 'VP8X' && size >= 10) {
      return { width: u24(bytes, data + 4) + 1, height: u24(bytes, data + 7) + 1 }
    }
    if (chunk === 'VP8L' && size >= 5 && bytes[data] === 0x2f) {
      const b0 = bytes[data + 1] ?? 0
      const b1 = bytes[data + 2] ?? 0
      const b2 = bytes[data + 3] ?? 0
      const b3 = bytes[data + 4] ?? 0
      return {
        width: 1 + b0 + ((b1 & 0x3f) << 8),
        height: 1 + (b1 >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10),
      }
    }
    if (chunk === 'VP8 ' && size >= 10 && bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
      return {
        width: ((bytes[data + 6] ?? 0) | ((bytes[data + 7] ?? 0) << 8)) & 0x3fff,
        height: ((bytes[data + 8] ?? 0) | ((bytes[data + 9] ?? 0) << 8)) & 0x3fff,
      }
    }
    offset = data + size + (size % 2)
  }
  throw new Error('does not contain readable WebP dimensions.')
}

function validDimensions(role: MediaRole, width: number, height: number, path: string): void {
  if (width < 64 || height < 64) throw new Error(`${path} must be at least 64x64 pixels.`)
  if (role === 'game-icon' || role === 'coin-icon') {
    if (width !== height || width > 800) throw new Error(`${path} must be square and no larger than 800x800.`)
    return
  }
  if (Math.abs(width / height - 16 / 9) > 0.01) throw new Error(`${path} must use a 16:9 aspect ratio.`)
  const maximum = role === 'cover' ? 1_800 : 1_920
  if (width > maximum) throw new Error(`${path} must be no wider than ${maximum} pixels.`)
}

async function media(base: string, value: unknown, role: MediaRole, path: string): Promise<PreparedManifestMedia> {
  const relative = text(value, path, 1_000)
  if (!/\.webp$/i.test(relative)) throw new Error(`${path} must point to a .webp file.`)
  const filePath = resolve(base, relative)
  const buffer = await readFile(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new Error(`${path} does not exist: ${relative}.`)
    throw error
  })
  if (buffer.length === 0 || buffer.length > 8 * 1024 * 1024) throw new Error(`${path} must be between 1 byte and 8 MiB.`)
  let dimensions: { width: number; height: number }
  try {
    dimensions = webpDimensions(buffer)
  } catch (error) {
    throw new Error(`${path} ${(error as Error).message}`)
  }
  validDimensions(role, dimensions.width, dimensions.height, path)
  return {
    role,
    path: filePath,
    fileName: basename(filePath),
    width: dimensions.width,
    height: dimensions.height,
    size: buffer.length,
    bytes: buffer,
  }
}

function parseManifest(value: unknown): GameManifest {
  const root = record(value, 'manifest')
  keys(root, ['version', 'game', 'runtime', 'coin', 'media'], 'manifest')
  if (root.version !== 1) throw new Error('manifest.version must be 1.')

  const game = record(root.game, 'game')
  keys(game, ['title', 'pitch', 'description', 'engineTags', 'genreTags', 'links'], 'game')
  const runtime = record(root.runtime, 'runtime')
  keys(runtime, ['entryUrl', 'launchMode'], 'runtime')
  if (runtime.launchMode !== 'embedded') throw new Error('runtime.launchMode must be "embedded" for the MVP.')
  const coin = record(root.coin, 'coin')
  keys(coin, ['economyDeployment', 'name', 'symbol', 'description', 'graduationLyx', 'curveFeeBps', 'iconSameAsGame', 'linksSameAsGame', 'links'], 'coin')
  if (coin.economyDeployment !== 'lukso-mainnet-staging' && coin.economyDeployment !== 'lukso-mainnet-production') {
    throw new Error('coin.economyDeployment must be "lukso-mainnet-staging" or "lukso-mainnet-production".')
  }
  const coinName = text(coin.name, 'coin.name', 120)
  if (Buffer.byteLength(coinName, 'utf8') > 64) throw new Error('coin.name must fit in 64 UTF-8 bytes.')
  const symbol = text(coin.symbol, 'coin.symbol', 16)
  if (!/^[A-Z0-9]{1,16}$/.test(symbol)) throw new Error('coin.symbol must use 1–16 uppercase letters or numbers.')
  const graduationLyx = text(coin.graduationLyx, 'coin.graduationLyx', 80)
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(graduationLyx) || !/[1-9]/.test(graduationLyx)) {
    throw new Error('coin.graduationLyx must be positive with at most 18 decimal places.')
  }
  if (!Number.isInteger(coin.curveFeeBps) || (coin.curveFeeBps as number) < 0 || (coin.curveFeeBps as number) > 1_000) {
    throw new Error('coin.curveFeeBps must be an integer from 0 through 1000.')
  }
  const mediaValue = record(root.media, 'media')
  keys(mediaValue, ['gameIcon', 'cover', 'screenshots', 'coinIcon'], 'media')
  const screenshots = list(mediaValue.screenshots, 'media.screenshots').map((entry, index) => text(entry, `media.screenshots[${index}]`, 1_000))
  if (screenshots.length > 6) throw new Error('media.screenshots supports at most 6 images.')
  const iconSameAsGame = boolean(coin.iconSameAsGame, 'coin.iconSameAsGame')
  const coinIcon = mediaValue.coinIcon == null ? undefined : text(mediaValue.coinIcon, 'media.coinIcon', 1_000)
  if (!iconSameAsGame && !coinIcon) throw new Error('media.coinIcon is required when coin.iconSameAsGame is false.')
  const engineTags = tags(game.engineTags, 'game.engineTags')
  const genreTags = tags(game.genreTags, 'game.genreTags')
  if (engineTags.length + genreTags.length > 20) throw new Error('game supports at most 20 combined engine and genre tags.')

  return {
    version: 1,
    game: {
      title: text(game.title, 'game.title', 80),
      pitch: text(game.pitch, 'game.pitch', 140),
      description: text(game.description, 'game.description', 2_000),
      engineTags,
      genreTags,
      links: links(game.links, 'game.links'),
    },
    runtime: {
      entryUrl: url(runtime.entryUrl, 'runtime.entryUrl', true),
      launchMode: 'embedded',
    },
    coin: {
      economyDeployment: coin.economyDeployment,
      name: coinName,
      symbol,
      description: text(coin.description, 'coin.description', 600),
      graduationLyx,
      curveFeeBps: coin.curveFeeBps as number,
      iconSameAsGame,
      linksSameAsGame: boolean(coin.linksSameAsGame, 'coin.linksSameAsGame'),
      links: links(coin.links, 'coin.links'),
    },
    media: {
      gameIcon: text(mediaValue.gameIcon, 'media.gameIcon', 1_000),
      cover: text(mediaValue.cover, 'media.cover', 1_000),
      screenshots,
      ...(coinIcon ? { coinIcon } : {}),
    },
  }
}

export async function readGameManifest(cwd: string, file = 'slopz.game.json'): Promise<LoadedGameManifest> {
  const manifestPath = resolve(cwd, file)
  const raw = await readFile(manifestPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new Error(`Game manifest not found: ${file}.`)
    throw error
  })
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Invalid JSON in ${file}.`)
  }
  const manifest = parseManifest(parsed)
  const base = dirname(manifestPath)
  const gameIcon = await media(base, manifest.media.gameIcon, 'game-icon', 'media.gameIcon')
  const cover = await media(base, manifest.media.cover, 'cover', 'media.cover')
  const screenshots = await Promise.all(manifest.media.screenshots.map((path, index) => media(base, path, 'screenshot', `media.screenshots[${index}]`)))
  const coinIcon = manifest.media.coinIcon
    ? await media(base, manifest.media.coinIcon, 'coin-icon', 'media.coinIcon')
    : undefined
  return {
    path: manifestPath,
    manifest,
    media: {
      gameIcon,
      cover,
      screenshots,
      ...(coinIcon ? { coinIcon } : {}),
    },
  }
}

export function manifestSummary(loaded: LoadedGameManifest): Record<string, unknown> {
  const images = [loaded.media.gameIcon, loaded.media.cover, ...loaded.media.screenshots, ...(loaded.media.coinIcon ? [loaded.media.coinIcon] : [])]
  return {
    version: loaded.manifest.version,
    title: loaded.manifest.game.title,
    runtime: loaded.manifest.runtime,
    coin: {
      name: loaded.manifest.coin.name,
      symbol: loaded.manifest.coin.symbol,
      graduationLyx: loaded.manifest.coin.graduationLyx,
      curveFeeBps: loaded.manifest.coin.curveFeeBps,
    },
    media: images.map(({ role, fileName, width, height, size }) => ({ role, fileName, width, height, size })),
  }
}
