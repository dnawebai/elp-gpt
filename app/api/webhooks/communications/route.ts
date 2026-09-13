import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { recordInboundEvent, type EventProvider } from '@/lib/event-fabric';
import { runInterruptManager } from '@/lib/interrupt-manager';
import { getOwnerProfileId } from '@/lib/owner';

export const runtime = 'nodejs';
export const maxDuration = 300;

function authorised(request: Request) {
  const expected = process.env.ELP_EVENT_INGRESS_TOKEN?.trim(); const supplied = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/)?.[1];
  if (!expected || !supplied) return false; const a = Buffer.from(expected); const b = Buffer.from(supplied); return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorised(request)) return NextResponse.json({ ok: false }, { status: 401 });
  const profileId = getOwnerProfileId(); if (!profileId) return NextResponse.json({ ok: false }, { status: 503 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null; const provider = String(body?.provider || '') as EventProvider;
  if (!['gmail','outlook','teams','slack','github','whatsapp','generic'].includes(provider)) return NextResponse.json({ error: 'Unsupported provider.' }, { status: 400 });
  const event = await recordInboundEvent(profileId, { provider, type: typeof body?.type === 'string' ? body.type : 'change', sourceId: typeof body?.sourceId === 'string' ? body.sourceId : undefined, summary: typeof body?.summary === 'string' ? body.summary : undefined, metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata as Record<string, unknown> : undefined });
  const interrupt = await runInterruptManager({ profileId, persist: true }).catch(() => null);
  return NextResponse.json({ ok: true, eventId: event?.id, replanned: interrupt?.replanned || false });
}
