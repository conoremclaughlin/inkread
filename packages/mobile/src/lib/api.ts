import Constants from 'expo-constants';
import { getClientStore } from '../store/clientStore';

/**
 * Bearer-token API client for the inkread server. Tokens persist in the
 * client store's meta table; 401s trigger one silent refresh-and-retry.
 */

/** Port the web API (next dev / next start) listens on — see packages/web. */
const WEB_API_PORT = 6021;

/**
 * In a dev build the phone is already connected to Metro, so expo-constants
 * exposes the dev machine's host (e.g. "192.168.68.115:8081"). The web API runs
 * on that same machine at :6021, so reuse the host with our port — the app then
 * auto-follows the Mac's LAN IP every time Metro starts, with no rebuild and no
 * .env edit. Returns undefined in standalone/TestFlight builds (no Metro host),
 * where the env override or the localhost fallback applies instead.
 */
function metroDerivedApiUrl(): string | undefined {
  const host = Constants.expoConfig?.hostUri?.split(':')[0]?.trim();
  return host ? `http://${host}:${WEB_API_PORT}` : undefined;
}

/**
 * API base URL, resolved once at startup. Precedence:
 *   1. EXPO_PUBLIC_API_URL — explicit override, inlined at build time. Set it
 *      for standalone/TestFlight builds, or to aim a dev build at a remote API.
 *   2. Metro's host — dev builds auto-follow the machine serving the bundle,
 *      so a changed LAN IP no longer means a stale hardcoded address.
 *   3. localhost — last resort (the iOS simulator reaches the Mac this way).
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL?.trim() || metroDerivedApiUrl() || 'http://127.0.0.1:6021';

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
  let response: Response;
  try {
    response = await fetchWithTimeout(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    // The request never reached the server — wrong network, server down, or a
    // stale address. Kept distinct from a rejected password so the UI can tell
    // "can't connect" from "wrong credentials".
    throw new Error(
      `Can't reach the server at ${API_URL}. Check you're on the same network and the web server is running.`,
    );
  }
  if (response.status === 401) {
    throw new Error('Incorrect email or password.');
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Login failed (${response.status}).`);
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
    response = await fetchWithTimeout(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    // Unreachable server ≠ dead session. Keep the tokens; stay signed in.
    return false;
  }
  if (response.status === 401 || response.status === 403) {
    // The server saw the token and said no: expired or revoked. Silent
    // failure here is how a device ends up "signed in" with sync dead
    // forever — surface it so the app can prompt a re-login.
    await logout();
    sessionExpiredListener?.();
    return false;
  }
  if (!response.ok) {
    // 5xx/429: a server fault, not a verdict on the token. Keep the
    // session so recovery works once the server is healthy again.
    return false;
  }
  const body = (await response.json()) as { accessToken: string; refreshToken: string };
  await persistTokens(body.accessToken, body.refreshToken);
  return true;
}

/**
 * fetch with a hard timeout so an offline / half-connected request fails fast
 * instead of hanging. A hung request leaves the reader stuck on its blank
 * loading view — which reads as a crash (the trap Conor hit tapping a not-yet-
 * downloaded book offline). The AbortError is a normal network failure to
 * callers: offline → serve the cache / show a retry.
 */
const REQUEST_TIMEOUT_MS = 12_000;
function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const request = (): Promise<Response> =>
    fetchWithTimeout(`${API_URL}${path}`, {
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
