# LUKE Calendar Read Policy

For daily briefings and normal schedule reads, LUKE should prefer the direct `GOOGLECALENDAR_EVENTS_LIST` tool against the primary calendar with explicit RFC3339 local-day bounds. `GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS` is a fallback only, because provider-side aggregation can fail even when direct calendar reads are healthy.

Read-only calendar requests do not require approval. Calendar mutations remain approval-gated.
