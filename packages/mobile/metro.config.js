// Metro configuration for this package inside the yarn-workspaces monorepo.
// Without this, Metro's server root is detected as the repo root, so Expo Go's
// manifest request for /index.bundle can't resolve the entry and fails with
// "UnexpectedServerData: No returned query result".
// See: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the whole monorepo so changes in packages/core, packages/client-store
//    hot-reload the app.
config.watchFolders = [workspaceRoot];

// 2. Resolve modules from this package first, then the hoisted root node_modules.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
