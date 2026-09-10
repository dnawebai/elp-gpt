import { buildLukeSystemPrompt, getReasoningProvider } from '@/lib/luke';
import { bearerToken, verifyVoiceGatewayToken } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 60;

type OpenAIRequest = {
  messages?: unknown[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  tools?: unknown;
  tool_choice?: unknown;
  functions?: unknown;
  function_call?: unknown;
};

export async function POST(request: Request) {
  const claims = verifyVoiceGatewayToken(bearerToken(request.headers.get('authorization')));
  if (!claims) {
    return Response.json({ error: { message: 'Invalid or expired LUKE voice session.' } }, { status: 401 });
  }

  const contentLength = Number(request.headers.get('content-length') || '0');
  if (contentLength > 512_000) {
    return Response.json({ error: { message: 'Voice reasoning request too large.' } }, { status: 413 });
  }

  const provider = getReasoningProvider();
  if (!provider) {
    return Response.json({ error: { message: 'LUKE reasoning provider is not configured.' } }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as OpenAIRequest | null;
  if (!body || !Array.isArray(body.messages)) {
    return Response.json({ error: { message: 'messages is required.' } }, { status: 400 });
  }

  const history = body.messages
    .filter((message): message is Record<string, unknown> => Boolean(message && typeof message === 'object'))
    .filter((message) => message.role !== 'system')
    .slice(-48);

  const system = await buildLukeSystemPrompt(claims.profileId, claims.sessionId);
  const maxTokens = Math.max(64, Math.min(Number(body.max_tokens) || 900, 1600));
  const stream = body.stream !== false;

  const upstreamBody: Record<string, unknown> = {
    model: provider.model,
    messages: [{ role: 'system', content: system }, ...history],
    stream,
    temperature: typeof body.temperature === 'number' ? Math.min(Math.max(body.temperature, 0), 1) : 0.3,
    max_tokens: maxTokens,
  };

  if (Array.isArray(body.tools)) upstreamBody.tools = body.tools;
  if (body.tool_choice !== undefined) upstreamBody.tool_choice = body.tool_choice;
  if (Array.isArray(body.functions)) upstreamBody.functions = body.functions;
  if (body.function_call !== undefined) upstreamBody.function_call = body.function_call;

  const upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
    },
    body: JSON.stringify(upstreamBody),
    signal: AbortSignal.timeout(55_000),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    console.error('LUKE voice gateway upstream error', provider.name, upstream.status, detail.slice(0, 300));
    return Response.json(
      { error: { message: `${provider.name} reasoning failed.`, type: 'upstream_error' } },
      { status: 502 },
    );
  }

  if (!upstream.body) return new Response(null, { status: 502 });

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') || (stream ? 'text/event-stream' : 'application/json'),
      'Cache-Control': 'no-store',
      'X-Luke-Provider': provider.name,
    },
  });
}
