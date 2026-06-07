# remote.com scrape

Repo import note: this checked-in folder keeps the indexable scrape corpus, manifests, and logs. Raw per-page fetch payloads (`*.direct.json`, `*.firecrawl.json`) and Firecrawl job records are omitted from git because Moss indexing only needs markdown text plus metadata. See `data/remote-com/README.md`.

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

- sitemap_urls.json: all crawlable remote.com sitemap URLs discovered.
- selected_urls.json: all non-blog URLs plus the latest 50 blog URLs.
- latest_50_blog_urls.json: the capped blog article list.
- pages/blog/: 50 latest blog pages.
- pages/site/: non-blog pages saved before stop.
- logs/success.jsonl: saved-page log.
- logs/errors.high_concurrency_403_*.jsonl: archived transient errors from the first too-fast fallback attempt.
- jobs/: Firecrawl job records.
