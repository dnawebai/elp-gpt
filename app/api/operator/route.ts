import { NextResponse } from 'next/server';
import { runOperatorMission, type OperatorMissionState } from '@/lib/operator';
import { PROFILE_COOKIE, sanitizeId, verifyProfileToken } from '@/lib/security';
import { createTask, getTask, operatorTaskTransition, updateTask } from '@/lib/task-router';

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

export async function POST(request: Request) {
  try {
    const profile = readProfile(request);
    if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });

    const body = (await request.json().catch(() => null)) as {
      objective?: unknown;
      sessionId?: unknown;
      taskId?: unknown;
      state?: OperatorMissionState | null;
      resumeObservation?: { toolSlug?: unknown; summary?: unknown; result?: unknown } | null;
    } | null;

    const objective = typeof body?.objective === 'string' ? body.objective.trim() : '';
    if (!objective) return NextResponse.json({ error: 'objective is required.' }, { status: 400 });
    if (objective.length > 4000) return NextResponse.json({ error: 'objective is too long.' }, { status: 413 });

    const sessionId = sanitizeId(body?.sessionId, 'web');
    let taskId = typeof body?.taskId === 'string' ? body.taskId.trim() : '';
    if (taskId) {
      const existing = await getTask(profile.profileId, taskId);
      if (!existing || existing.objective !== objective) taskId = '';
    }

    if (!taskId) {
      taskId = await createTask(profile.profileId, {
        objective,
        queue: 'working',
        owner: 'ai',
        approval: 'none',
        source: 'operator',
        sessionId,
        summary: 'Mission accepted by JARBIS Operator.',
      }) || '';
    } else {
      await updateTask(profile.profileId, taskId, {
        queue: 'working',
        owner: 'ai',
        approval: 'none',
        status: 'active',
        summary: 'JARBIS Operator is continuing this mission.',
      });
    }

    const result = await runOperatorMission({
      objective,
      profileId: profile.profileId,
      sessionId,
      state: body?.state || null,
      resumeObservation: body?.resumeObservation || null,
    });

    if (taskId) {
      const transition = operatorTaskTransition(result);
      const evidence = result.status === 'completed'
        ? result.state.observations.slice(-3).map((entry) => `${entry.toolSlug}: ${entry.summary}`).join('\n')
        : undefined;
      await updateTask(profile.profileId, taskId, {
        ...transition,
        summary: result.summary,
        evidence: evidence || null,
      });
    }

    return NextResponse.json({ ...result, taskId }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('JARBIS Operator request failed', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Operator mission failed.',
    }, { status: 502 });
  }
}
