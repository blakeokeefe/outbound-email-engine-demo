import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';
import { findEmailForDomain } from '@/lib/hunterEnrich';

function isDuplicateOrg(candidateOrg: string, exclusionList: string[]) {
  const normalize = (s: string) => s.toLowerCase().trim().replace(/[^\w\s]/g, '');
  const candidate = normalize(candidateOrg);
  if (candidate.length < 5) return exclusionList.some(e => normalize(e) === candidate);
  return exclusionList.some(existing => {
    const norm = normalize(existing);
    return candidate === norm || candidate.includes(norm) || norm.includes(candidate);
  });
}

export async function POST(request: NextRequest) {
  const { prompt, campaignId } = await request.json();

  if (!prompt || typeof prompt !== 'string') {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured on the server' }, { status: 500 });
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
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return NextResponse.json({ error: `Anthropic API error: ${errText}` }, { status: resp.status });
    }

    const data = await resp.json();
    const raw = (data.content || [])
      .map((b: { text?: string }) => b.text || '')
      .join('')
      .replace(/```json|```/g, '')
      .trim();

    let items: { org: string; domain?: string; contact_title?: string; [key: string]: unknown }[];
    try {
      items = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'Could not parse AI response as JSON' }, { status: 502 });
    }

    if (campaignId) {
      const { data: currentLeads } = await supabase.from('leads').select('org').eq('campaign_id', campaignId);
      const currentOrgs = (currentLeads || []).map((l: { org: string }) => l.org);
      const { data: campaignRow } = await supabase.from('campaigns').select('config').eq('id', campaignId).single();
      const historicalOrgs: string[] = campaignRow?.config?.previous_customer_orgs || [];
      const exclusions = [...currentOrgs, ...historicalOrgs];
      items = items.filter(item => !isDuplicateOrg(item.org, exclusions));
    }

    for (const item of items) {
      if (!item.domain) continue;
      const emailResult = await findEmailForDomain(item.domain, item.contact_title, item.org);
      if (emailResult.ok && emailResult.email) {
        item.email = emailResult.email;
        item.email_confidence = emailResult.confidence;
        item.first_name = emailResult.first_name ?? null;
        const nameParts = [emailResult.first_name, emailResult.last_name].filter((p): p is string => Boolean(p && p.trim()));
        if (nameParts.length) item.contact_name = nameParts.join(' ');
      }
    }

    return NextResponse.json(items);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
