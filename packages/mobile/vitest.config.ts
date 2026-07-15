import { defineConfig } from 'vitest/config';

/**
 * Node-environment unit tests for the mobile package's pure logic (TTS queue,
 * preferences merging, etc.). Native modules like expo-speech are mocked per
 * test — these never touch the RN runtime. Screens/components aren't covered
 * here; that would need a React Native test renderer.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
