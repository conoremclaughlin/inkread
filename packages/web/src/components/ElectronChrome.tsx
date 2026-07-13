'use client';

import { useEffect, useState } from 'react';

/**
 * Inside the Electron shell (hidden title bar), lay a thin draggable strip
 * along the top of every page so the window can be moved. The reader header
 * adds its own drag region + traffic-light padding.
 */
export function ElectronChrome() {
  const [isElectron, setIsElectron] = useState(false);
  useEffect(() => {
    setIsElectron(navigator.userAgent.includes('Electron'));
  }, []);
  if (!isElectron) return null;
  return <div aria-hidden className="electron-drag fixed inset-x-0 top-0 z-40 h-6" />;
}
