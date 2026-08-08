import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export type SlotOffer = {
  key: string
  duration: string
  price: string
}

export type SlotManifestEntry = {
  key: string
  placement: {
    label: string
    description: string
    width: number
    height: number
    maxFileSize?: number
    allowAnimated?: boolean
    contentRules?: string
  }
  rental: {
    approval?: 'manual'
    availableFrom?: string
    availableUntil?: string | null
    offers: SlotOffer[]
  }
}

export type SlotManifest = {
  version: 1
  slots: SlotManifestEntry[]
}

export type ApiSlotInput = {
  key: string
  label: string
  placement: string
  width: number
  height: number
  maxFileSize: number
  allowAnimated: boolean
  contentRules: string
  approvalMode: 'manual'
  availableFrom?: number
  availableUntil?: number
  offers: { key: string; durationSeconds: number; priceAmount: string }[]
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`)
  return value as Record<string, unknown>
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`)
  const normalized = value.trim()
  if (normalized.length > max) throw new Error(`${name} can contain at most ${max} characters.`)
  return normalized
}

function integer(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`)
  }
  return value as number
}

export function durationSeconds(value: string): number {
  const match = /^(\d+)(m|h|d)$/.exec(value.trim())
  if (!match) throw new Error(`Invalid duration "${value}". Use values such as 30m, 2h, or 7d.`)
  const amount = Number(match[1])
  const unit = match[2]
  return amount * (unit === 'm' ? 60 : unit === 'h' ? 3_600 : 86_400)
}

function date(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${name} must be an ISO-8601 date and time.`)
  }
  return value
}

export async function readSlotManifest(cwd: string, file = 'slopz.slots.json'): Promise<SlotManifest> {
  const path = resolve(cwd, file)
  const root = record(JSON.parse(await readFile(path, 'utf8')) as unknown, file)
  if (root.version !== 1) throw new Error(`${file}.version must be 1.`)
  if (!Array.isArray(root.slots)) throw new Error(`${file}.slots must be an array.`)
  if (root.slots.length > 8) throw new Error('A game can define at most eight ad slots.')

  const keys = new Set<string>()
  const slots = root.slots.map((rawSlot, index): SlotManifestEntry => {
    const prefix = `slots[${index}]`
    const slot = record(rawSlot, prefix)
    const key = text(slot.key, `${prefix}.key`, 64)
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(key)) {
      throw new Error(`${prefix}.key must start with a lowercase letter and contain only lowercase letters, numbers, or hyphens.`)
    }
    if (keys.has(key)) throw new Error(`Duplicate slot key: ${key}`)
    keys.add(key)

    const placement = record(slot.placement, `${prefix}.placement`)
    const rental = record(slot.rental, `${prefix}.rental`)
    if (rental.approval !== undefined && rental.approval !== 'manual') {
      throw new Error(`${prefix}.rental.approval must be "manual"; automatic approval is reserved for trusted first-party slots.`)
    }
    if (!Array.isArray(rental.offers) || rental.offers.length < 1 || rental.offers.length > 8) {
      throw new Error(`${prefix}.rental.offers must contain 1–8 offers.`)
    }
    const offerKeys = new Set<string>()
    const offers = rental.offers.map((rawOffer, offerIndex): SlotOffer => {
      const offerPrefix = `${prefix}.rental.offers[${offerIndex}]`
      const offer = record(rawOffer, offerPrefix)
      const offerKey = text(offer.key, `${offerPrefix}.key`, 64)
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(offerKey) || offerKeys.has(offerKey)) {
        throw new Error(`${offerPrefix}.key is invalid or duplicated.`)
      }
      offerKeys.add(offerKey)
      const duration = text(offer.duration, `${offerPrefix}.duration`, 16)
      const seconds = durationSeconds(duration)
      if (seconds < 300 || seconds > 30 * 86_400) throw new Error(`${offerPrefix}.duration must be between 5m and 30d.`)
      const price = text(offer.price, `${offerPrefix}.price`, 80)
      if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(price) || Number(price) <= 0) {
        throw new Error(`${offerPrefix}.price must be a positive coin amount.`)
      }
      return { key: offerKey, duration, price }
    })
    const availableFrom = date(rental.availableFrom, `${prefix}.rental.availableFrom`)
    const availableUntil = date(rental.availableUntil, `${prefix}.rental.availableUntil`)
    if (availableFrom && availableUntil && Date.parse(availableUntil) <= Date.parse(availableFrom)) {
      throw new Error(`${prefix}.rental.availableUntil must be later than availableFrom.`)
    }
    return {
      key,
      placement: {
        label: text(placement.label, `${prefix}.placement.label`, 80),
        description: text(placement.description, `${prefix}.placement.description`, 240),
        width: integer(placement.width, `${prefix}.placement.width`, 32, 4_096),
        height: integer(placement.height, `${prefix}.placement.height`, 32, 4_096),
        maxFileSize: placement.maxFileSize === undefined
          ? 1024 * 1024
          : integer(placement.maxFileSize, `${prefix}.placement.maxFileSize`, 64 * 1024, 8 * 1024 * 1024),
        allowAnimated: placement.allowAnimated === true,
        contentRules: placement.contentRules === undefined
          ? 'No fake giveaways, malware, impersonation, gore, or deceptive wallet prompts.'
          : text(placement.contentRules, `${prefix}.placement.contentRules`, 1_000),
      },
      rental: {
        approval: 'manual',
        ...(availableFrom ? { availableFrom } : {}),
        ...(availableUntil ? { availableUntil } : {}),
        offers,
      },
    }
  })
  return { version: 1, slots }
}

export function apiSlots(manifest: SlotManifest): ApiSlotInput[] {
  return manifest.slots.map((slot) => ({
    key: slot.key,
    label: slot.placement.label,
    placement: slot.placement.description,
    width: slot.placement.width,
    height: slot.placement.height,
    maxFileSize: slot.placement.maxFileSize ?? 1024 * 1024,
    allowAnimated: slot.placement.allowAnimated ?? false,
    contentRules: slot.placement.contentRules ?? 'No fake giveaways, malware, impersonation, gore, or deceptive wallet prompts.',
    approvalMode: 'manual',
    ...(slot.rental.availableFrom ? { availableFrom: Date.parse(slot.rental.availableFrom) } : {}),
    ...(slot.rental.availableUntil ? { availableUntil: Date.parse(slot.rental.availableUntil) } : {}),
    offers: slot.rental.offers.map((offer) => ({
      key: offer.key,
      durationSeconds: durationSeconds(offer.duration),
      priceAmount: offer.price,
    })),
  }))
}
