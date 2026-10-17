export async function findEmailForDomain(domain, roleHint, expectedOrgName) {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) return { ok: false, error: 'HUNTER_API_KEY is not configured on the server' };
  try {
    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${apiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) return { ok: false, error: `Hunter Domain Search error: ${await resp.text()}` };
    const data = await resp.json();

    // Safety check: Hunter's response includes which organization it actually
    // resolved this domain to. If that doesn't roughly match the org name
    // Claude was looking for, the domain guess was likely wrong — a real but
    // unrelated organization's email could otherwise get attached to the
    // wrong lead. Reject rather than trust a mismatched result.
    const resolvedOrg = (data?.data?.organization || '').toLowerCase().trim();
    const expected = (expectedOrgName || '').toLowerCase().trim();
    if (expected && resolvedOrg) {
      const relatedEnough = resolvedOrg.includes(expected) || expected.includes(resolvedOrg)
        || resolvedOrg.split(' ').some(w => w.length > 3 && expected.includes(w));
      if (!relatedEnough) return { ok: true, email: null, rejected_reason: `domain resolved to "${data.data.organization}", not "${expectedOrgName}"` };
    }

    const emails = data?.data?.emails || [];
    if (!emails.length) return { ok: true, email: null };

    // Prefer an email whose listed position loosely matches the suggested contact role;
    // otherwise fall back to the highest-confidence result Hunter returned.
    const roleMatch = roleHint
      ? emails.find(e => e.position && roleHint.toLowerCase().split(' ')
          .some(word => word.length > 3 && e.position.toLowerCase().includes(word)))
      : null;
    const best = roleMatch || emails.reduce((a, b) => (b.confidence > (a?.confidence || 0) ? b : a), null);
    return { ok: true, email: best?.value || null, confidence: best?.confidence || null, first_name: best?.first_name || null, last_name: best?.last_name || null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
