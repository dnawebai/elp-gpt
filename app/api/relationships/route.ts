import { NextResponse } from 'next/server';
import {
  getRelationshipSnapshot,
  updateRelationship,
  upsertRelationship,
  type RelationshipMomentum,
  type RelationshipStatus,
  type RelationshipValue,
} from '@/lib/relationship-memory';
import { scanRelationshipIntelligence } from '@/lib/relationship-intelligence';
import { createTask } from '@/lib/task-router';
import { PROFILE_COOKIE, sanitizeId, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 300;

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
  const snapshot = await getRelationshipSnapshot(profile.profileId);
  return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const mode = body?.mode === 'upsert' ? 'upsert' : 'scan';

  try {
    if (mode === 'scan') {
      const sessionId = sanitizeId(body?.sessionId, `relationships-${Date.now()}`);
      const timezone = typeof body?.timezone === 'string' ? body.timezone : undefined;
      const result = await scanRelationshipIntelligence({
        profileId: profile.profileId,
        sessionId,
        timezone,
      });
      return NextResponse.json(result, { status: result.ok ? 200 : result.status === 'needs_input' ? 409 : 503, headers: { 'Cache-Control': 'no-store' } });
    }

    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
    const result = await upsertRelationship(profile.profileId, {
      name,
      organization: typeof body?.organization === 'string' ? body.organization : undefined,
      role: typeof body?.role === 'string' ? body.role : undefined,
      email: typeof body?.email === 'string' ? body.email : undefined,
      strategicValue: body?.strategicValue === 'critical' || body?.strategicValue === 'high' || body?.strategicValue === 'normal' || body?.strategicValue === 'low' ? body.strategicValue as RelationshipValue : undefined,
      momentum: body?.momentum === 'warming' || body?.momentum === 'steady' || body?.momentum === 'cooling' || body?.momentum === 'stalled' || body?.momentum === 'unknown' ? body.momentum as RelationshipMomentum : undefined,
      note: typeof body?.note === 'string' ? body.note : undefined,
    });
    return NextResponse.json({ ok: true, ...result }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Relationship operation failed.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const messageId = sanitizeId(body?.messageId, '');
  if (!messageId) return NextResponse.json({ error: 'A valid messageId is required.' }, { status: 400 });

  try {
    if (body?.action === 'follow-up-task') {
      const title = typeof body?.title === 'string' ? body.title.trim() : '';
      if (!title) return NextResponse.json({ error: 'A follow-up task title is required.' }, { status: 400 });
      const taskId = await createTask(profile.profileId, {
        objective: title,
        queue: 'now',
        owner: 'user',
        priority: body?.priority === 'critical' || body?.priority === 'high' || body?.priority === 'normal' || body?.priority === 'low' ? body.priority : 'normal',
        approval: 'none',
        source: 'relationship-intelligence',
        summary: `Created from relationship dossier ${messageId}.`,
      });
      return NextResponse.json({ ok: true, taskId });
    }

    const status = body?.status;
    const strategicValue = body?.strategicValue;
    const momentum = body?.momentum;
    if (status !== undefined && status !== 'active' && status !== 'watch' && status !== 'inactive') {
      return NextResponse.json({ error: 'Invalid relationship status.' }, { status: 400 });
    }
    if (strategicValue !== undefined && !['critical', 'high', 'normal', 'low'].includes(String(strategicValue))) {
      return NextResponse.json({ error: 'Invalid strategic value.' }, { status: 400 });
    }
    if (momentum !== undefined && !['warming', 'steady', 'cooling', 'stalled', 'unknown'].includes(String(momentum))) {
      return NextResponse.json({ error: 'Invalid relationship momentum.' }, { status: 400 });
    }

    await updateRelationship(profile.profileId, messageId, {
      status: status as RelationshipStatus | undefined,
      strategicValue: strategicValue as RelationshipValue | undefined,
      momentum: momentum as RelationshipMomentum | undefined,
      nextBestAction: body?.nextBestAction === null ? null : typeof body?.nextBestAction === 'string' ? body.nextBestAction : undefined,
      note: body?.note === null ? null : typeof body?.note === 'string' ? body.note : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Relationship update failed.' }, { status: 500 });
  }
}
