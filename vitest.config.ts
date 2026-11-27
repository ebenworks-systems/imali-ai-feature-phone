import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': new URL('./src/', import.meta.url).pathname
    }
  },
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    // Most tests take 150 to 350 ms alone, but on a heavily loaded machine some passed vitest's 5 s default
    // (10 s for hooks), so every test and hook gets 30 s.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*'],
      exclude: ['**/*.test.ts', '**/*.d.ts']
    },
    name: 'ledger-core'
  }
});
