// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
//
// Adapted from AmazonAppDev/react-native-multi-tv-app-sample apps/vega/metro.config.js.
// Kinwise is a single standalone package (no shared-ui workspace, no navigation library),
// so the sample's watchFolders and @react-navigation / gesture-handler remaps are not needed.

const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const path = require('path');

/**
 * Metro configuration for the Kinwise Vega app.
 * https://facebook.github.io/metro/docs/configuration
 *
 * `*.vega.tsx` / `*.vega.ts` files override their plain counterparts on Vega
 * (src/config.vega.ts, src/remote.vega.ts, src/theme/scale.vega.ts,
 * src/components/FamilyVideo.vega.tsx). The plain files are what the browser
 * preview (packages/tv-preview, react-native-web) bundles.
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  resolver: {
    sourceExts: ['vega.tsx', 'vega.ts', 'vega.js', 'tsx', 'ts', 'jsx', 'js', 'json'],
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
    // Pin the singletons to this package so a copy elsewhere in the monorepo is never bundled.
    extraNodeModules: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-native': path.resolve(__dirname, 'node_modules/react-native'),
      '@babel/runtime': path.resolve(__dirname, 'node_modules/@babel/runtime'),
    },
    resolverMainFields: ['react-native', 'browser', 'main'],
    platforms: ['native', 'ios', 'android', 'tv'],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
