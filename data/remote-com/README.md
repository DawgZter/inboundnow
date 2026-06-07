# Remote.com Scrape Fixture

This folder contains the indexable portion of the partial Remote.com scrape captured on 2026-06-07.

Source on the local workstation:

```text
/Users/karimyahia/Documents/Codex/2026-06-07/do-you-have-access-to-my/outputs/remote_com_scrape
```

The repo import keeps:

- scrape provenance files: `README.md`, `manifest.json`, sitemap and selected URL JSON files
- saved markdown pages under `pages/`
- per-page `*.metadata.json`
- scrape logs under `logs/`

The repo import intentionally omits raw per-page fetch payloads (`*.direct.json`, `*.firecrawl.json`) and Firecrawl job records because they are not needed to build a Moss document file or the local retrieval artifact. Generated Moss documents and local indexes are written under `artifacts/`, which is gitignored.

The scrape is partial. The source manifest reports 10,842 completed pages and 31,343 selected URLs remaining when the run was stopped by user request.

