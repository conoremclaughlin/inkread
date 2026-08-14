import { getClientStore } from '../store/clientStore';
import { apiFetch } from './api';

/**
 * Reader preferences, mirrored from the server (jsonb) with a local-first
 * cache in the client-store meta table so they apply instantly and offline.
 */
export interface ReaderPreferences {
  theme?: string;
  pagination?: 'scroll' | 'paged';
  fontSize?: number;
  ttsRate?: number;
  ttsVoice?: string;
  /** Set once the user has seen the "download better voices" nudge. */
  voicePromptSeen?: boolean;
  /**
   * Which reader renders the page. 'webview' (default) is the mature shared-HTML
   * reader; 'native' is the experimental pure-RN reader (iOS-only, see
   * ink://inkread/specs/native-reader) — currently scroll-mode + native
   * selection. Device-local in spirit; harmless if it syncs.
   */
  readerEngine?: 'webview' | 'native';
}

const META_KEY = 'preferences';

export async function loadPreferences(): Promise<ReaderPreferences> {
  const store = await getClientStore();
  let prefs: ReaderPreferences = {};
  const cached = await store.getMeta(META_KEY);
  if (cached) {
    try {
      prefs = JSON.parse(cached) as ReaderPreferences;
    } catch {
      // Corrupt cache — a background refresh will repopulate it.
    }
  }
  // Refresh from the server in the BACKGROUND — opening a book must never wait
  // on the network. A reachable-but-unresponsive server (internet up, API host
  // dead) makes fetch hang for the full request timeout, so awaiting it here
  // stalled the reader; true airplane mode fails fast, which is why it "just
  // worked" and a black-holed server didn't. The cached copy stands until the
  // refresh lands (next open).
  void refreshPreferences();
  return prefs;
}

/** Best-effort server refresh of the cached preferences. Never throws. */
async function refreshPreferences(): Promise<void> {
  let response: Response;
  try {
    response = await apiFetch('/api/preferences');
  } catch {
    return; // offline / server unreachable — the cached copy stands
  }
  if (!response.ok) return;
  const { preferences } = (await response.json()) as { preferences: ReaderPreferences };
  const store = await getClientStore();
  const cached = await store.getMeta(META_KEY);
  let prefs: ReaderPreferences = {};
  if (cached) {
    try {
      prefs = JSON.parse(cached) as ReaderPreferences;
    } catch {
      prefs = {};
    }
  }
  await store.setMeta(META_KEY, JSON.stringify({ ...prefs, ...preferences }));
}

/** Merge a patch into the cache immediately; server write is best-effort. */
export async function savePreferences(patch: ReaderPreferences): Promise<void> {
  const store = await getClientStore();
  const cached = await store.getMeta(META_KEY);
  let prefs: ReaderPreferences = {};
  if (cached) {
    try {
      prefs = JSON.parse(cached) as ReaderPreferences;
    } catch {
      prefs = {};
    }
  }
  await store.setMeta(META_KEY, JSON.stringify({ ...prefs, ...patch }));
  void apiFetch('/api/preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).catch(() => undefined);
}
