/**
 * Environment for the integration suite. Imported by the vitest config (for the
 * test workers) and by the global setup (which creates the database).
 *
 * The database is DROPPED and recreated on every run, so its name must say it is
 * for tests. Override with INTEGRATION_DATABASE_URL.
 */
export const INTEGRATION_DATABASE_URL =
  process.env.INTEGRATION_DATABASE_URL ?? 'postgres://atims:atims@localhost:5432/atims_integration';

export function assertDisposable(url: string): string {
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  if (!/(test|integration)/i.test(name)) {
    throw new Error(`refusing to recreate database "${name}": its name must contain "test" or "integration"`);
  }
  return name;
}

/** Everything the API reads from the environment, pinned so a local api/.env cannot leak in. */
export const integrationEnv: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: INTEGRATION_DATABASE_URL,
  JWT_SECRET: 'integration-test-secret-not-for-production',
  CORS_ORIGINS: 'http://localhost:5173',
  // No email provider: codes come back as dev_code. No object storage: hash-only evidence.
  RESEND_API_KEY: '',
  MINIO_ENDPOINT: '',
  MINIO_ACCESS_KEY: '',
  MINIO_SECRET_KEY: '',
  ATIMS_ADMIN_PASSWORD: '',
  PUBLIC_APP_URL: 'http://localhost:5173',
};
