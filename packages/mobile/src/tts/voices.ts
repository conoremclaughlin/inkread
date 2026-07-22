import * as Speech from 'expo-speech';

export type VoiceQuality = 'premium' | 'enhanced' | 'default';

export interface VoiceOption {
  identifier: string;
  name: string;
  quality: VoiceQuality;
  language: string;
}

const QUALITY_ORDER: Record<VoiceQuality, number> = { premium: 3, enhanced: 2, default: 1 };

/**
 * iOS reports voice quality inconsistently — sometimes on `quality`, sometimes
 * only encoded in the identifier ("...premium", "...enhanced"). Check both.
 */
function classify(voice: Speech.Voice): VoiceQuality {
  const hay = `${voice.quality ?? ''} ${voice.identifier ?? ''}`.toLowerCase();
  if (hay.includes('premium')) return 'premium';
  if (hay.includes('enhanced')) return 'enhanced';
  return 'default';
}

/** Available voices for a language, best quality first, de-duplicated. */
export async function listVoices(language = 'en'): Promise<VoiceOption[]> {
  const voices = await Speech.getAvailableVoicesAsync();
  const lang = language.toLowerCase().slice(0, 2);
  const forLang = voices.filter((v) => v.language?.toLowerCase().startsWith(lang));
  const pool = forLang.length > 0 ? forLang : voices;

  const seen = new Set<string>();
  const options: VoiceOption[] = [];
  for (const v of pool) {
    if (!v.identifier || seen.has(v.identifier)) continue;
    seen.add(v.identifier);
    options.push({
      identifier: v.identifier,
      name: v.name || v.identifier,
      quality: classify(v),
      language: v.language ?? language,
    });
  }
  return options.sort((a, b) => {
    const byQuality = QUALITY_ORDER[b.quality] - QUALITY_ORDER[a.quality];
    return byQuality !== 0 ? byQuality : a.name.localeCompare(b.name);
  });
}

/** True when at least one enhanced/premium voice is installed for the language. */
export async function hasUpgradedVoice(language = 'en'): Promise<boolean> {
  const list = await listVoices(language);
  return list.some((v) => v.quality !== 'default');
}

/**
 * The voice to speak with: the user's saved pick when it's still installed,
 * otherwise the best available (enhanced/premium ahead of default).
 */
export async function resolveVoice(
  language = 'en',
  preferredId?: string,
): Promise<VoiceOption | undefined> {
  const list = await listVoices(language);
  if (preferredId) {
    const chosen = list.find((v) => v.identifier === preferredId);
    if (chosen) return chosen;
  }
  return list[0];
}

export const QUALITY_LABEL: Record<VoiceQuality, string> = {
  premium: 'Premium',
  enhanced: 'Enhanced',
  default: 'Standard',
};
