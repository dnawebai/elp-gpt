import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const apiKey = process.env.RETELL_API_KEY?.trim();
  const agentId = process.env.RETELL_AGENT_ID?.trim();

  if (!apiKey || !agentId) {
    return NextResponse.json(
      { error: 'Retell AI is not configured on this deployment.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let sessionId = 'web';
  try {
    const body = await request.json().catch(() => null) as { sessionId?: unknown } | null;
    if (typeof body?.sessionId === 'string' && body.sessionId.trim()) {
      sessionId = body.sessionId.trim().slice(0, 128);
    }
  } catch {
    // Keep the default anonymous session identifier.
  }

  try {
    const upstream = await fetch('https://api.retellai.com/v2/create-web-call', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        agent_id: agentId,
        metadata: {
          source: 'elp-gpt-web',
          session_id: sessionId,
        },
        retell_llm_dynamic_variables: {
          channel: 'elp-gpt-web',
        },
      }),
      cache: 'no-store',
    });

    const data = await upstream.json().catch(() => null) as {
      access_token?: string;
      call_id?: string;
      error?: unknown;
      message?: unknown;
    } | null;

    if (!upstream.ok || !data?.access_token) {
      const detail = typeof data?.message === 'string'
        ? data.message
        : typeof data?.error === 'string'
          ? data.error
          : 'Retell AI could not create a web call.';

      return NextResponse.json(
        { error: detail },
        { status: upstream.status || 502, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json(
      {
        accessToken: data.access_token,
        callId: data.call_id || null,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { error: 'Retell AI is temporarily unavailable.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
