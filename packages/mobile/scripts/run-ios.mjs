// Build + run the app on a connected device with EXPO_PUBLIC_API_URL baked to
// this Mac's current LAN IP.
//
// Why: a dev build reads the API host from Metro at runtime (see src/lib/api.ts),
// but a *Release* build has no Metro — so without help it falls back to
// localhost, which on a phone is the phone itself, and never reaches the web
// API on the Mac. Computing the IP at build time keeps this self-healing across
// network/DHCP changes, the same way the dev path does — just resolved earlier.
//
// An explicit EXPO_PUBLIC_API_URL (e.g. a real deployed API for a shipping
// build) is always respected and never overwritten.
//
// -allowProvisioningUpdates is NOT added here — `expo run:ios` already passes it
// for device builds (see @expo/cli run/ios/XcodeBuild.js). The recurring
// free-team signing prompt is a one-time Xcode "Automatically manage signing"
// bootstrap, after which that flag renews the 7-day profile on each build.

import { spawn } from 'node:child_process';
import os from 'node:os';

const WEB_API_PORT = 6021;

/** This machine's LAN IPv4 — prefer en0/en1 (Wi-Fi/Ethernet on macOS). */
function lanIp() {
  const interfaces = os.networkInterfaces();
  const preferred = ['en0', 'en1'];
  const names = [...preferred, ...Object.keys(interfaces).filter((n) => !preferred.includes(n))];
  for (const name of names) {
    for (const info of interfaces[name] ?? []) {
      const isIpv4 = info.family === 'IPv4' || info.family === 4;
      if (isIpv4 && !info.internal) return info.address;
    }
  }
  return undefined;
}

const env = { ...process.env, EXPO_OFFLINE: '1' };
if (!env.EXPO_PUBLIC_API_URL) {
  const ip = lanIp();
  if (ip) {
    env.EXPO_PUBLIC_API_URL = `http://${ip}:${WEB_API_PORT}`;
    console.log(`[run-ios] baking EXPO_PUBLIC_API_URL=${env.EXPO_PUBLIC_API_URL} (this Mac's LAN IP)`);
    console.log('[run-ios] make sure the web API is running:  yarn workspace @inkread/web dev');
  } else {
    console.warn(
      '[run-ios] no LAN IP found — the build will fall back to localhost and a device ' +
        'will not reach the web server. Set EXPO_PUBLIC_API_URL manually if needed.',
    );
  }
}

// Forward any extra args (e.g. --configuration Release) after `run:ios --device`.
const child = spawn('expo', ['run:ios', '--device', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});
child.on('error', (error) => {
  console.error('[run-ios] failed to launch expo:', error.message);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 0));
