/**
 * Integration suite: the real Fastify app on a real PostgreSQL database.
 * Not part of `npm test` (unit tests need no database). Run it with:
 *
 *   cd api && npx vitest run --config test/integration/vitest.config.ts
 *
 * Needs a PostgreSQL server; see env.ts for the connection (INTEGRATION_DATABASE_URL).
 */
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { integrationEnv } from './env.js';

export default defineConfig({
  root: resolve(import.meta.dirname, '../..'),
  test: {
    include: ['test/integration/**/*.integration.ts'],
    globalSetup: ['test/integration/globalSetup.ts'],
    env: integrationEnv,
    testTimeout: 240_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
