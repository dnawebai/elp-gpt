import { NextResponse } from 'next/server';
import {
  createAutonomousJob,
  listAutonomousJobRuns,
  listAutonomousJobs,
  recordAutonomousJobActionExecuted,
  runAutonomousJob,
  updateAutonomousJob,
  type JobMode,
} from '@/lib/autonomous-jobs';
import type { JobSchedule } from '@/lib/job-schedule';
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
  const url = new URL(request.url);
  const jobId = url.searchParams.get('jobId') || undefined;
  const [jobs, runs] = await Promise.all([
    listAutonomousJobs(profile.profileId),
    listAutonomousJobRuns(profile.profileId, jobId, jobId ? 50 : 20),
  ]);
  return NextResponse.json({ configured: Boolean(process.env.HONCHO_API_KEY), jobs, runs }, { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === 'string' ? body.action : 'create';

  try {
    if (action === 'create') {
      const title = typeof body?.title === 'string' ? body.title : '';
      const instruction = typeof body?.instruction === 'string' ? body.instruction : '';
      const mode: JobMode = body?.mode === 'condition' ? 'condition' : 'scheduled';
      const condition = typeof body?.condition === 'string' ? body.condition : undefined;
      const schedule = body?.schedule as JobSchedule | undefined;
      if (!schedule) return NextResponse.json({ error: 'schedule is required.' }, { status: 400 });
      const result = await createAutonomousJob(profile.profileId, { title, instruction, mode, condition, schedule });
      return NextResponse.json({ ok: true, ...result }, { status: 201, headers: { 'Cache-Control': 'no-store, private' } });
    }

    const jobId = sanitizeId(body?.jobId, '');
    if (!jobId) return NextResponse.json({ error: 'jobId is required.' }, { status: 400 });

    if (action === 'run') {
      const jobs = await listAutonomousJobs(profile.profileId);
      const job = jobs.find((item) => item.id === jobId);
      if (!job) return NextResponse.json({ error: 'Autonomous job not found.' }, { status: 404 });
      const result = await runAutonomousJob(profile.profileId, job, new Date().toISOString());
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store, private' } });
    }

    if (action === 'pending') {
      const jobs = await listAutonomousJobs(profile.profileId);
      const job = jobs.find((item) => item.id === jobId);
      if (!job?.pendingAction) return NextResponse.json({ error: 'No approval-required action is available for this job.' }, { status: 404 });
      return NextResponse.json({
        ok: true,
        status: 'approval_required',
        pendingAction: { ...job.pendingAction, postExecution: { kind: 'autonomous-job', jobId } },
      }, { headers: { 'Cache-Control': 'no-store, private' } });
    }

    if (action === 'executed') {
      const evidence = typeof body?.evidence === 'string' ? body.evidence.slice(0, 3000) : undefined;
      const result = await recordAutonomousJobActionExecuted(profile.profileId, jobId, evidence);
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store, private' } });
    }

    return NextResponse.json({ error: 'Unsupported job action.' }, { status: 400 });
  } catch (error) {
    console.error('ELP autonomous jobs API failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Autonomous job operation failed.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const jobId = sanitizeId(body?.jobId, '');
  if (!jobId) return NextResponse.json({ error: 'jobId is required.' }, { status: 400 });
  try {
    const status = ['active', 'paused', 'cancelled'].includes(String(body?.status)) ? body?.status as 'active' | 'paused' | 'cancelled' : undefined;
    const schedule = body?.schedule && typeof body.schedule === 'object' ? body.schedule as JobSchedule : undefined;
    const result = await updateAutonomousJob(profile.profileId, jobId, {
      status,
      title: typeof body?.title === 'string' ? body.title : undefined,
      instruction: typeof body?.instruction === 'string' ? body.instruction : undefined,
      condition: body?.condition === null ? null : typeof body?.condition === 'string' ? body.condition : undefined,
      schedule,
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not update autonomous job.' }, { status: 400 });
  }
}
