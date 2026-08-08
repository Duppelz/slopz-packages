import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { post } from './api.js'
import {
  readUserConfig,
  writeUserConfig,
  type EnvironmentConfig,
} from './config.js'

type CliSessionResponse = {
  ok: true
  session: { profileAddress: string; scopes: string[]; expiresAt: number } | null
}

type CliTokenResponse = {
  ok: true
  cliToken: string
  profileAddress: string
  scopes: string[]
  expiresAt: number
}

function openBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.unref()
}

async function callbackCode(state: string): Promise<{
  redirectUri: string
  code: Promise<string>
  close: () => void
}> {
  let resolveCode: (code: string) => void = () => undefined
  let rejectCode: (error: Error) => void = () => undefined
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    const authorizationCode = url.searchParams.get('code')
    if (url.pathname !== '/callback' || url.searchParams.get('state') !== state || !authorizationCode) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Invalid Slopz CLI callback.')
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Slopz CLI connected</title><p>CLI connected. You can close this tab.</p><script>window.close()</script>')
    resolveCode(authorizationCode)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Could not start the local CLI callback.')
  }
  const timer = setTimeout(() => rejectCode(new Error('CLI authorization timed out.')), 5 * 60_000)
  return {
    redirectUri: `http://127.0.0.1:${address.port}/callback`,
    code: code.finally(() => clearTimeout(timer)),
    close: () => server.close(),
  }
}

export async function login(environmentName: string, environment: EnvironmentConfig): Promise<EnvironmentConfig & { cliToken: string }> {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(24).toString('base64url')
  const callback = await callbackCode(state)
  const authorizeUrl = new URL('/cli/authorize', `${environment.appUrl}/`)
  authorizeUrl.searchParams.set('redirect_uri', callback.redirectUri)
  authorizeUrl.searchParams.set('state', state)
  authorizeUrl.searchParams.set('code_challenge', challenge)
  authorizeUrl.searchParams.set('code_challenge_method', 'S256')
  authorizeUrl.searchParams.set('client_name', `Slopz CLI (${environmentName})`)
  process.stdout.write(`Authorize this CLI in your browser:\n${authorizeUrl.toString()}\n`)
  openBrowser(authorizeUrl.toString())
  try {
    const result = await post<CliTokenResponse>(environment.apiUrl, '/cli/token', {
      code: await callback.code,
      codeVerifier: verifier,
    })
    const saved: EnvironmentConfig & { cliToken: string } = {
      ...environment,
      cliToken: result.cliToken,
      profileAddress: result.profileAddress,
      tokenExpiresAt: result.expiresAt,
    }
    const config = await readUserConfig()
    config.environments[environmentName] = saved
    await writeUserConfig(config)
    return saved
  } finally {
    callback.close()
  }
}

export async function requireLogin(
  environmentName: string,
  environment: EnvironmentConfig,
): Promise<EnvironmentConfig & { cliToken: string }> {
  if (environment.cliToken && (!environment.tokenExpiresAt || environment.tokenExpiresAt > Date.now() + 60_000)) {
    try {
      const result = await post<CliSessionResponse>(environment.apiUrl, '/cli/session', { cliToken: environment.cliToken })
      if (result.session) return environment as EnvironmentConfig & { cliToken: string }
    } catch {
      // Reauthorize below.
    }
  }
  return login(environmentName, environment)
}

export async function logout(environmentName: string, environment: EnvironmentConfig): Promise<void> {
  if (environment.cliToken) {
    await post(environment.apiUrl, '/cli/revoke', { cliToken: environment.cliToken }).catch(() => undefined)
  }
  const config = await readUserConfig()
  const saved = config.environments[environmentName]
  if (saved) config.environments[environmentName] = { apiUrl: saved.apiUrl, appUrl: saved.appUrl }
  await writeUserConfig(config)
}
