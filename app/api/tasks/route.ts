import { NextResponse } from 'next/server';
import { createTask, getTaskBoard, updateTask, type TaskApproval, type TaskOwner, type TaskPriority, type TaskQueue, type TaskStatus } from '@/lib/task-router';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 60;

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
  const board = await getTaskBoard(profile.profileId);
  return NextResponse.json(board, { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  try {
    const profile = readProfile(request);
    if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
    const body = (await request.json().catch(() => null)) as {
      objective?: unknown;
      queue?: TaskQueue;
      owner?: TaskOwner;
      priority?: TaskPriority;
      approval?: TaskApproval;
      source?: unknown;
      sessionId?: unknown;
    } | null;
    const objective = typeof body?.objective === 'string' ? body.objective.trim() : '';
    if (!objective) return NextResponse.json({ error: 'objective is required.' }, { status: 400 });
    if (objective.length > 4000) return NextResponse.json({ error: 'objective is too long.' }, { status: 413 });
    const id = await createTask(profile.profileId, {
      objective,
      queue: body?.queue,
      owner: body?.owner,
      priority: body?.priority,
      approval: body?.approval,
      source: typeof body?.source === 'string' ? body.source : 'command-center',
      sessionId: typeof body?.sessionId === 'string' ? body.sessionId : undefined,
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (error) {
    console.error('Task creation failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Task creation failed.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const profile = readProfile(request);
    if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
    const body = (await request.json().catch(() => null)) as {
      id?: unknown;
      queue?: TaskQueue;
      owner?: TaskOwner;
      priority?: TaskPriority;
      approval?: TaskApproval;
      status?: TaskStatus;
      summary?: string | null;
      toolSlug?: string | null;
      risk?: string | null;
      evidence?: string | null;
      note?: string | null;
    } | null;
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });
    await updateTask(profile.profileId, id, {
      queue: body?.queue,
      owner: body?.owner,
      priority: body?.priority,
      approval: body?.approval,
      status: body?.status,
      summary: body?.summary,
      toolSlug: body?.toolSlug,
      risk: body?.risk,
      evidence: body?.evidence,
      note: body?.note,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Task update failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Task update failed.' }, { status: 500 });
  }
}
