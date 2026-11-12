import 'dotenv/config';
import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgres://atims:atims@localhost:5432/atims'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars — use openssl rand -hex 32'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  OLLAMA_URL: z.string().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('llama3.1:8b'),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
