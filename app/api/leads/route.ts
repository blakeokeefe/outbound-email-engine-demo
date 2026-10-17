import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';

export async function GET(request: NextRequest) {
  const campaignId = request.nextUrl.searchParams.get('campaign_id');
  let query = supabase.from('leads').select('*').order('id', { ascending: true });
  if (campaignId) query = query.eq('campaign_id', campaignId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  if (!body.org || typeof body.org !== 'string' || !body.org.trim()) {
    return NextResponse.json({ error: 'org is required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('leads')
    .insert({
      org: body.org,
      contact: body.contact ?? '',
      first_name: body.first_name ?? null,
      email: body.email ?? '',
      title: body.title ?? '',
      location: body.location ?? '',
      type: body.type ?? 'School District',
      status: body.status ?? 'New',
      source: body.source ?? 'manual',
      campaign_id: body.campaign_id ?? null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
