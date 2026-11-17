import { defineConfig } from 'vitest/config';

// Integration tests against the real Postgres from docker compose
// (needs migrations + seed applied). Run with `npm run test:db`.
export default defineConfig({
  test: {
    include: ['tests/**/*.db.test.ts'],
    testTimeout: 20000,
  },
});
