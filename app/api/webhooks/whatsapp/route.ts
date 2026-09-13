import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { recordInboundEvent } from '@/lib/event-fabric';
import { runInterruptManager } from '@/lib/interrupt-manager';
import { refreshNotifications } from '@/lib/notifications';
import { getOwnerProfileId } from '@/lib/owner';

export const runtime = 'nodejs';
export const maxDuration = 60;

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function verifySignature(body: string, header: string | null) {
  const secret = process.env.ELP_WHATSAPP_APP_SECRET?.trim();
  if (!secret || !header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  return safeEqual(header.slice('sha256='.length), expected);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode') || '';
  const token = url.searchParams.get('hub.verify_token') || '';
  const challenge = url.searchParams.get('hub.challenge') || '';
  const expected = process.env.ELP_WHATSAPP_VERIFY_TOKEN?.trim() || '';
  if (mode !== 'subscribe' || !expected || !safeEqual(token, expected) || !challenge) return new NextResponse('Forbidden', { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

function inboundMessages(payload: unknown) {
  const result: Array<{ id: string; from?: string; type?: string; text?: string }> = [];
  if (!payload || typeof payload !== 'object') return result;
  const entries = Array.isArray((payload as Record<string, unknown>).entry) ? (payload as Record<string, unknown>).entry as unknown[] : [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const changes = Array.isArray((entry as Record<string, unknown>).changes) ? (entry as Record<string, unknown>).changes as unknown[] : [];
    for (const change of changes) {
      if (!change || typeof change !== 'object') continue;
      const value = (change as Record<string, unknown>).value;
      if (!value || typeof value !== 'object') continue;
      const messages = Array.isArray((value as Record<string, unknown>).messages) ? (value as Record<string, unknown>).messages as unknown[] : [];
      for (const raw of messages) {
        if (!raw || typeof raw !== 'object') continue;
        const message = raw as Record<string, unknown>;
        const textObj = message.text && typeof message.text === 'object' ? message.text as Record<string, unknown> : null;
        const id = typeof message.id === 'string' ? message.id : '';
        if (!id) continue;
        result.push({
          id,
          ...(typeof message.from === 'string' ? { from: message.from } : {}),
          ...(typeof message.type === 'string' ? { type: message.type } : {}),
          ...(typeof textObj?.body === 'string' ? { text: textObj.body.slice(0, 1000) } : {}),
        });
      }
    }
  }
  return result;
}

export async function POST(request: Request) {
  const profileId = getOwnerProfileId();
  if (!profileId) return NextResponse.json({ ok: false, error: 'Owner profile is not configured.' }, { status: 503 });
  const body = await request.text();
  if (!verifySignature(body, request.headers.get('x-hub-signature-256'))) return NextResponse.json({ ok: false, error: 'Invalid webhook signature.' }, { status: 401 });
  let payload: unknown;
  try { payload = JSON.parse(body); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 }); }
  const messages = inboundMessages(payload);
  for (const message of messages) {
    await recordInboundEvent(profileId, {
      provider: 'whatsapp',
      type: 'message_received',
      sourceId: message.id,
      summary: `WhatsApp message${message.from ? ` from ${message.from}` : ''}${message.text ? ` — ${message.text.slice(0, 220)}` : ''}`,
      metadata: { from: message.from || '', messageType: message.type || '', text: message.text || '' },
    });
  }
  if (messages.length) {
    await refreshNotifications(profileId).catch(() => undefined);
    await runInterruptManager({ profileId, persist: true }).catch(() => undefined);
  }
  return NextResponse.json({ ok: true, received: messages.length }, { headers: { 'Cache-Control': 'no-store' } });
}
