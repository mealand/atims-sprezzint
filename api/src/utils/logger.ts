import pino from 'pino';
import { isProd } from '../config.js';

export const logger = pino({
  level: isProd ? 'info' : 'debug',
  base: { service: 'atims-api' },
});

export { logger as requestLoggerChild };
