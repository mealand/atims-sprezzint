/**
 * AI service — fully local, open source only (Ollama).
 * Deterministic core logic never depends on AI; every AI output is labelled
 * "generated" in the UI and stored with a `generated: true` flag when persisted.
 */
import { env } from '../config.js';

interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export async function chat(messages: ChatMessage[], opts: { maxTokens?: number } = {}): Promise<string> {
  const res = await fetch(`${env.OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: env.OLLAMA_MODEL,
      messages,
      stream: false,
      options: { num_predict: opts.maxTokens ?? 512 },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw Object.assign(new Error(`Ollama error ${res.status}`), { status: 502 });
  const body = (await res.json()) as { message?: { content: string } };
  return body.message?.content ?? '';
}

const FARMER_SYSTEM = [
  'You are the ATiMs assistant for smallholder farmers. Be concise, plain-language, and practical.',
  'You explain what the next stage gate requires and what documents/experiments they need.',
  'You never invent regulations or make claims about specific export destinations you do not know.',
  'You never change batch records — you only advise. You do not produce legal advice.',
].join('\n');

export async function farmerAssistant(question: string, batchContext: Record<string, unknown>): Promise<string> {
  return chat([
    { role: 'system', content: FARMER_SYSTEM },
    { role: 'user', content: `Batch context (CSV JSON):\n${JSON.stringify(batchContext)}\n\nQuestion: ${question}` },
  ]);
}

export async function inspectorSummarise(batchHistory: unknown[]): Promise<string> {
  return chat([
    { role: 'system', content: 'You are an inspection copilot. Summarise the batch event history and flag anomalies: long transit gaps, unusual quantity jumps, repeated actors, missing evidence. Mention nothing not present in the history.' },
    { role: 'user', content: JSON.stringify(batchHistory) },
  ], { maxTokens: 700 });
}
