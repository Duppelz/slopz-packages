import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export type EnvironmentConfig = {
  apiUrl: string
  appUrl: string
  cliToken?: string
  profileAddress?: string
  tokenExpiresAt?: number
}

export type UserConfig = {
  defaultEnvironment?: string
  environments: Record<string, EnvironmentConfig>
}

export type ProjectEnvironment = {
  gameId: string
  clientId: string
  slug: string
  canonicalUrl: string
}

export type ProjectState = {
  environments: Record<string, ProjectEnvironment>
}

function userConfigPath(): string {
  return process.env.SLOPZ_CONFIG_PATH?.trim() || join(homedir(), '.slopz', 'config.json')
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw error
  }
}

export async function readUserConfig(): Promise<UserConfig> {
  return readJson(userConfigPath(), { defaultEnvironment: 'staging', environments: {} })
}

export async function writeUserConfig(config: UserConfig): Promise<void> {
  const path = userConfigPath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  await chmod(path, 0o600)
}

export async function resolveEnvironment(name: string): Promise<EnvironmentConfig> {
  const config = await readUserConfig()
  const upper = name.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()
  const stored = config.environments[name]
  const apiUrl = process.env[`SLOPZ_${upper}_API_URL`]?.trim() || stored?.apiUrl
  const appUrl = process.env[`SLOPZ_${upper}_APP_URL`]?.trim() || stored?.appUrl
  if (!apiUrl || !appUrl) {
    throw new Error(`Environment "${name}" is not configured. Run: slopz env set ${name} --api-url <url> --app-url <url>`)
  }
  return {
    ...stored,
    apiUrl: apiUrl.replace(/\/$/, ''),
    appUrl: appUrl.replace(/\/$/, ''),
  }
}

export function projectStatePath(cwd: string): string {
  return join(cwd, '.slopz', 'project.json')
}

export async function readProjectState(cwd: string): Promise<ProjectState> {
  return readJson(projectStatePath(cwd), { environments: {} })
}

export async function writeProjectState(cwd: string, state: ProjectState): Promise<void> {
  const path = projectStatePath(cwd)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`)
}
