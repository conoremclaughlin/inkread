/**
 * Books have no cover art, so we give each series a stable, tasteful "spine"
 * colour derived from its title — warm, muted, literary tones that sit inside
 * the paper palette. Deterministic so a series always looks the same.
 */

export interface CoverPalette {
  /** Background of the cover block. */
  bg: string;
  /** Ink used for the initials drawn on the cover. */
  fg: string;
}

const PALETTES: CoverPalette[] = [
  { bg: '#8b5e3c', fg: '#f7efe4' }, // brown (house accent)
  { bg: '#4a5d4e', fg: '#eef2ea' }, // forest
  { bg: '#3f5468', fg: '#e9eff5' }, // slate blue
  { bg: '#7a4a52', fg: '#f6e9ea' }, // muted wine
  { bg: '#6b5b8a', fg: '#efeaf6' }, // dusk violet
  { bg: '#a9772f', fg: '#f9f0df' }, // amber
  { bg: '#3c6a63', fg: '#e6f1ee' }, // teal
];

/** Stable palette for a title (simple string hash → palette index). */
export function coverPalette(seed: string): CoverPalette {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return PALETTES[Math.abs(hash) % PALETTES.length]!;
}

/** Up to two initials from a title, for the cover block. */
export function coverInitials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
