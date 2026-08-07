# Daily update guardrails

- Scheduled research runs are read-only and must return JSON that matches `schemas/research-output.schema.json`.
- Never edit application source files during a scheduled research run.
- Research only publicly accessible event information. Never request, expose, or store credentials or private posts.
- Include only events inside Tokyo's 23 special wards, taking place on the requested date, and reachable from Kotake-mukaihara in about 60 minutes or less.
- Exclude known sold-out, closed, cancelled, postponed, registration-closed, and already-ended events.
- Prefer official organizer pages. Aggregators and public social posts are discovery sources and must link to the most authoritative available page.
- Use official-event preview images only when a public image URL is available. Always keep image attribution and source URL. Otherwise return `null` and let the site use its built-in fallback.
- Do not fabricate availability, prices, times, images, or URLs. Use `unknown` only where the schema permits it.
