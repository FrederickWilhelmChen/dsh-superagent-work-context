// Adapted from zjuatri/dsh-feishu-plugin lib/summary.mjs (MIT).
import { randomUUID } from 'node:crypto';

/**
 * Collect assistant text from an LLM stream.
 *
 * `ctx.llm.stream()` yields typed chunks and normalizes adapter failures into
 * a terminal `finish` reason, so a non-`stop` finish with no text is a real
 * failure worth reporting rather than an empty summary.
 *
 * @param {AsyncIterable<any>} stream - chunk stream.
 * @returns {Promise<{ text: string, finishReason: unknown }>} joined text.
 */
export async function collectStreamText(stream) {
  let text = '';
  let finishReason;
  for await (const chunk of stream) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text;
    else if (chunk?.type === 'finish') finishReason = chunk.reason;
  }
  return { text, finishReason };
}

export async function requestJson(llm, route, system, input, signal) {
  const message = {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: JSON.stringify(input) }],
    source: { kind: 'plugin', plugin: 'dsh-superagent-work-context' },
  };
  const { text, finishReason } = await collectStreamText(llm.stream({
    ...route, system, messages: [message], temperature: 0.2, signal,
  }));
  const reason = typeof finishReason === 'string' ? finishReason : finishReason?.kind;
  if (!text.trim() || (reason !== 'stop' && reason !== 'end_turn')) {
    throw new Error(`Work-context model did not finish normally (${reason ?? 'unknown'})`);
  }
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i.exec(trimmed);
  try {
    return JSON.parse(fence?.[1] ?? trimmed);
  } catch (error) {
    throw new Error('Work-context model returned malformed JSON', { cause: error });
  }
}
