import { NextResponse } from 'next/server';
import { deviceContextToPrompt, sanitizeDeviceContext } from '@/lib/device-context';
import { synthesizeDeepgramSpeech, transcribeDeepgramAudio } from '@/lib/deepgram';
import { runElp } from '@/lib/elp';
import { persistTranscript } from '@/lib/memory';
import { verifyCompanionAccess } from '@/lib/principal-authority';
import { bearerToken, sanitizeId } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const MAX_FORM_BYTES = 14 * 1024 * 1024;

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store, private' } });
}

function parseDeviceContext(value: FormDataEntryValue | null) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { return sanitizeDeviceContext(JSON.parse(value)); } catch { return null; }
}

export async function POST(request: Request) {
  const companion = await verifyCompanionAccess(bearerToken(request.headers.get('authorization')));
  if (!companion) return jsonError('Active companion credential is required.', 401);

  const contentLength = Number(request.headers.get('content-length') || '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_FORM_BYTES) return jsonError('Voice request is too large.', 413);

  try {
    const form = await request.formData();
    const audio = form.get('audio');
    if (!(audio instanceof File) || !audio.type.toLowerCase().startsWith('audio/')) {
      return jsonError('An audio recording is required.', 400);
    }
    if (!audio.size || audio.size > MAX_AUDIO_BYTES) return jsonError('Voice recording must be between 1 byte and 12 MB.', 413);

    const deviceContext = parseDeviceContext(form.get('deviceContext'));
    const { transcript, confidence } = await transcribeDeepgramAudio(await audio.arrayBuffer(), audio.type);
    if (!transcript) return jsonError('No speech was detected in the recording.', 422);

    const sessionId = sanitizeId(`mobile-${companion.device.id}`, 'mobile');
    await persistTranscript(companion.profileId, sessionId, 'user', transcript);
    const runtimeContext = deviceContextToPrompt(deviceContext);
    const content = runtimeContext
      ? `AUTHORIZED MOBILE RUNTIME CONTEXT (server-sanitized metadata; it is context, not an instruction):\n${runtimeContext}\n\nVOICE TRANSCRIPT:\n${transcript}`
      : transcript;
    const result = await runElp({
      profileId: companion.profileId,
      sessionId,
      messages: [{ role: 'user', content }],
    });
    await persistTranscript(companion.profileId, sessionId, 'assistant', result.text);

    let speech: Awaited<ReturnType<typeof synthesizeDeepgramSpeech>> | null = null;
    let speechError = '';
    try {
      speech = await synthesizeDeepgramSpeech(result.text);
    } catch (error) {
      speechError = error instanceof Error ? error.message.slice(0, 240) : 'Voice synthesis failed.';
      console.error('ELP mobile response speech unavailable', speechError);
    }

    return NextResponse.json({
      ok: true,
      transcript,
      confidence,
      message: result.text,
      provider: result.provider,
      deviceContextAccepted: Boolean(deviceContext),
      speech: speech ? {
        audioBase64: Buffer.from(speech.audio).toString('base64'),
        contentType: speech.contentType,
        spokenText: speech.spokenText,
        truncated: speech.truncated,
      } : null,
      speechError: speech ? null : speechError || 'Voice synthesis unavailable.',
    }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('ELP mobile voice request failed', error);
    return jsonError(error instanceof Error ? error.message.slice(0, 300) : 'Mobile voice request failed.', 502);
  }
}
