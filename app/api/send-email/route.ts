import { NextRequest, NextResponse } from 'next/server';
import { sendEmailViaResend } from '@/lib/sendEmail';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const result = await sendEmailViaResend(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status || 500 });
  }
  return NextResponse.json({ id: result.id });
}
