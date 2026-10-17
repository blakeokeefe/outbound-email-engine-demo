import { textToHtml } from './emailHtml.js';

export async function sendEmailViaResend({ from, to, subject, text, html }) {
  if (!from || !to || !subject || !text) {
    return { ok: false, error: 'from, to, subject, and text are required' };
  }

  // Safety switch: in demo mode nothing is ever sent. The rest of the flow
  // (approve, mark as sent, update lead status) still runs so it can be shown.
  if (process.env.DEMO_MODE === 'true') {
    return { ok: true, id: 'demo-not-sent' };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'RESEND_API_KEY is not configured on the server' };
  }
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from, to, subject, text, html: html || textToHtml(text) }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return { ok: false, error: `Resend API error: ${errText}`, status: resp.status };
    }
    const data = await resp.json();
    return { ok: true, id: data.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, error: message };
  }
}
