'use client';

import { useIsElectron } from '@/lib/useIsElectron';

/**
 * Inside the Electron shell (hidden title bar), lay a thin draggable strip
 * along the top of every page so the window can be moved. The reader header
 * adds its own drag region + traffic-light padding.
 */
export function ElectronChrome() {
  const isElectron = useIsElectron();
  if (!isElectron) return null;
  return <div aria-hidden className="electron-drag fixed inset-x-0 top-0 z-40 h-6" />;
}
