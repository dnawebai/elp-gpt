# LUKE / ELP GPT — Practical JARVIS Capability Layer

This document defines the production architecture for evolving LUKE from a voice assistant into a permissioned personal-agent system.

## Operating principle

LUKE is one user-facing assistant backed by modular capabilities. The execution preference is:

1. Authenticated API / connector
2. Structured MCP or provider tool
3. Deterministic browser automation
4. Visual computer-use fallback
5. AI phone call
6. Human escalation

The model must never claim a real-world action completed unless the execution provider returns a successful result.

## Current core

The repository already contains:

- Deepgram realtime voice and ephemeral client tokens
- Hermes-first / Together fallback reasoning
- Honcho long-term user context and transcript persistence
- Composio tool discovery and execution
- Signed LUKE profile and voice gateway identities
- Cryptographically bound action proposals and approvals
- Read / write / high-risk action classification
- PWA install experience

The JARVIS capability layer adds:

- First-party skill registry
- Intent-to-skill discovery
- Device timezone, locale, online state, and optional GPS coordinates
- Toolkit allowlisting for defense in depth
- Voice functions for device context and skill discovery
- Explicit capability requirements so unavailable integrations are reported instead of hallucinated

## First-party skill catalog

The initial catalog is intentionally composable rather than one giant prompt. It includes web research, local concierge, email, calendar, travel, booking, shopping, phone calls, contacts, Drive/files, meeting preparation, executive briefings, monitoring, GitHub/development, browser operation, device context, messaging, smart home, finance, and social media.

The registry lives in `lib/skills.ts`; `/api/skills?q=<intent>` exposes deterministic matching to the authenticated client.

## Device context and location

The browser can provide timezone, locale, online status, and user agent without privileged access. Precise coordinates are requested only when the active task materially requires them and the browser/user grants geolocation permission.

For a command such as "find a plumber near me", the intended workflow is:

1. `get_device_context(include_location=true)`
2. Search a connected maps/local-business tool using the returned coordinates/area
3. Compare viable providers
4. If the user wants contact, discover an email/phone tool
5. Prepare the exact external action
6. Obtain approval when required
7. Execute
8. Verify result before reporting completion

Coordinates are contextual inputs, not long-term memory by default.

## Composio integration

The app currently uses server-side Composio REST endpoints for tool discovery and execution. `COMPOSIO_API_KEY` must be server-only.

Recommended production allowlist:

```text
LUKE_ALLOWED_TOOLKITS=GMAIL,GOOGLECALENDAR,GOOGLEDRIVE,COMPOSIO_SEARCH,YELP,RETELLAI,GITHUB
```

Only enable a toolkit after its OAuth/provider connection is configured and its requested scopes have been reviewed.

### Priority connections

| Capability | Preferred provider/toolkit | What it unlocks |
| --- | --- | --- |
| Email | Gmail | Search/read, drafts, replies, sending, inbox operations |
| Calendar | Google Calendar | Availability, event creation, rescheduling, cancellation |
| Local search | Composio Search + Yelp | Maps/local businesses, web verification, contact discovery |
| Files | Google Drive | Find/read/share cloud documents |
| Outbound calls | Retell AI initially | Place AI calls and retrieve verified call outcomes |
| Code | GitHub | Repository, issue, PR and CI workflows |

Vapi can be added as an alternate telephony provider later. Avoid enabling two phone stacks until one is validated end-to-end.

## Phone-agent architecture

Deepgram remains LUKE's realtime user-facing voice interface. Outbound business calls are a separate capability.

Recommended flow:

```text
User -> LUKE -> local/business research -> exact phone target
     -> approval -> Retell/Vapi outbound call
     -> call status/transcript/result -> LUKE verification -> user
```

A production phone integration needs:

- Retell AI or Vapi account
- An outbound-capable phone number
- Caller-ID and jurisdictional compliance configuration
- A dedicated phone-agent prompt
- Structured call objectives and stop conditions
- Transcript/result retrieval
- Human handoff policy where applicable

Do not allow arbitrary high-volume dialing from the general-purpose assistant.

## Memory and learning

Honcho remains the long-term user-model layer. LUKE should improve through controlled memory and evaluation, not uncontrolled self-modification.

Store or infer only information needed to improve future service, with a distinction between:

- Explicit preferences
- Observed/inferred preferences
- Current tasks and obligations
- Stable relationship context
- Outcomes of prior actions
- Session summaries

Do not let an LLM rewrite security policy, authorization rules, production secrets, or its own privileged tool permissions.

## Autonomy policy

Suggested baseline:

- Read-only research/context: automatic when directly requested
- Reversible local/UI operations: automatic where safe
- Email/message sends: explicit approval until per-user policies exist
- Calendar writes/bookings: explicit approval
- Phone calls: explicit approval of target and objective
- Purchases/payments: explicit approval of merchant, amount, and item
- Destructive/account/security changes: explicit approval and stronger verification
- Financial transfer/legal filing/high-impact action: human confirmation required

The existing signed action-token design binds approval to the exact tool and exact argument digest. Preserve this property as the action system expands.

## External projects reviewed for architectural patterns

The following mature/open-source projects are useful references, but should not be copied wholesale into LUKE:

- `ComposioHQ/composio` — authenticated app/tool integration patterns
- `browser-use/browser-use` — browser-agent patterns
- `mem0ai/mem0` — persistent agent-memory patterns
- `livekit/agents` and `livekit/agents-js` — realtime voice/agent orchestration patterns
- `langchain-ai/langgraph` — durable agent graph/orchestration patterns
- `openai/openai-agents-python` — agent, handoff, guardrail, and tracing patterns

Production rule: borrow a component only when it closes a concrete capability gap and passes dependency/security review. Do not make LUKE depend on every agent framework simultaneously.

## Next implementation sequence

1. Configure production secrets and a dedicated `LUKE_SESSION_SECRET`.
2. Connect Gmail, Calendar, Drive, local search, and Retell/Vapi in the deployment's Composio project.
3. Validate every enabled toolkit through read-only smoke tests.
4. Validate write actions through the existing proposal/approval/execute flow.
5. Add connected-account management UX so every LUKE user can authorize their own services.
6. Add persistent jobs/webhooks for monitoring and proactive briefings.
7. Add phone-call objective templates and outcome extraction.
8. Add browser/computer-use fallback only after the direct API layer is stable.
9. Add audit/event storage and per-user action policies before higher autonomy.
10. Build native iOS/Android shells when always-available microphone, notifications, background location, and OS-level integrations are required.
