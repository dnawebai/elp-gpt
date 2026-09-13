import { NextResponse } from 'next/server';
import { createDelegation, createGoal, getPortfolioSnapshot, updateDelegation, updateGoal } from '@/lib/portfolio-control';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 300;

function readProfile(request: Request) {
  const value = (request.headers.get('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${PROFILE_COOKIE}=`))?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(value);
}

export async function GET(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  try {
    return NextResponse.json(await getPortfolioSnapshot(profile.profileId), { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Portfolio control snapshot failed.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof body?.action === 'string' ? body.action : '';
  try {
    if (action === 'create-goal') {
      const goal = await createGoal(profile.profileId, {
        title: typeof body?.title === 'string' ? body.title : '',
        description: typeof body?.description === 'string' ? body.description : undefined,
        level: ['vision', 'objective', 'key_result'].includes(String(body?.level)) ? body?.level as 'vision' | 'objective' | 'key_result' : 'objective',
        parentId: typeof body?.parentId === 'string' ? body.parentId : undefined,
        owner: ['user', 'ai', 'team', 'external'].includes(String(body?.owner)) ? body?.owner as 'user' | 'ai' | 'team' | 'external' : 'user',
        priority: ['critical', 'high', 'normal', 'low'].includes(String(body?.priority)) ? body?.priority as 'critical' | 'high' | 'normal' | 'low' : 'normal',
        dueDate: typeof body?.dueDate === 'string' ? body.dueDate : undefined,
        metric: typeof body?.metric === 'string' ? body.metric : undefined,
        target: typeof body?.target === 'number' ? body.target : undefined,
        current: typeof body?.current === 'number' ? body.current : undefined,
        unit: typeof body?.unit === 'string' ? body.unit : undefined,
        taskIds: Array.isArray(body?.taskIds) ? body.taskIds.filter((v): v is string => typeof v === 'string') : [],
        ledgerIds: Array.isArray(body?.ledgerIds) ? body.ledgerIds.filter((v): v is string => typeof v === 'string') : [],
      });
      return NextResponse.json({ ok: true, goal });
    }
    if (action === 'update-goal') {
      const goalId = typeof body?.goalId === 'string' ? body.goalId.trim() : '';
      if (!goalId) return NextResponse.json({ error: 'goalId is required.' }, { status: 400 });
      const patch: Record<string, unknown> = { ...body };
      delete patch.action; delete patch.goalId;
      const goal = await updateGoal(profile.profileId, goalId, patch as Parameters<typeof updateGoal>[2]);
      return NextResponse.json({ ok: true, goal });
    }
    if (action === 'create-delegation') {
      const delegation = await createDelegation(profile.profileId, {
        taskId: typeof body?.taskId === 'string' ? body.taskId : '',
        goalId: typeof body?.goalId === 'string' ? body.goalId : undefined,
        delegatee: typeof body?.delegatee === 'string' ? body.delegatee : '',
        channel: typeof body?.channel === 'string' ? body.channel : undefined,
        expectedOutcome: typeof body?.expectedOutcome === 'string' ? body.expectedOutcome : '',
        dueDate: typeof body?.dueDate === 'string' ? body.dueDate : undefined,
        checkInEveryHours: typeof body?.checkInEveryHours === 'number' ? body.checkInEveryHours : undefined,
      });
      return NextResponse.json({ ok: true, delegation });
    }
    if (action === 'update-delegation') {
      const delegationId = typeof body?.delegationId === 'string' ? body.delegationId.trim() : '';
      if (!delegationId) return NextResponse.json({ error: 'delegationId is required.' }, { status: 400 });
      const patch: Record<string, unknown> = { ...body };
      delete patch.action; delete patch.delegationId;
      const delegation = await updateDelegation(profile.profileId, delegationId, patch as Parameters<typeof updateDelegation>[2]);
      return NextResponse.json({ ok: true, delegation });
    }
    if (action === 'refresh') return NextResponse.json({ ok: true, snapshot: await getPortfolioSnapshot(profile.profileId) });
    return NextResponse.json({ error: 'Unsupported portfolio control action.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Portfolio control action failed.' }, { status: 500 });
  }
}
