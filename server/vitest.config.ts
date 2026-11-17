import { defineConfig } from 'vitest/config';

// Unit tests: pure domain logic + service/API against an in-memory repository.
// No database required.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.db.test.ts'],
  },
});
