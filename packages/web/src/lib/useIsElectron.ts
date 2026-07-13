'use client';

import { useEffect, useState } from 'react';

/**
 * True inside the Electron shell — or in any browser with `?electron-sim`
 * appended, so the desktop chrome (drag regions, traffic-light padding) can
 * be previewed and driven by Playwright without launching Electron.
 */
export function useIsElectron(): boolean {
  const [isElectron, setIsElectron] = useState(false);
  useEffect(() => {
    setIsElectron(
      navigator.userAgent.includes('Electron') ||
        new URLSearchParams(window.location.search).has('electron-sim'),
    );
  }, []);
  return isElectron;
}
