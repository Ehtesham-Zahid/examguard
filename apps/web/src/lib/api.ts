export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'ERROR', public details?: unknown) {
    super(message);
  }
  get isNetwork() {
    return this.status === 0;
  }
}

let accessToken: string | null = null;
let refreshing: Promise<string | null> | null = null;
let onLogout: (() => void) | null = null;

export const setAccessToken = (t: string | null) => {
  accessToken = t;
};
export const getAccessToken = () => accessToken;
export const setLogoutHandler = (fn: () => void) => {
  onLogout = fn;
};

export async function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = fetch(`${API_BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: localStorage.getItem('eg_rt') ?? undefined }) })
      .then(async (r) => (r.ok ? ((await r.json()) as { accessToken: string }).accessToken : null))
      .catch(() => null)
      .finally(() => setTimeout(() => (refreshing = null), 0));
  }
  const t = await refreshing;
  accessToken = t;
  return t;
}

export interface RequestOpts {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  raw?: boolean;
}

export async function api<T = unknown>(path: string, opts: RequestOpts = {}, retried = false): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
  opts.signal?.addEventListener('abort', () => ctrl.abort());
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      credentials: 'include',
      headers: { ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), ...opts.headers },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError(0, navigator.onLine ? 'Cannot reach the server. Check your connection.' : 'You are offline.', 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 && !retried && !path.startsWith('/auth/login')) {
    const t = await refreshAccessToken();
    if (t) return api<T>(path, opts, true);
    onLogout?.();
  }
  if (opts.raw) {
    if (!res.ok) throw new ApiError(res.status, 'Download failed');
    return res as unknown as T;
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json?.error?.message ?? `Request failed (${res.status})`, json?.error?.code, json?.error?.details);
  return json as T;
}

export async function downloadFile(path: string, fallbackName: string) {
  const res = await api<Response>(path, { raw: true, timeoutMs: 60000 });
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
