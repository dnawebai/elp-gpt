# Deepgram production integration

This deployment uses Deepgram Voice Agent as ELP's realtime speech runtime.

## Production path

1. Browser requests a short-lived Deepgram access token from `/api/deepgram-token`.
2. `@deepgram/agents` opens the Voice Agent WebSocket.
3. Flux v2 handles conversational STT and end-of-turn detection.
4. ELP routes reasoning through the server-side `/api/voice/think` gateway when Hermes or Together is available; otherwise Deepgram's managed LLM is used as a fallback.
5. Flux v2 TTS streams ELP's voice back to the browser.
6. Conversation text is persisted through `/api/transcript` when Honcho is configured.
7. Client-side function calls expose profile controls and the permission-gated Composio action layer.

## Required production environment

- `DEEPGRAM_API_KEY` — server only.
- `ELP_LISTEN_MODEL=flux-general-multi`
- `ELP_LISTEN_LANGUAGE_HINTS=en,pt`
- `ELP_LISTEN_KEYTERMS=ELP,ELP GPT,Deepgram,Hermes,Honcho,Together AI`
- `ELP_EOT_THRESHOLD=0.78`
- `ELP_EAGER_EOT_THRESHOLD=0.50`
- `ELP_EOT_TIMEOUT_MS=2600`
- `ELP_VOICE_MODEL=flux-cliff-en`
- `ELP_VOICE_SPEED=1.0`

Hermes/Together, Honcho, and Composio are complementary integrations; Deepgram voice remains available if the external reasoning provider is unavailable and can fall back to a Deepgram-managed LLM.

## Verification

`GET /api/status?probe=1` performs a server-side Deepgram credential/token-grant probe. A healthy deployment reports `voice: true`, `deepgram.authenticated: true`, and `listenVersion`/`voiceVersion` as `v2` when Flux is selected.

Browser microphone access must be initiated by a user gesture. A green server probe confirms credentials; an actual browser voice session additionally confirms microphone permission, WebSocket connectivity, and the Settings payload.
