import { buildApp } from './app.js';
import { env } from './config.js';
import { startAnchorJob } from './services/anchorJob.js';

const app = await buildApp();
startAnchorJob();
await app.listen({ port: env.PORT, host: '0.0.0.0' });
console.log(`▲ ATiMs API listening on :${env.PORT} (${env.NODE_ENV})`);
