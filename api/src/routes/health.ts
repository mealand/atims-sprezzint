import type { FastifyInstance } from 'fastify';
import { storageEnabled } from '../services/storage.js';

export default async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({
    ok: true,
    service: 'atims-api',
    version: app.version,
    time: new Date().toISOString(),
    storage: {
      enabled: storageEnabled,
      public_endpoint: process.env.MINIO_ENDPOINT_PUBLIC ?? null,
    },
  }));
}
