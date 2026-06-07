# remote.com scrape

Updated: 2026-06-07T09:19:45.903Z

Stopped at user request. This folder contains the partial remote.com scrape completed so far.

Firecrawl was used until the available key reached 0 remaining credits. Remaining public sitemap URLs were being fetched directly when the run was stopped.

## Summary

~~~json
{
  "outputDir": "/Users/karimyahia/Documents/Codex/2026-06-07/do-you-have-access-to-my/outputs/remote_com_scrape",
  "stoppedAt": "2026-06-07T09:19:45.903Z",
  "stoppedByUser": true,
  "sitemapTotal": 43951,
  "sitemapBlogTotal": 1816,
  "sitemapNonBlogTotal": 42135,
  "selectedTotal": 42185,
  "selectedBlogLatest": 50,
  "selectedSite": 42135,
  "completedTotal": 10842,
  "completedBlog": 50,
  "completedSite": 10792,
  "erroredSelected": 0,
  "remainingSelected": 31343,
  "firecrawlPages": 29,
  "directFetchPages": 10813,
  "notes": [
    "Firecrawl was used until the key reached 0 remaining credits.",
    "Direct-fetch fallback was stopped at the user request.",
    "A high-concurrency transient 403 error log was archived under logs/errors.high_concurrency_403_*.jsonl and is not counted as final errors."
  ]
}
~~~

## Contents

- manifest.json: scrape summary metadata used by the local Moss importer.
- pages/blog/: 50 latest blog pages saved as markdown plus matching metadata JSON.
- pages/site/: non-blog pages saved as markdown plus matching metadata JSON.
- README.md: this committed corpus summary.

Raw fetch payloads, Firecrawl job records, crawl logs, sitemap URL lists, selected URL lists, and latest-blog URL lists are intentionally omitted from the committed retrieval corpus. The local Moss indexer reads the markdown files and matching metadata JSON only.
