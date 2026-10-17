import { NextRequest, NextResponse } from 'next/server';
import { generateEmailFromPrompt } from '@/lib/generateEmail';

export async function POST(request: NextRequest) {
  const { prompt } = await request.json();
  const result = await generateEmailFromPrompt(prompt);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ text: result.text });
}
