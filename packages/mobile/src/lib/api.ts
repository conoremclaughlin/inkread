import { getClientStore } from '../store/clientStore';

/**
 * Bearer-token API client for the inkread server. Tokens persist in the
 * client store's meta table; 401s trigger one silent refresh-and-retry.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:6021';

let accessToken: string | undefined;
let refreshToken: string | undefined;

export async function loadSession(): Promise<boolean> {
  const store = await getClientStore();
  accessToken = await store.getMeta('access_token');
  refreshToken = await store.getMeta('refresh_token');
  return Boolean(accessToken && refreshToken);
}

async function persistTokens(access: string, refresh: string): Promise<void> {
  accessToken = access;
  refreshToken = refresh;
  const store = await getClientStore();
  await store.setMeta('access_token', access);
  await store.setMeta('refresh_token', refresh);
}

export async function login(email: string, password: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Login failed (${response.status})`);
  }
  const body = (await response.json()) as { accessToken: string; refreshToken: string };
  await persistTokens(body.accessToken, body.refreshToken);
}

export async function logout(): Promise<void> {
  accessToken = undefined;
  refreshToken = undefined;
  const store = await getClientStore();
  await store.setMeta('access_token', '');
  await store.setMeta('refresh_token', '');
}

/**
 * Fired when the server has definitively rejected our refresh token — the
 * session is dead and only a fresh sign-in can revive sync. NOT fired for
 * network failures (offline must keep serving the cache, signed in).
 */
let sessionExpiredListener: (() => void) | undefined;

export function onSessionExpired(listener: () => void): void {
  sessionExpiredListener = listener;
}

async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    // Unreachable server ≠ dead session. Keep the tokens; stay signed in.
    return false;
  }
  if (!response.ok) {
    // The server saw the token and said no: expired or revoked. Silent
    // failure here is how a device ends up "signed in" with sync dead
    // forever — surface it so the app can prompt a re-login.
    await logout();
    sessionExpiredListener?.();
    return false;
  }
  const body = (await response.json()) as { accessToken: string; refreshToken: string };
  await persistTokens(body.accessToken, body.refreshToken);
  return true;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const request = (): Promise<Response> =>
    fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.headers as Record<string, string> | undefined),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });
  let response = await request();
  if (response.status === 401 && (await tryRefresh())) {
    response = await request();
  }
  return response;
}
