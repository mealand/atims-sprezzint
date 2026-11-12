/** Thin API client. Token persistence leaves room for device-held keys later. */
// '/api' is proxied to the API server in dev (vite.config.ts) and can be
// reverse-proxied the same way in production.
const BASE = import.meta.env.VITE_API_URL ?? '/api';

let token: string | null = localStorage.getItem('atims_token');

export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem('atims_token', t);
  else localStorage.removeItem('atims_token');
}
export function getToken() {
  return token;
}

export async function api<T = unknown>(
  path: string,
  { method = 'GET', body }: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error ?? res.statusText), { data });
  return data as T;
}
