# Round 6 Hosted Moss Upload

## Scope

Uploaded the exact Remote.com scrape source requested by the user to hosted Moss:

- Source: `/Users/karimyahia/Documents/Codex/2026-06-07/do-you-have-access-to-my/outputs/remote_com_scrape`
- Export: `artifacts/moss/remote-com-documents.json`
- Documents: 10,842
- Export size: 62,618,331 bytes after Moss CLI metadata stringification
- Index name: `remote-com-2026-06-07`
- Index id: `4536a03c-8275-4709-a5d8-768725c220a6`
- Status: `Ready`
- Model: `moss-minilm`

## Implementation Note

The Moss CLI requires document metadata values to be strings. The first upload attempt failed locally on numeric metadata such as `statusCode: 200`. The exporter now stringifies metadata only in `writeRemoteComScrapeDocuments()`, preserving the in-memory loader for local retrieval.

## Verification

- `node --test test/remote-com-scrape.test.mjs` passed.
- `REMOTE_COM_SCRAPE_PATH=/Users/karimyahia/Documents/Codex/2026-06-07/do-you-have-access-to-my/outputs/remote_com_scrape npm run moss:docs:remote` exported 10,842 documents.
- `moss index get remote-com-2026-06-07` returned Ready with doc count 10,842.
- `moss query remote-com-2026-06-07 "How does Remote help with global payroll?" --top-k 3` returned Remote payroll/global HR documents locally after index load.

## Boundary

This is hosted index-generation/query proof. The all-local MVP runtime still uses local Moss artifacts and must not depend on hosted Moss during local persona execution. The Moss project key was used only through shell environment variables and was not committed.
