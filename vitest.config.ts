import { defineConfig, configDefaults } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: './setupTests.ts',
    testTimeout: 120000,
    // `*.live.test.ts` files hit Leboncoin for real. They need PROXY_ENABLED,
    // PROXY_LIST and LBC_DATADOME_COOKIE to be set, which only Vercel has — so
    // they fail on every local run, keeping the suite permanently red and
    // training us to ignore failures. Run them deliberately with `pnpm test:live`.
    exclude: process.env.RUN_LIVE
      ? [...configDefaults.exclude]
      : [...configDefaults.exclude, '**/*.live.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/domain': path.resolve(__dirname, './src/domain'),
      '@/application': path.resolve(__dirname, './src/application'),
      '@/infrastructure': path.resolve(__dirname, './src/infrastructure'),
    },
  },
})

