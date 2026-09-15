import { NextResponse } from 'next/server';
import {
  createCompanyGoal,
  executeCompanyJob,
  getCompanyJob,
  listCompanyEvents,
  listCompanyJobs,
  listCompanyPositions,
  type CompanyGoal,
} from '@/lib/agent-company';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function ownerProfile(request: Request) {
  const value = (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(value);
}

function unauthorized() {
  return NextResponse.json({ error: 'Authenticated owner session is required.' }, { status: 401 });
}

export async function GET(request: Request) {
  if (!ownerProfile(request)) return unauthorized();
  const url = new URL(request.url);
  const resource = url.searchParams.get('resource') || 'jobs';
  try {
    if (resource === 'positions') return NextResponse.json(await listCompanyPositions());
    if (resource === 'events') return NextResponse.json(await listCompanyEvents());
    if (resource === 'job') {
      const jobId = url.searchParams.get('jobId');
      if (!jobId) return NextResponse.json({ error: 'jobId is required.' }, { status: 400 });
      return NextResponse.json(await getCompanyJob(jobId));
    }
    return NextResponse.json(await listCompanyJobs());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Company OS request failed.' }, { status: 502 });
  }
}

export async function POST(request: Request) {
  if (!ownerProfile(request)) return unauthorized();
  const body = (await request.json().catch(() => null)) as
    | ({ action?: 'goal'; execute?: boolean } & Partial<CompanyGoal>)
    | { action?: 'execute'; jobId?: string }
    | null;
  if (!body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });

  try {
    if (body.action === 'execute') {
      if (!body.jobId) return NextResponse.json({ error: 'jobId is required.' }, { status: 400 });
      return NextResponse.json(await executeCompanyJob(body.jobId));
    }

    if (!('company' in body) || !body.company || !('objective' in body) || typeof body.objective !== 'string' || body.objective.trim().length < 3) {
      return NextResponse.json({ error: 'company and objective are required.' }, { status: 400 });
    }

    const job = (await createCompanyGoal({
      company: body.company,
      objective: body.objective.trim(),
      requested_position: body.requested_position,
      acceptance_criteria: body.acceptance_criteria,
      context: body.context,
      max_attempts: body.max_attempts,
    })) as { id?: string };

    if (body.execute && job.id) {
      return NextResponse.json(await executeCompanyJob(job.id));
    }
    return NextResponse.json(job);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Company OS request failed.' }, { status: 502 });
  }
}
