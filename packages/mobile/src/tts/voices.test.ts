import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('expo-speech', () => ({ getAvailableVoicesAsync: vi.fn() }));

import * as Speech from 'expo-speech';
import { hasUpgradedVoice, listVoices, resolveVoice } from './voices';

const getVoices = Speech.getAvailableVoicesAsync as unknown as Mock;

beforeEach(() => getVoices.mockReset());
afterEach(() => vi.useRealTimers());

describe('listVoices', () => {
  it('keeps the language, dedupes, classifies quality, and sorts best-first', async () => {
    getVoices.mockResolvedValue([
      { identifier: 'en-US.default', name: 'Samantha', language: 'en-US', quality: 'Default' },
      { identifier: 'en-US.enhanced', name: 'Ava', language: 'en-US' }, // "enhanced" in id
      { identifier: 'com.apple.voice.premium.en-US.Zoe', name: 'Zoe', language: 'en-US' },
      { identifier: 'en-US.default', name: 'dup', language: 'en-US' }, // duplicate id
      { identifier: 'fr-FR.default', name: 'Thomas', language: 'fr-FR' }, // other language
    ]);
    const list = await listVoices('en');
    expect(list.map((v) => v.name)).toEqual(['Zoe', 'Ava', 'Samantha']);
    expect(list.map((v) => v.quality)).toEqual(['premium', 'enhanced', 'default']);
  });

  it('falls back to all voices when none match the language', async () => {
    getVoices.mockResolvedValue([{ identifier: 'fr-FR.a', name: 'Thomas', language: 'fr-FR' }]);
    expect((await listVoices('en')).map((v) => v.identifier)).toEqual(['fr-FR.a']);
  });

  it('retries once when the first enumeration comes back empty (iOS cold start)', async () => {
    vi.useFakeTimers();
    getVoices
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ identifier: 'en-US.a', name: 'Samantha', language: 'en-US' }]);
    const pending = listVoices('en');
    await vi.advanceTimersByTimeAsync(400);
    const list = await pending;
    expect(getVoices).toHaveBeenCalledTimes(2);
    expect(list).toHaveLength(1);
  });

  it('returns [] when no voices are ever enumerated (retry still empty)', async () => {
    vi.useFakeTimers();
    getVoices.mockResolvedValue([]);
    const pending = listVoices('en');
    await vi.advanceTimersByTimeAsync(400);
    expect(await pending).toEqual([]);
    expect(getVoices).toHaveBeenCalledTimes(2); // tried once, retried once
  });
});

describe('resolveVoice / hasUpgradedVoice', () => {
  it('prefers the saved voice when still installed, else the best available', async () => {
    getVoices.mockResolvedValue([
      { identifier: 'premium.a', name: 'A', language: 'en-US' }, // classified premium
      { identifier: 'en-US.plain', name: 'B', language: 'en-US' },
    ]);
    expect((await resolveVoice('en', 'en-US.plain'))?.identifier).toBe('en-US.plain');
    // Saved pick gone → best available (the premium one) leads.
    expect((await resolveVoice('en', 'missing'))?.identifier).toBe('premium.a');
  });

  it('detects whether any upgraded voice is installed', async () => {
    getVoices.mockResolvedValue([{ identifier: 'en-US.plain', name: 'B', language: 'en-US' }]);
    expect(await hasUpgradedVoice('en')).toBe(false);
    getVoices.mockResolvedValue([{ identifier: 'enhanced.x', name: 'X', language: 'en-US' }]);
    expect(await hasUpgradedVoice('en')).toBe(true);
  });
});
