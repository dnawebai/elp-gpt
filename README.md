# ELP GPT

ELP is a cross-device, voice-first intelligence system. The home surface stays intentionally minimal: the circular ELP HUD is the primary interface, while profile, memory, signals, skills, briefings, permissions, and diagnostics remain hidden until the profile is opened.

## Implemented foundation

- Responsive desktop, tablet and mobile PWA
- Full-screen animated ELP voice HUD
- Deepgram realtime microphone, turn detection, barge-in and speech output
- Custom OpenAI-compatible ELP voice gateway
- Hermes-first / Together AI fallback reasoning router
- Honcho long-term profile and session memory
- Server-signed device identity cookie
- Voice transcript persistence into Honcho
- Voice-controlled profile navigation and system diagnostics
- Permission-first behavior for consequential actions
- CI typecheck + production build validation

## Runtime flow

```text
Voice
Browser microphone
  -> Deepgram Flux / Voice Agent
  -> /api/voice/think (signed ELP gateway)
  -> Hermes or Together AI
  -> Deepgram speech
  -> browser audio

Memory
ConversationText
  -> /api/transcript
  -> Honcho session + peer model
  -> injected into future reasoning
```

Deepgram receives only a short-lived Deepgram bearer token and a scoped ELP gateway token. Permanent Deepgram, Together, Hermes and Honcho credentials remain server-side.

## Voice commands already wired

ELP can open/close the hidden profile interface, navigate to Memory, Signals, Skills, Briefings, Permissions or System, and query live system configuration through voice function calls.

Examples: “ELP, open memory”, “show me system status”, “open skills”, “close profile”.

## Environment

```bash
ELP_SESSION_SECRET=

HERMES_BASE_URL=
HERMES_API_KEY=
HERMES_MODEL=

TOGETHER_API_KEY=
TOGETHER_MODEL=meta-llama/Llama-3.3-70B-Instruct-Turbo

HONCHO_API_KEY=
HONCHO_WORKSPACE_ID=elp-gpt

DEEPGRAM_API_KEY=
ELP_LISTEN_MODEL=flux-general-en
ELP_VOICE_MODEL=aura-2-jupiter-en
```

Use a dedicated random `ELP_SESSION_SECRET` in production. If it is absent, ELP can derive a signing secret from an already-configured server credential for development/transition purposes; the System panel reports which security mode is active.

## Local development

```bash
cp .env.example .env.local
npm install
npm run dev
```

## Next production layer

The next milestone is external action execution: authenticated account linking, scoped tool connectors, durable approval ledger, proactive jobs/briefings, notifications, observability, and end-to-end tests. ELP must never report an external action as completed without a verified tool result.
