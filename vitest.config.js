import { defineConfig } from 'vitest/config';

// Plain Node test environment — these are integration tests against a
// local Supabase Postgres/Auth stack, not component/DOM tests, so no
// jsdom/react plugin is needed here.
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/env.setup.js'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
