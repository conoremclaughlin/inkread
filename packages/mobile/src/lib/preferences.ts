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
      // Corrupt cache — fall through to the server copy.
    }
  }
  try {
    const response = await apiFetch('/api/preferences');
    if (response.ok) {
      const { preferences } = (await response.json()) as { preferences: ReaderPreferences };
      prefs = { ...prefs, ...preferences };
      await store.setMeta(META_KEY, JSON.stringify(prefs));
    }
  } catch {
    // Offline — the cached copy stands.
  }
  return prefs;
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
