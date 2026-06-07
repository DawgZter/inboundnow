# Remote.com Retrieval Corpus

This folder contains the committed Remote.com retrieval corpus used by the local Moss indexer.

The bundle was generated from the 2026-06-07 Remote.com scrape source artifact provided for this repo.

The committed import keeps:

- `remote-com-documents.json.gz`: a compressed Moss-style JSON document array with 10,842 documents.
- this README.

The repo import intentionally omits the loose markdown workspace, raw per-page fetch payloads (`*.direct.json`, `*.firecrawl.json`), Firecrawl job records, scrape logs, sitemap URL lists, selected URL lists, and latest-blog URL lists. Generated Moss documents and local indexes are written under `artifacts/`, which is gitignored.

The scrape is partial. The source manifest reports 10,842 completed pages and 31,343 selected URLs remaining when the run was stopped by user request.
