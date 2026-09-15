import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getOwnerProfileId } from '@/lib/owner';
import { recordTelephonyEvent, type TelephonyCallAnalysis } from '@/lib/telephony-events';

export const runtime = 'nodejs';
export const maxDuration = 60;

function verify(raw: string, signature: string, key: string) {
  const match = /^v=(\d+),d=([a-f0-9]+)$/i.exec(signature.trim());
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60_000) return false;
  const expected = createHmac('sha256', key).update(raw + match[1]).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(match[2], 'hex');
  } catch {
    return false;
  }
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function iso(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : undefined;
}

function stringValue(value: unknown, max = 1800) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

function boolValue(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

function parseAnalysis(call: Record<string, unknown>): TelephonyCallAnalysis | undefined {
  const raw = call.call_analysis;
  if (!raw || typeof raw !== 'object') return undefined;
  const analysis = raw as Record<string, unknown>;
  const customRaw = analysis.custom_analysis_data;
  const custom = customRaw && typeof customRaw === 'object' ? customRaw as Record<string, unknown> : {};

  const result: TelephonyCallAnalysis = {
    callSummary: stringValue(analysis.call_summary, 4000),
    callSuccessful: boolValue(analysis.call_successful),
    userSentiment: stringValue(analysis.user_sentiment, 120),
    appointmentBooked: boolValue(custom.appointment_booked),
    appointmentDatetime: stringValue(custom.appointment_datetime, 300),
    appointmentWith: stringValue(custom.appointment_with, 300),
    appointmentLocationOrMethod: stringValue(custom.appointment_location_or_method, 500),
    appointmentReference: stringValue(custom.appointment_reference, 300),
    followUpRequired: boolValue(custom.follow_up_required),
    followUpNotes: stringValue(custom.follow_up_notes, 2000),
    callOutcome: stringValue(custom.call_outcome, 120),
  };

  return Object.values(result).some((value) => value !== undefined) ? result : undefined;
}

export async function POST(request: Request) {
  const key = process.env.RETELL_API_KEY?.trim();
  if (!key) {
    return NextResponse.json({ error: 'Retell webhook verification is not configured.' }, { status: 503 });
  }

  const raw = await request.text();
  if (!verify(raw, request.headers.get('x-retell-signature') || '', key)) {
    return NextResponse.json({ error: 'Invalid Retell signature.' }, { status: 401 });
  }

  const profileId = getOwnerProfileId();
  if (!profileId) return NextResponse.json({ error: 'ELP owner profile is not configured.' }, { status: 503 });

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid webhook payload.' }, { status: 400 });
  }

  const call = payload.call && typeof payload.call === 'object' ? payload.call as Record<string, unknown> : {};
  const callId = typeof call.call_id === 'string' ? call.call_id : '';
  const event = typeof payload.event === 'string' ? payload.event.slice(0, 100) : 'call_event';
  if (!callId) return NextResponse.json({ error: 'call.call_id is required.' }, { status: 400 });

  await recordTelephonyEvent(profileId, {
    callId,
    event,
    direction: typeof call.direction === 'string' ? call.direction : undefined,
    fromNumber: typeof call.from_number === 'string' ? call.from_number : undefined,
    toNumber: typeof call.to_number === 'string' ? call.to_number : undefined,
    agentId: typeof call.agent_id === 'string' ? call.agent_id : undefined,
    status: typeof call.call_status === 'string' ? call.call_status : undefined,
    startedAt: iso(call.start_timestamp),
    endedAt: iso(call.end_timestamp),
    disconnectionReason: typeof call.disconnection_reason === 'string' ? call.disconnection_reason : undefined,
    transcriptPreview: typeof call.transcript === 'string' ? call.transcript.slice(0, 3000) : undefined,
    analysis: parseAnalysis(call),
    updatedAt: new Date().toISOString(),
  });

  return new NextResponse(null, { status: 204 });
}
