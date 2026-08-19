/**
 * Reader palette — the colours both renderers paint with.
 *
 * The web reader turns these into CSS on real DOM; the mobile reader passes
 * them to React Native styles. Keeping the maths here (rather than in either
 * renderer) is what stops a highlight looking like two different colours
 * depending on which app you opened.
 */

/**
 * Reading color schemes, tuned for long-form readability: warm off-whites
 * over pure white to cut glare, ink colors at ~12:1 contrast rather than
 * pure black, and desaturated light text on near-black for dark modes to
 * avoid halation. 'light'/'dark' are aliases kept for older callers.
 */
export type ReaderTheme =
  | 'paper'
  | 'sepia'
  | 'calm'
  | 'quiet'
  | 'night'
  | 'midnight'
  | 'light'
  | 'dark';


export interface ReaderThemeColors {
  bg: string;
  fg: string;
  accent: string;
  hlAlpha: string;
}

export const READER_THEMES: Record<ReaderTheme, ReaderThemeColors> = {
  /** The inkread house palette — warm cream, matches the app chrome. */
  paper: { bg: '#faf7f2', fg: '#26221c', accent: '#8b5e3c', hlAlpha: '0.38' },
  /** Classic tanned-paper reading mode. */
  sepia: { bg: '#f5ecd9', fg: '#3a3226', accent: '#8b5e3c', hlAlpha: '0.4' },
  /** Soft sage — low-glare green tint, easy on tired eyes. */
  calm: { bg: '#edeee4', fg: '#333a2f', accent: '#5f7c4a', hlAlpha: '0.4' },
  /** Neutral light gray, for those who find warm tints muddy. */
  quiet: { bg: '#ececee', fg: '#2c2c31', accent: '#4a6d7c', hlAlpha: '0.38' },
  /** Near-black with desaturated ivory text — reading in the dark. */
  night: { bg: '#121212', fg: '#d8d4cd', accent: '#c9a227', hlAlpha: '0.45' },
  /** Deep blue-black — dark without the void. */
  midnight: { bg: '#12161f', fg: '#c9d0dc', accent: '#7d9cc0', hlAlpha: '0.45' },
  // Aliases for callers predating the expanded set.
  light: { bg: '#ffffff', fg: '#1a1a1a', accent: '#8b5e3c', hlAlpha: '0.35' },
  dark: { bg: '#121212', fg: '#d8d4cd', accent: '#c9a227', hlAlpha: '0.45' },
};

const THEMES = READER_THEMES;

export const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: '255, 210, 60',
  green: '110, 200, 120',
  blue: '100, 170, 240',
  pink: '240, 130, 170',
  purple: '175, 130, 230',
};

/** Themes whose page is dark enough that the reader's text is the light layer. */
export function isDarkTheme(theme: ReaderTheme): boolean {
  return theme === 'night' || theme === 'midnight' || theme === 'dark';
}

/**
 * The rgb triple to fill a highlight of `color` under `theme`. The palette is
 * tuned for dark text on a light page; on dark themes those bright, saturated
 * fills sit at nearly the same lightness as the ivory body text, so a highlight
 * washes the words out. For dark themes we pull each colour toward gray
 * (desaturate) and darken it, so the fill drops below the text in lightness —
 * the words read clearly on top while the hue is still recognisable.
 */
export function highlightRgb(color: string, theme: ReaderTheme): string {
  const raw = HIGHLIGHT_COLORS[color] ?? HIGHLIGHT_COLORS['yellow']!;
  if (!isDarkTheme(theme)) return raw;
  const [r, g, b] = raw.split(',').map((n) => parseInt(n.trim(), 10)) as [number, number, number];
  const gray = (r + g + b) / 3;
  const DESATURATE = 0.6; // keep 60% of the hue, 40% pulled toward gray
  const DARKEN = 0.62; // then scale brightness down
  const adjust = (c: number) => Math.round((c * DESATURATE + gray * (1 - DESATURATE)) * DARKEN);
  return `${adjust(r)}, ${adjust(g)}, ${adjust(b)}`;
}
