#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { post } from './api.js'
import { login, logout, requireLogin } from './auth.js'
import {
  DEFAULT_ENVIRONMENT,
  OFFICIAL_ENVIRONMENTS,
  readProjectState,
  readUserConfig,
  resolveEnvironment,
  writeProjectState,
  writeUserConfig,
  type EnvironmentConfig,
  type ProjectEnvironment,
} from './config.js'
import { apiSlots, readSlotManifest } from './slots.js'
import { createProject } from './project.js'
import { applyProjectDraft } from './draft.js'
import { manifestSummary, readGameManifest } from './manifest.js'

const packageMetadata = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version?: unknown }

if (typeof packageMetadata.version !== 'string' || !packageMetadata.version) {
  throw new Error('CLI package metadata does not contain a valid version.')
}

const VERSION = packageMetadata.version

type ParsedArgs = {
  positionals: string[]
  flags: Map<string, string | true>
}

type OwnedGameResponse = {
  ok: true
  game: ProjectEnvironment & { title: string; status: string }
}

type SlotResponse = {
  ok: true
  slots: Array<{
    key: string
    label: string
    placement: string
    width: number
    height: number
    approvalMode: string
    offers: Array<{ key: string; durationSeconds: number; priceAmount: string }>
  }>
}

function parse(values: string[]): ParsedArgs {
  const positionals: string[] = []
  const flags = new Map<string, string | true>()
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!value) continue
    if (value === '--') continue
    if (!value.startsWith('--')) {
      positionals.push(value)
      continue
    }
    const [name = '', inline] = value.slice(2).split('=', 2)
    const next = values[index + 1]
    if (inline !== undefined) flags.set(name, inline)
    else if (next && !next.startsWith('--')) {
      flags.set(name, next)
      index += 1
    } else flags.set(name, true)
  }
  return { positionals, flags }
}

function stringFlag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags.get(name)
  return typeof value === 'string' ? value : undefined
}

function validUrl(value: string, name: string): string {
  const url = new URL(value)
  const loopback = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !loopback) throw new Error(`${name} must use HTTPS, except for local development.`)
  return url.toString().replace(/\/$/, '')
}

function output(parsed: ParsedArgs, human: string, value: unknown): void {
  process.stdout.write(parsed.flags.has('json') ? `${JSON.stringify(value, null, 2)}\n` : human)
}

function help(): void {
  process.stdout.write(`Slopz CLI ${VERSION} — authenticated tools for game developers and agents.

Usage
  slopz env set <name> --api-url <url> --app-url <url> [--default]
  slopz env default <name>
  slopz env list [--json]
  slopz login [--env <name>]
  slopz logout [--env <name>]
  slopz whoami [--env <name>] [--json]
  slopz project create --manifest [slopz.game.json] [--sync-slots] [--env <name>] [--json]
  slopz project create --title <title> --pitch <pitch> [--game-url <url>] [--sync-slots] [--file slopz.slots.json] [--env <name>] [--json]
  slopz project draft validate [--file slopz.game.json] [--json]
  slopz project draft apply [--file slopz.game.json] [--game-url <url>] [--env <name>] [--json]
  slopz project set <game-id> [--env <name>]
  slopz project show [--env <name>] [--json]
  slopz slots validate [--file slopz.slots.json] [--json]
  slopz slots list [--env <name>] [--json]
  slopz slots sync [--env <name>] [--file slopz.slots.json] [--dry-run] [--json]

Slot code remains in the game. The authenticated CLI persists the developer's
reviewed placement manifest and rental settings; public players cannot mutate it.
`)
}

async function environmentName(parsed: ParsedArgs): Promise<string> {
  const config = await readUserConfig()
  return stringFlag(parsed, 'env') ?? config.defaultEnvironment ?? DEFAULT_ENVIRONMENT
}

async function envCommand(parsed: ParsedArgs): Promise<void> {
  const action = parsed.positionals[1]
  const config = await readUserConfig()
  if (action === 'list') {
    const names = [...new Set([...Object.keys(OFFICIAL_ENVIRONMENTS), ...Object.keys(config.environments)])]
    const environments = await Promise.all(names.map(async (name) => {
      const environment = await resolveEnvironment(name)
      return {
        name,
        default: name === (config.defaultEnvironment ?? DEFAULT_ENVIRONMENT),
        apiUrl: environment.apiUrl,
        appUrl: environment.appUrl,
        connected: Boolean(environment.cliToken),
        profileAddress: environment.profileAddress,
      }
    }))
    output(parsed, environments.length
      ? `${environments.map((environment) => `${environment.default ? '* ' : '  '}${environment.name}\t${environment.apiUrl}\t${environment.connected ? 'connected' : 'disconnected'}`).join('\n')}\n`
      : 'No environments configured.\n', environments)
    return
  }
  if (action === 'default') {
    const name = parsed.positionals[2]
    if (!name) throw new Error('Usage: slopz env default <name>')
    await resolveEnvironment(name)
    config.defaultEnvironment = name
    await writeUserConfig(config)
    output(parsed, `Default environment is now ${name}.\n`, { name, default: true })
    return
  }
  if (action !== 'set') throw new Error('Use `slopz env set`, `slopz env default`, or `slopz env list`.')
  const name = parsed.positionals[2]
  const apiUrl = stringFlag(parsed, 'api-url')
  const appUrl = stringFlag(parsed, 'app-url')
  if (!name || !apiUrl || !appUrl) throw new Error('Usage: slopz env set <name> --api-url <url> --app-url <url>')
  const nextApiUrl = validUrl(apiUrl, 'api-url')
  const nextAppUrl = validUrl(appUrl, 'app-url')
  const previous = config.environments[name]
  config.environments[name] = previous?.apiUrl === nextApiUrl && previous.appUrl === nextAppUrl
    ? { ...previous, apiUrl: nextApiUrl, appUrl: nextAppUrl }
    : { apiUrl: nextApiUrl, appUrl: nextAppUrl }
  if (parsed.flags.has('default') || !config.defaultEnvironment) config.defaultEnvironment = name
  await writeUserConfig(config)
  output(parsed, `Configured ${name}${config.defaultEnvironment === name ? ' as the default' : ''}.\n`, {
    name,
    default: config.defaultEnvironment === name,
    apiUrl: nextApiUrl,
    appUrl: nextAppUrl,
  })
}

async function authenticated(parsed: ParsedArgs): Promise<{
  name: string
  environment: EnvironmentConfig & { cliToken: string }
}> {
  const name = await environmentName(parsed)
  const environment = await requireLogin(name, await resolveEnvironment(name))
  return { name, environment }
}

async function requireProject(cwd: string, environmentName: string): Promise<ProjectEnvironment> {
  const state = await readProjectState(cwd)
  const project = state.environments[environmentName]
  if (!project) throw new Error(`No ${environmentName} project is linked here. Run: slopz project set <game-id> --env ${environmentName}`)
  return project
}

async function projectCommand(cwd: string, parsed: ParsedArgs): Promise<void> {
  const action = parsed.positionals[1]
  const draftAction = action === 'draft' ? parsed.positionals[2] : action === 'apply' ? 'apply' : undefined
  const manifestFile = stringFlag(parsed, 'file') ?? 'slopz.game.json'
  if (draftAction === 'validate') {
    const loaded = await readGameManifest(cwd, manifestFile)
    const summary = manifestSummary(loaded)
    output(parsed, `Valid game manifest for ${loaded.manifest.game.title}: ${summary.media instanceof Array ? summary.media.length : 0} image(s).\n`, summary)
    return
  }
  const { name, environment } = await authenticated(parsed)
  if (draftAction === 'apply') {
    const loaded = await readGameManifest(cwd, manifestFile)
    const project = await requireProject(cwd, name)
    const gameUrlFlag = stringFlag(parsed, 'game-url')
    const gameUrl = gameUrlFlag ? validUrl(gameUrlFlag, 'game-url') : undefined
    const result = await applyProjectDraft({
      environmentName: name,
      environment,
      project,
      loaded,
      ...(gameUrl ? { gameUrl } : {}),
    })
    output(parsed, [
      `Applied the complete ${result.content.title} draft to ${name}.`,
      `Runtime: ${result.runtime.entryUrl}`,
      `Media: uploaded ${result.media.length}.`,
      `Coin: ${result.content.coinName} ($${result.content.coinSymbol}).`,
      `Review and publish: ${result.next.url}`,
    ].join('\n') + '\n', result)
    return
  }
  if (action === 'create') {
    const hasManifest = parsed.flags.has('manifest')
    const createManifestFile = stringFlag(parsed, 'manifest') ?? 'slopz.game.json'
    const loaded = hasManifest ? await readGameManifest(cwd, createManifestFile) : null
    const title = stringFlag(parsed, 'title') ?? loaded?.manifest.game.title
    const pitch = stringFlag(parsed, 'pitch') ?? loaded?.manifest.game.pitch
    const gameUrlFlag = stringFlag(parsed, 'game-url')
    const gameUrl = gameUrlFlag ? validUrl(gameUrlFlag, 'game-url') : loaded?.manifest.runtime.entryUrl
    if (!title || !pitch) throw new Error('Use `slopz project create --manifest` or provide --title and --pitch.')
    const result = await createProject({
      cwd,
      environmentName: name,
      environment,
      title,
      pitch,
      syncSlots: parsed.flags.has('sync-slots'),
      ...(!loaded && gameUrl ? { gameUrl } : {}),
      ...(stringFlag(parsed, 'file') ? { slotFile: stringFlag(parsed, 'file')! } : {}),
    })

    const applied = loaded
      ? await applyProjectDraft({
          environmentName: name,
          environment,
          project: result.game,
          loaded,
          ...(gameUrl ? { gameUrl } : {}),
        })
      : null

    const human = [
      `Created and linked ${title} (${result.game.gameId}) in ${name}.`,
      applied ? `Draft: applied complete metadata and ${applied.media.length} image(s).` : null,
      applied ? `Runtime: ${applied.runtime.entryUrl}` : result.runtime ? `Runtime: ${result.runtime.entryUrl}` : 'Runtime: add it in the app or pass --game-url when creating the project.',
      result.slotCount === null ? 'Slots: not synced.' : `Slots: synced ${result.slotCount}.`,
      `Continue in Slopz: ${result.game.canonicalUrl}`,
    ].filter((line): line is string => Boolean(line)).join('\n')
    output(parsed, `${human}\n`, applied ? { ...result, draft: applied } : result)
    return
  }
  if (action === 'set') {
    const gameId = parsed.positionals[2]
    if (!gameId) throw new Error('Usage: slopz project set <game-id>')
    const result = await post<OwnedGameResponse>(environment.apiUrl, '/cli/games/get', {
      cliToken: environment.cliToken,
      gameId,
    })
    const state = await readProjectState(cwd)
    state.environments[name] = {
      gameId: result.game.gameId,
      clientId: result.game.clientId,
      slug: result.game.slug,
      canonicalUrl: result.game.canonicalUrl,
    }
    await writeProjectState(cwd, state)
    output(parsed, `Linked ${result.game.title} (${result.game.gameId}) to ${name}.\n`, result.game)
    return
  }
  if (action === 'show') {
    const project = await requireProject(cwd, name)
    const result = await post<OwnedGameResponse>(environment.apiUrl, '/cli/games/get', {
      cliToken: environment.cliToken,
      gameId: project.gameId,
    })
    output(parsed, `${result.game.title}\nGame: ${result.game.gameId}\nStatus: ${result.game.status}\nPage: ${result.game.canonicalUrl}\n`, result.game)
    return
  }
  throw new Error('Use `slopz project create`, `slopz project draft validate`, `slopz project draft apply`, `slopz project set <game-id>`, or `slopz project show`.')
}

async function slotsCommand(cwd: string, parsed: ParsedArgs): Promise<void> {
  const action = parsed.positionals[1]
  const file = stringFlag(parsed, 'file') ?? 'slopz.slots.json'
  if (action === 'validate') {
    const manifest = await readSlotManifest(cwd, file)
    output(parsed, `Valid slot manifest: ${manifest.slots.length} slot${manifest.slots.length === 1 ? '' : 's'}.\n`, manifest)
    return
  }
  if (action === 'sync' && parsed.flags.has('dry-run')) {
    const manifest = await readSlotManifest(cwd, file)
    const slots = apiSlots(manifest)
    const name = await environmentName(parsed)
    const project = (await readProjectState(cwd)).environments[name]
    output(parsed, `Valid manifest. Would sync ${slots.length} slot${slots.length === 1 ? '' : 's'}${project ? ` to ${project.gameId}` : ''}.\n`, {
      dryRun: true,
      environment: name,
      gameId: project?.gameId ?? null,
      slots,
    })
    return
  }
  const { name, environment } = await authenticated(parsed)
  const project = await requireProject(cwd, name)
  if (action === 'list') {
    const result = await post<SlotResponse>(environment.apiUrl, '/cli/ads/slots', {
      cliToken: environment.cliToken,
      gameId: project.gameId,
    })
    const human = result.slots.length
      ? `${result.slots.map((slot) => `${slot.key}\t${slot.width}x${slot.height}\t${slot.offers.map((offer) => `${offer.durationSeconds}s/${offer.priceAmount}`).join(', ')}`).join('\n')}\n`
      : 'No configured slots.\n'
    output(parsed, human, result.slots)
    return
  }
  if (action === 'sync') {
    const manifest = await readSlotManifest(cwd, file)
    const slots = apiSlots(manifest)
    const result = await post<{ ok: true; gameId: string; slotCount: number }>(environment.apiUrl, '/cli/ads/sync', {
      cliToken: environment.cliToken,
      gameId: project.gameId,
      slots,
    })
    output(parsed, `Synced ${result.slotCount} slot${result.slotCount === 1 ? '' : 's'} to ${project.gameId}.\n`, result)
    return
  }
  throw new Error('Use `slopz slots validate`, `slopz slots list`, or `slopz slots sync`.')
}

async function main(): Promise<void> {
  const parsed = parse(process.argv.slice(2))
  const command = parsed.positionals[0]
  const cwd = process.cwd()
  if (!command || command === 'help' || parsed.flags.has('help')) {
    help()
    return
  }
  if (command === 'version' || parsed.flags.has('version')) {
    process.stdout.write(`${VERSION}\n`)
    return
  }
  if (command === 'env') return envCommand(parsed)
  const name = await environmentName(parsed)
  const environment = await resolveEnvironment(name)
  if (command === 'login') {
    const authorized = await login(name, environment)
    output(parsed, `Connected ${authorized.profileAddress ?? 'developer'} to ${name}.\n`, {
      environment: name,
      profileAddress: authorized.profileAddress,
      expiresAt: authorized.tokenExpiresAt,
    })
    return
  }
  if (command === 'logout') {
    await logout(name, environment)
    output(parsed, `Disconnected from ${name}.\n`, { environment: name, connected: false })
    return
  }
  if (command === 'whoami') {
    const authorized = await requireLogin(name, environment)
    const result = await post<{ ok: true; session: { profileAddress: string; scopes: string[]; expiresAt: number } | null }>(
      authorized.apiUrl,
      '/cli/session',
      { cliToken: authorized.cliToken },
    )
    if (!result.session) throw new Error('CLI_AUTH_REQUIRED')
    output(parsed, `${result.session.profileAddress}\nScopes: ${result.session.scopes.join(', ')}\n`, result.session)
    return
  }
  if (command === 'project') return projectCommand(cwd, parsed)
  if (command === 'slots' || command === 'ads') return slotsCommand(cwd, parsed)
  throw new Error(`Unknown command: ${parsed.positionals.join(' ')}`)
}

void main().catch((error: unknown) => {
  process.stderr.write(`slopz: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
