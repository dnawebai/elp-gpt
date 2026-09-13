import { NextResponse } from 'next/server';
import {
  createExecutiveLedgerItem,
  getExecutiveLedger,
  updateExecutiveLedgerItem,
  type ExecutiveArtifactKind,
  type ExecutiveArtifactStatus,
  type ExecutivePriority,
} from '@/lib/executive-memory';
import { PROFILE_COOKIE, sanitizeId, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';

function readProfile(request: Request) {
  const value = (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(value);
}

export async function GET(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const ledger = await getExecutiveLedger(profile.profileId);
  return NextResponse.json(ledger, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    kind?: unknown;
    content?: unknown;
    owner?: unknown;
    dueDate?: unknown;
    priority?: unknown;
  } | null;

  const kind = body?.kind;
  if (kind !== 'decision' && kind !== 'commitment' && kind !== 'assumption' && kind !== 'objective') {
    return NextResponse.json({ error: 'Invalid ledger item kind.' }, { status: 400 });
  }
  const content = typeof body?.content === 'string' ? body.content.trim() : '';
  if (!content) return NextResponse.json({ error: 'Content is required.' }, { status: 400 });

  try {
    const id = await createExecutiveLedgerItem(profile.profileId, {
      kind: kind as ExecutiveArtifactKind,
      content,
      owner: typeof body?.owner === 'string' ? body.owner : undefined,
      dueDate: typeof body?.dueDate === 'string' ? body.dueDate : undefined,
      priority: body?.priority === 'high' || body?.priority === 'medium' || body?.priority === 'normal'
        ? body.priority as ExecutivePriority
        : undefined,
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Ledger item creation failed.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    messageId?: unknown;
    status?: unknown;
    owner?: unknown;
    dueDate?: unknown;
    priority?: unknown;
    note?: unknown;
  } | null;

  const messageId = sanitizeId(body?.messageId, '');
  if (!messageId) return NextResponse.json({ error: 'A valid messageId is required.' }, { status: 400 });
  const status = body?.status;
  if (status !== undefined && !['active', 'completed', 'blocked', 'superseded', 'dismissed'].includes(String(status))) {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
  }
  const priority = body?.priority;
  if (priority !== undefined && !['high', 'medium', 'normal'].includes(String(priority))) {
    return NextResponse.json({ error: 'Invalid priority.' }, { status: 400 });
  }

  try {
    await updateExecutiveLedgerItem(profile.profileId, messageId, {
      status: status as ExecutiveArtifactStatus | undefined,
      owner: body?.owner === null ? null : typeof body?.owner === 'string' ? body.owner : undefined,
      dueDate: body?.dueDate === null ? null : typeof body?.dueDate === 'string' ? body.dueDate : undefined,
      priority: priority as ExecutivePriority | undefined,
      note: body?.note === null ? null : typeof body?.note === 'string' ? body.note : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Ledger item update failed.' }, { status: 500 });
  }
}
