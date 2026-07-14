import { SyncEngine } from '@inkread/client-store';
import { getClientStore } from '../store/clientStore';
import { apiFetch } from './api';

let syncing = false;
let lastSyncAt = 0;
const SYNC_MIN_INTERVAL_MS = 60_000;

/** Pull the library into the on-device cache; cheap to call on focus. */
export async function syncNow(force = false): Promise<void> {
  if (syncing) return;
  if (!force && Date.now() - lastSyncAt < SYNC_MIN_INTERVAL_MS) return;
  syncing = true;
  try {
    const store = await getClientStore();
    await new SyncEngine(store, (path) => apiFetch(path)).pull();
    lastSyncAt = Date.now();
  } finally {
    syncing = false;
  }
}
