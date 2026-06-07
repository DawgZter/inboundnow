# Local Moss Runtime Boundary

This service is a local-only retrieval boundary for the InboundNow MVP. It can
serve the checked-in fixture adapter or query a prebuilt local retrieval artifact.
It does not prove hosted Moss or Moss SDK runtime integration.

Fixture mode:

```bash
npm run dev:moss-runtime
curl -X POST http://127.0.0.1:4321/query \
  -H 'content-type: application/json' \
  -d '{"query":"global payroll","topK":3}'
```

Local artifact mode:

```bash
npm run moss:index
MOSS_RUNTIME_PROVIDER=local-artifact npm run dev:moss-runtime
curl -X POST http://127.0.0.1:4321/query \
  -H 'content-type: application/json' \
  -d '{"query":"global payroll","topK":3}'
```

One-command proof:

```bash
npm run smoke:moss:local
```

Runtime code must not use `autoRefresh`, SDK cloud polling, `pushIndex()`,
runtime document uploads, session document uploads, or session embedding uploads.
