/// <reference types="vitest/config" />
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const tvApp = path.resolve(here, '../tv-app');

/** Resolve *.web.* before plain files, like react-native-web projects do. Never *.vega.* (Vega-only). */
const extensions = ['.web.tsx', '.web.ts', '.web.jsx', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{find: /^react-native$/, replacement: 'react-native-web'}],
    extensions,
    // tv-app/src has no node_modules of its own on Windows: resolve shared packages from here, once.
    dedupe: ['react', 'react-dom', 'react-native-web', 'react-tv-space-navigation'],
  },
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
    // react-native-web's Animated reads React Native's `global`.
    global: 'globalThis',
  },
  // tv-app/tsconfig.json extends @tsconfig/react-native, which only exists on the Vega build machine.
  // A string tsconfigRaw stops esbuild from loading it for files under ../tv-app.
  esbuild: {
    tsconfigRaw: JSON.stringify({
      compilerOptions: {jsx: 'react-jsx', target: 'es2022', useDefineForClassFields: true, verbatimModuleSyntax: false},
    }),
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'react-native-web', 'react-tv-space-navigation'],
    esbuildOptions: {
      resolveExtensions: extensions,
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    fs: {allow: [here, tvApp]},
  },
  preview: {
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}', '../tv-app/test/**/*.spec.{ts,tsx}'],
    // react-tv-space-navigation ships a UMD bundle that require()s 'react-native'. Pre-bundle it
    // with esbuild (which applies the react-native → react-native-web alias), as the dev server does.
    deps: {
      optimizer: {
        web: {
          enabled: true,
          include: ['react-tv-space-navigation', 'react-native-web'],
        },
      },
    },
  },
});
