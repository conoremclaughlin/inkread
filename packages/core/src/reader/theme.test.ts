import { describe, expect, it } from 'vitest';
import {
  HIGHLIGHT_COLORS,
  highlightRgb,
  isDarkTheme,
  READER_THEMES,
  type ReaderTheme,
} from './theme';

describe('highlightRgb', () => {
  it('uses the raw palette on light themes', () => {
    expect(highlightRgb('yellow', 'paper')).toBe(HIGHLIGHT_COLORS.yellow);
    expect(highlightRgb('green', 'sepia')).toBe(HIGHLIGHT_COLORS.green);
  });

  it('falls back to yellow for an unknown colour', () => {
    expect(highlightRgb('chartreuse', 'paper')).toBe(HIGHLIGHT_COLORS.yellow);
  });

  it('desaturates and darkens on dark themes so text stays readable on top', () => {
    const [r, g, b] = highlightRgb('yellow', 'night')
      .split(',')
      .map((n) => parseInt(n.trim(), 10)) as [number, number, number];
    const [rawR, rawG, rawB] = HIGHLIGHT_COLORS.yellow!
      .split(',')
      .map((n) => parseInt(n.trim(), 10)) as [number, number, number];
    // Darker overall than the light-theme fill…
    expect(r + g + b).toBeLessThan(rawR + rawG + rawB);
    // …and less saturated (the spread between channels narrows).
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(
      Math.max(rawR, rawG, rawB) - Math.min(rawR, rawG, rawB),
    );
    // Still recognisably yellow: red/green lead blue.
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(b);
  });
});

describe('isDarkTheme', () => {
  it('classifies the dark palettes', () => {
    const dark: ReaderTheme[] = ['night', 'midnight', 'dark'];
    const light: ReaderTheme[] = ['paper', 'sepia', 'calm', 'quiet', 'light'];
    expect(dark.every(isDarkTheme)).toBe(true);
    expect(light.some(isDarkTheme)).toBe(false);
  });
});
