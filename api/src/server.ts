import { buildApp } from './app.js';
import { env } from './config.js';

const app = await buildApp();
await app.listen({ port: env.PORT, host: '0.0.0.0' });
console.log(`▲ ATiMs API listening on :${env.PORT} (${env.NODE_ENV})`);
