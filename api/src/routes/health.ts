import type { FastifyInstance } from 'fastify';

export default async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({
    ok: true,
    service: 'atims-api',
    version: app.version,
    time: new Date().toISOString(),
  }));
}
