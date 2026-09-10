# LUCY Architecture and Capability Map

## Product definition

LUCY is an original personal intelligence system: conversational, voice-first, cross-device, persistent, proactive, and capable of taking approved actions through scoped tools. The goal is not to copy fictional dialogue or branding; the goal is to reproduce the useful interaction model: ambient awareness, fast conversational control, durable context, anticipatory assistance, and an auditable action layer.

## Core planes

### 1. Experience plane
- Responsive web application for desktop, tablet, and phone.
- Installable PWA.
- Voice and text use the same visible conversation timeline.
- Compact command center plus deeper Memory, Signals, Skills, and Briefings views.

### 2. Reasoning plane
- Hermes endpoint is preferred when configured.
- Together AI is the hosted fallback for text/deep reasoning.
- Provider adapter is OpenAI Chat Completions compatible so additional models can be added without changing UI code.
- Realtime voice currently uses Deepgram Voice Agent's managed reasoning path for minimum latency; the production target is to route it through the same LUCY reasoning gateway when the public streaming proxy is deployed.

### 3. Memory plane
- Honcho stores user and LUCY as durable peers.
- Stable user/profile ID persists across browser sessions.
- Conversation session IDs scope short-term context.
- Peer cards + representations become prompt context for text reasoning.
- Production identity must replace anonymous browser IDs after authentication is added.

### 4. Voice plane
- Deepgram Browser Agent SDK.
- Short-lived server-issued auth token; permanent Deepgram key never enters browser code.
- PCM microphone capture, noise suppression, echo cancellation, playback, interruption/barge-in, reconnects, and transcript events.

### 5. Action plane (next)
All external actions should use a single typed tool envelope:

```ts
type LucyAction = {
  id: string;
  tool: string;
  operation: string;
  risk: 'read' | 'reversible-write' | 'sensitive-write' | 'irreversible';
  arguments: Record<string, unknown>;
  rationale: string;
  requiresApproval: boolean;
};
```

Rules:
- Read-only operations may execute automatically when the user has granted connector access.
- Reversible writes may be auto-approved only through an explicit user preference.
- Sensitive or irreversible operations always require explicit approval.
- Every action stores request, approval, tool result, timestamp, actor, and rollback metadata when available.

## High-value unique capabilities

### Morning Command Brief
A single personalized briefing that combines calendar, urgent messages, active projects, promised follow-ups, deadlines, travel, weather, and unresolved decisions. LUCY should explain what matters and why rather than dumping notifications.

### Commitment Graph
Extract commitments from conversations and connected apps: "I will send this Friday", "call Jean next week", "submit before September 15". Track owner, due date, dependency, evidence, and completion state. This is more useful than a traditional todo list because it reconstructs obligations automatically.

### Decision Memory
For important decisions, save alternatives considered, assumptions, evidence, chosen option, confidence, and expected outcome. Later LUCY can answer "why did we decide this?" and compare actual results to the original thesis.

### Personal Digital Twin
Maintain a continuously updated model of preferred writing tone, work patterns, priorities, recurring contacts, organizations, travel preferences, risk tolerance, and decision style. Expose every inferred fact with source/evidence and let the user correct it.

### Pre-Meeting Intelligence
Before a meeting, automatically prepare: participants, recent interactions, open commitments, related files, relevant project state, likely questions, risks, and suggested objectives. After the meeting, extract decisions and follow-ups.

### Guardian / Risk Radar
Continuously evaluate connected workflows for expiring domains, payment failures, security anomalies, unanswered critical email, missed deadlines, broken deployments, reputation issues, calendar conflicts, and other exceptions. Notify only when an intervention is useful.

### Autonomous Project Auditor
Given a GitHub repository or deployed application, LUCY can inspect CI, errors, dependency health, performance, SEO, accessibility, security posture, and product gaps; generate a remediation plan; prepare a branch/PR; and require approval for deployment.

### Contextual Skills Composer
Instead of a static skill marketplace, LUCY can assemble a temporary workflow from available tools. Example: "prepare my producer meeting" can combine Gmail retrieval, company research, calendar context, a financial model, and a briefing document.

### What-Changed Engine
Maintain fingerprints of important entities—projects, contracts, key accounts, travel bookings, websites, regulations—and surface only material changes since the user's last review.

### Personal Simulation Mode
Before executing a major choice, LUCY can generate scenario branches (best/base/worst case), assumptions, reversible experiments, failure triggers, and what information would change the decision. It must clearly distinguish simulation from prediction.

### Explain-My-Day Timeline
Build an auditable chronological view of what LUCY observed, inferred, suggested, and executed. This creates trust and makes debugging assistant behavior possible.

## Production-critical items

1. Authentication and account recovery.
2. Server-side user identity mapping; no authorization decisions based on client-generated IDs.
3. Database for encrypted connector metadata, action ledger, preferences, and device registrations.
4. Shared memory path for both voice and text.
5. Hermes tool gateway with allowlists, schemas, timeouts, idempotency keys, and approval checks.
6. OAuth connector vault for Gmail, Calendar, Drive, GitHub, Slack, browser/computer control, and future smart-home integrations.
7. Per-user and per-IP rate limiting.
8. CSRF/origin protections on write routes.
9. Observability: traces for model calls, memory calls, voice latency, tool execution, errors, and cost.
10. Model/provider fallback policy with circuit breakers.
11. Data retention, export, deletion, and consent controls.
12. End-to-end browser testing on Chromium and WebKit at phone/tablet/desktop breakpoints.
13. Push notifications and scheduled/conditional background jobs.
14. Accessibility audit including keyboard, screen reader, reduced-motion, and high-contrast behavior.
15. Threat model for prompt injection through retrieved email/web/file content and tool arguments.

## Definition of "full functional"

LUCY should only be called production-complete when a signed-in user can move between devices, carry persistent context, converse by voice or text, connect at least one external system, receive proactive briefings, review/approve an action, see the verified action result, and inspect or delete the associated memory/audit history without exposing provider secrets to the client.
