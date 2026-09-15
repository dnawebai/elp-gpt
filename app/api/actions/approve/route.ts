import { NextResponse } from 'next/server';
import { approveGovernedAction } from '@/lib/action-approval';
import { resolveZeroTrustAuthority } from '@/lib/zero-trust-authority';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const context = await resolveZeroTrustAuthority(request);
  if (!context) return NextResponse.json({ error: 'Identity not established or delegated session revoked.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid approval request.' }, { status: 400 });
  }

  const result = await approveGovernedAction(context, body as Record<string, unknown>);
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store, private' },
  });
}
