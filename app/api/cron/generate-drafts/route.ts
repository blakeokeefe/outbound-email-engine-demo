import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';
import { fillTemplate } from '@/lib/templateUtils';
import { generateEmailFromPrompt } from '@/lib/generateEmail';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

function greetingFor(firstName?: string | null) {
  const clean = (firstName || '').trim();
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ''-]{2,30}$/.test(clean)) return 'Hi,';
  const fixed = clean === clean.toUpperCase() || clean === clean.toLowerCase()
    ? clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase() : clean;
  return `Hi ${fixed},`;
}

export async function GET() {
  const { data: campaigns, error: campErr } = await supabase
    .from('campaigns').select('*').eq('sending_enabled', true);
  if (campErr) return NextResponse.json({ error: campErr.message }, { status: 500 });

  const today = new Date().toISOString().slice(0, 10);
  const results = [];

  for (const campaign of campaigns || []) {
    const { count: alreadyToday } = await supabase
      .from('email_queue')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaign.id)
      .eq('batch_date', today);

    const remaining = campaign.daily_send_limit - (alreadyToday || 0);
    if (remaining <= 0) {
      results.push({ campaign: campaign.slug, drafted: 0, reason: 'daily cap reached' });
      continue;
    }

    const { data: pending } = await supabase
      .from('email_queue').select('lead_id')
      .eq('campaign_id', campaign.id).eq('status', 'pending_review');
    const excludeIds = (pending || []).map(r => r.lead_id);

    let query = supabase.from('leads').select('*')
      .eq('campaign_id', campaign.id).eq('status', 'New').neq('source', 'existing').limit(remaining);
    if (excludeIds.length) query = query.not('id', 'in', `(${excludeIds.join(',')})`);

    const { data: candidateLeads, error: leadsErr } = await query;
    if (leadsErr) { results.push({ campaign: campaign.slug, error: leadsErr.message }); continue; }

    let drafted = 0;
    const failed: { org: string; reason: string }[] = [];
    for (const lead of candidateLeads || []) {
      const leadTitle = lead.title || lead.contact || campaign.config.default_contact_role;
      const prompt = fillTemplate(campaign.config.email_prompt_template, {
        tone: 'professional',
        campaign_label: campaign.config.campaign_labels['cold'] || 'cold first-touch outreach',
        lead_org: lead.org, lead_title: leadTitle, lead_location: lead.location, lead_type: lead.type,
        extra_context_line: '',
        greeting: greetingFor(lead.first_name),
      });

      const genResult = await generateEmailFromPrompt(prompt);
      if (!genResult.ok) { failed.push({ org: lead.org, reason: genResult.error || 'Claude call failed' }); continue; }
      const draftText = genResult.text;

      const lines = draftText.split('\n');
      const subjectIdx = lines.findIndex((ln: string) => ln.toLowerCase().startsWith('subject:'));
      const subject = subjectIdx >= 0 ? lines[subjectIdx].replace(/^subject:\s*/i, '').trim() : '—';
      const body = lines.filter((_: string, i: number) => i !== subjectIdx).join('\n').trim();

      const { error: insertErr } = await supabase.from('email_queue').insert({
        campaign_id: campaign.id, lead_id: lead.id, subject, body, batch_date: today,
      });
      if (insertErr) { failed.push({ org: lead.org, reason: insertErr.message }); } else { drafted++; }
    }
    results.push({ campaign: campaign.slug, drafted, failed });
  }

  return NextResponse.json({ results });
}
