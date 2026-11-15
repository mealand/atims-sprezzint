import { buildApp } from './app.js';
import { env } from './config.js';
import { startAnchorJob } from './services/anchorJob.js';
import { ensureBucket } from './services/storage.js';

const app = await buildApp();
startAnchorJob();
void ensureBucket(); // idempotent; evidence bucket auto-created when MinIO/S3 is configured
await app.listen({ port: env.PORT, host: '0.0.0.0' });
console.log(`▲ ATiMs API listening on :${env.PORT} (${env.NODE_ENV})`);
