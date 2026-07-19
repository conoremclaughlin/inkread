import { requireOptionalNativeModule } from 'expo-modules-core';

let configured = false;

/**
 * Route speech through the iOS "playback" audio session so it stays audible
 * even when the hardware ring/silent switch is flipped — the way every
 * audiobook app (Books, Audible) behaves.
 *
 * Without this, expo-speech's AVSpeechSynthesizer runs on the default `ambient`
 * session, which the mute switch silences. That's exactly why Listen worked in
 * the simulator (no mute switch) but was dead on the device.
 *
 * We probe for the native module with `requireOptionalNativeModule` (which
 * returns null instead of throwing) so a JS reload against a build that
 * predates expo-audio degrades quietly rather than tripping a red-box — the
 * native module lands once the app is rebuilt. Runs its work once, on success.
 */
export async function ensureListeningAudioSession(): Promise<void> {
  if (configured) return;
  if (!requireOptionalNativeModule('ExpoAudio')) return;
  try {
    const { setAudioModeAsync } = require('expo-audio') as typeof import('expo-audio');
    await setAudioModeAsync({ playsInSilentMode: true });
    configured = true;
  } catch {
    // Session couldn't be set; speech still plays whenever the phone isn't muted.
  }
}
