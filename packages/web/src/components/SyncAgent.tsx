'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { syncNow } from '@/lib/localdb';

const PUBLIC_PATHS = ['/login', '/signup', '/auth'];

/**
 * Keeps the on-device SQLite cache fresh: syncs on load and whenever the
 * app regains focus (rate-limited inside syncNow). Failures are fine —
 * offline is exactly the case the cache exists for.
 */
export function SyncAgent() {
  const pathname = usePathname();
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  useEffect(() => {
    if (isPublic) return;
    void syncNow().catch(() => undefined);
    const onFocus = () => void syncNow().catch(() => undefined);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [isPublic]);

  return null;
}
