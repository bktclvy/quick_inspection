export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = path.startsWith('/') ? path : `/${path}`

  const headers: Record<string, string> = {}
  if (
    options.body &&
    typeof options.body === 'string' &&
    !options.headers
  ) {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(url, { ...options, headers: { ...headers, ...(options.headers as Record<string, string>) } })

  if (!res.ok) {
    let msg = res.statusText
    try {
      const body = await res.json()
      msg = body.detail || body.message || msg
    } catch { /* ignore */ }
    throw new ApiError(res.status, msg)
  }

  const ct = res.headers.get('content-type')
  if (ct?.includes('application/json')) {
    return res.json()
  }
  return undefined as T
}

export function api<T = unknown>(path: string) {
  const url = `/api${path}`
  return {
    get: (query?: Record<string, string>) => {
      const qs = query ? '?' + new URLSearchParams(query).toString() : ''
      return apiFetch<T>(`${url}${qs}`)
    },
    post: (body?: unknown) =>
      apiFetch<T>(url, {
        method: 'POST',
        body: body != null ? JSON.stringify(body) : undefined,
      }),
    put: (body?: unknown) =>
      apiFetch<T>(url, {
        method: 'PUT',
        body: body != null ? JSON.stringify(body) : undefined,
      }),
    delete: () => apiFetch<T>(url, { method: 'DELETE' }),
  }
}
