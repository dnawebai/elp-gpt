import { NextResponse } from 'next/server';
import { createTask, getTaskBoard, updateTask, type TaskApproval, type TaskOwner, type TaskPriority, type TaskQueue, type TaskStatus } from '@/lib/task-router';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 60;

function readProfile(request: Request) {
  const value = (request.headers.get('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${PROFILE_COOKIE}=`))?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(value);
}

export async function GET(request: Request) {
  const profile = readProfile(request); if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  return NextResponse.json(await getTaskBoard(profile.profileId), { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  try {
    const profile = readProfile(request); if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const objective = typeof body?.objective === 'string' ? body.objective.trim() : '';
    if (!objective) return NextResponse.json({ error: 'objective is required.' }, { status: 400 });
    if (objective.length > 4000) return NextResponse.json({ error: 'objective is too long.' }, { status: 413 });
    const id = await createTask(profile.profileId, {
      objective,
      queue: body?.queue as TaskQueue | undefined,
      owner: body?.owner as TaskOwner | undefined,
      priority: body?.priority as TaskPriority | undefined,
      approval: body?.approval as TaskApproval | undefined,
      source: typeof body?.source === 'string' ? body.source : 'command-center',
      sessionId: typeof body?.sessionId === 'string' ? body.sessionId : undefined,
      estimatedHours: typeof body?.estimatedHours === 'number' ? body.estimatedHours : undefined,
      remainingHours: typeof body?.remainingHours === 'number' ? body.remainingHours : undefined,
      progressPercent: typeof body?.progressPercent === 'number' ? body.progressPercent : undefined,
      dueAt: typeof body?.dueAt === 'string' ? body.dueAt : undefined,
      progressEvidence: typeof body?.progressEvidence === 'string' ? body.progressEvidence : undefined,
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (error) {
    console.error('Task creation failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Task creation failed.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const profile = readProfile(request); if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });
    await updateTask(profile.profileId, id, {
      queue: body?.queue as TaskQueue | undefined,
      owner: body?.owner as TaskOwner | undefined,
      priority: body?.priority as TaskPriority | undefined,
      approval: body?.approval as TaskApproval | undefined,
      status: body?.status as TaskStatus | undefined,
      summary: body?.summary as string | null | undefined,
      toolSlug: body?.toolSlug as string | null | undefined,
      risk: body?.risk as string | null | undefined,
      evidence: body?.evidence as string | null | undefined,
      note: body?.note as string | null | undefined,
      estimatedHours: body?.estimatedHours as number | null | undefined,
      remainingHours: body?.remainingHours as number | null | undefined,
      progressPercent: body?.progressPercent as number | null | undefined,
      dueAt: body?.dueAt as string | null | undefined,
      startedAt: body?.startedAt as string | null | undefined,
      completedAt: body?.completedAt as string | null | undefined,
      progressEvidence: body?.progressEvidence as string | null | undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Task update failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Task update failed.' }, { status: 500 });
  }
}
