export async function generateEmailFromPrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    return { ok: false, error: 'prompt is required', status: 400 };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'ANTHROPIC_API_KEY is not configured on the server', status: 500 };
  }
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return { ok: false, error: `Anthropic API error: ${errText}`, status: resp.status };
    }
    const data = await resp.json();
    const text = (data.content || []).map((b) => b.text || '').join('').trim();
    return { ok: true, text };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, error: message, status: 500 };
  }
}
