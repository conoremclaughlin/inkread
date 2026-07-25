import { describe, expect, it } from 'vitest';
import { relativeTime } from './relativeTime';

const NOW = Date.parse('2026-07-25T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('relativeTime', () => {
  it('says "just now" under 45 seconds', () => {
    expect(relativeTime(ago(10_000), NOW)).toBe('just now');
    expect(relativeTime(ago(44_000), NOW)).toBe('just now');
  });

  it('counts minutes, hours, and days', () => {
    expect(relativeTime(ago(5 * 60_000), NOW)).toBe('5m ago');
    expect(relativeTime(ago(3 * 3_600_000), NOW)).toBe('3h ago');
    expect(relativeTime(ago(2 * 86_400_000), NOW)).toBe('2d ago');
  });

  it('falls back to a date past a week', () => {
    const out = relativeTime(ago(10 * 86_400_000), NOW);
    expect(out).not.toMatch(/ago|just now/);
    expect(out.length).toBeGreaterThan(0);
  });

  it('returns empty for an invalid timestamp', () => {
    expect(relativeTime('not-a-date', NOW)).toBe('');
  });
});
