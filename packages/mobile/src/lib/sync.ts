import { SyncEngine } from '@inkread/client-store';
import { getClientStore } from '../store/clientStore';
import { apiFetch } from './api';
import { flushOutbox } from './libraryData';

let syncing = false;
let lastSyncAt = 0;
const SYNC_MIN_INTERVAL_MS = 60_000;

/** Pull the library into the on-device cache; cheap to call on focus. */
export async function syncNow(force = false): Promise<void> {
  if (syncing) return;
  if (!force && Date.now() - lastSyncAt < SYNC_MIN_INTERVAL_MS) return;
  syncing = true;
  try {
    // Push queued offline writes first, then pull — so the pull returns them as
    // canonical instead of an older set that would look like they were lost.
    await flushOutbox();
    const store = await getClientStore();
    await new SyncEngine(store, (path) => apiFetch(path)).pull();
    lastSyncAt = Date.now();
  } finally {
    syncing = false;
  }
}
