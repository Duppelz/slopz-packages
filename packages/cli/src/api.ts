export async function post<T>(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const result: unknown = await response.json().catch(() => null)
  if (!result || typeof result !== 'object') {
    throw new Error(`Invalid response from ${path} (${response.status})`)
  }
  const envelope = result as { ok?: unknown; error?: unknown }
  if (!response.ok || envelope.ok !== true) {
    throw new Error(typeof envelope.error === 'string' ? envelope.error : `HTTP_${response.status}`)
  }
  return result as T
}
