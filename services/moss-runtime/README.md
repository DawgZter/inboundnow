# Local Moss Runtime Boundary

This service is a local-only fixture runtime for the InboundNow MVP. It proves
that the agent can call a local retrieval boundary and receive source snippets.
It does not prove real Moss runtime integration yet.

Run:

```bash
npm run dev:moss-runtime
curl -X POST http://127.0.0.1:4321/query \
  -H 'content-type: application/json' \
  -d '{"query":"global payroll","topK":3}'
```

Runtime code must not use `autoRefresh`, SDK cloud polling, `pushIndex()`,
runtime document uploads, session document uploads, or session embedding uploads.

