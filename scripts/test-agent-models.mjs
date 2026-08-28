// Verify the 5 requested agent-router models against the live gateway.
// Records: ok/fail, HTTP status, latency, token usage, finish reason.
// Never prints key material.
import ZAI from 'z-ai-web-dev-sdk';

const MODELS = [
  'claude-opus-5',
  'claude-opus-4-8',
  'deepseek-v4-flash',
  'glm-5.3',
  'gpt-5.6-sol',
];

const zai = await ZAI.create();

for (const model of MODELS) {
  await new Promise((r) => setTimeout(r, 8000));
  const startedAt = Date.now();
  try {
    const res = await zai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      stream: false,
      thinking: { type: 'disabled' },
    });
    const latency = Date.now() - startedAt;
    const choice = res.choices?.[0];
    const content = choice?.message?.content ?? '';
    console.log(
      JSON.stringify({
        model,
        ok: true,
        latencyMs: latency,
        finishReason: choice?.finish_reason ?? null,
        usage: res.usage ?? null,
        contentPreview: String(content).slice(0, 60),
      })
    );
  } catch (err) {
    console.log(
      JSON.stringify({
        model,
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: String(err?.message || err).slice(0, 300),
      })
    );
  }
}
