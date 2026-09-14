import { NextResponse } from 'next/server';
import { createTask, getTaskBoard, updateTask, type TaskApproval, type TaskOwner, type TaskPriority, type TaskQueue, type TaskStatus } from '@/lib/task-router';
import { requireZeroTrustAuthority } from '@/lib/zero-trust-authority';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const context = await requireZeroTrustAuthority(request, 'read_context');
  if (!context) return NextResponse.json({ error: 'Authorized principal session is required.' }, { status: 401 });
  return NextResponse.json(await getTaskBoard(context.profileId), { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  try {
    const context = await requireZeroTrustAuthority(request, 'manage_tasks');
    if (!context) return NextResponse.json({ error: 'Task-management permission is required.' }, { status: 403 });
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const objective = typeof body?.objective === 'string' ? body.objective.trim() : '';
    if (!objective) return NextResponse.json({ error: 'objective is required.' }, { status: 400 });
    if (objective.length > 4000) return NextResponse.json({ error: 'objective is too long.' }, { status: 413 });
    const id = await createTask(context.profileId, {
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
    return NextResponse.json({ ok: true, id, principalId: context.principal.id }, { status: 201 });
  } catch (error) {
    console.error('Task creation failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Task creation failed.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await requireZeroTrustAuthority(request, 'manage_tasks');
    if (!context) return NextResponse.json({ error: 'Task-management permission is required.' }, { status: 403 });
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });
    await updateTask(context.profileId, id, {
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
    return NextResponse.json({ ok: true, principalId: context.principal.id });
  } catch (error) {
    console.error('Task update failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Task update failed.' }, { status: 500 });
  }
}
