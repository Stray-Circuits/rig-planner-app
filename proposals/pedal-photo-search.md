# Proposal: in-app pedal photo + dimensions search

Status: **deferred** (2026-05). Capturing design + legal context now so a
future session can pick it up without re-doing the analysis.

## Goal

Let users populate their pedal library faster by searching the web for a
pedal's photo and physical dimensions from inside the Add Pedal wizard,
instead of having to find / download / re-upload a photo themselves.

## Why this is plausibly OK (the legal posture)

Earlier in the project we agreed we couldn't bundle third-party product
photography in the repo — copyright restricts use, not just commercial
use, and the AGPLv3 license we ship under doesn't change that. But the
question who's making the copy matters: a browser loading a page makes
a copy too, and we don't treat that as infringing because the user
initiated the navigation. As long as this feature stays close to the
"browser-like" end of the spectrum, the legal posture is much better
than bundling photos.

The two ends:

| Scenario | Posture |
|---|---|
| App ships 200 pedal photos in repo | Clearly infringing. |
| User taps "Search photo", picks one, app saves it locally to that user's device | Plausibly OK. User-initiated, single-asset, no aggregation, no server-side cache. |
| App pre-bulk-downloads "top 200 pedal photos" on first launch | Iffy even though there's no server copy — deliberate program to assemble an unlicensed catalog (see Aereo / Cablevision lines of cases). |

The middle row is what we'd be building, plus the constraints below.

**Facts (dimensions) aren't copyrightable.** Even if a manufacturer's
spec page itself is copyrighted, extracting "Boss DS-1: 2.87" × 5.12""
from it is fine. Dimension search is lower-risk than photo search.

## Constraints to maintain (non-negotiable)

These are what keep the feature in the safe zone. Violating any of them
moves us toward the "iffy" row.

1. **Each search is user-initiated.** No background polling, no
   "auto-find photo for every pedal in my library" bulk action. One
   tap = one search = one save.
2. **No server-side cache.** The fetched photo lives on the user's
   device only. No sync service, no shared library, no telemetry that
   transmits the image.
3. **Store the source URL alongside the saved photo.** Gives us a
   DMCA-takedown path and acts as informal attribution.
4. **Respect robots.txt + ToS.** Query via official APIs (Google
   Custom Search Engine, Bing Image Search, Wikimedia) — do NOT
   HTML-scrape Sweetwater / Reverb / manufacturer product pages.
5. **No sharing between users.** The library stays per-user.
6. **Document the model.** README + an in-wizard note: "Photos found
   via search are subject to their source's terms. You're responsible
   for confirming any photo you save is OK for your personal use."
7. **Provide a "Where this came from" affordance** on saved pedals
   that shows the source URL and lets the user replace / remove.

## API options (photo search)

- **Google Custom Search Engine** — free tier ≈ 100 queries/day. Needs
  a CSE configured by the project owner. Returns image URLs +
  attribution + thumbnails.
- **Bing Image Search API** — paid (Azure). Higher quality, no daily
  limit, similar shape.
- **Wikimedia Commons API** — free, no key, results filtered to
  CC-licensed assets. Coverage of pedals is thin and the photos that
  exist are inconsistent (random angles, full backgrounds) — Zach
  reviewed and judged them not good enough. Useful as a *secondary*
  source mixed with one of the above, or for boards / brand logos.

**API key handling**: keys can't ship in the repo or the client
bundle. Either (a) the user supplies their own CSE key in Settings,
(b) we proxy through a tiny serverless endpoint we own (then we eat
the rate-limit cost), or (c) we run an Edge Function with per-user
quotas. Picking one is a separate design call.

## API options (dimensions)

- **Manufacturer JSON-LD / schema.org markup** on the product page —
  many brands expose `Product` with `width` / `depth`. Cleanest
  source, since we're consuming structured data they've already
  authored for SEO / Google Shopping.
- **Sweetwater / Reverb spec sections** — these pages have stable
  table structure but scraping them is ToS-iffy.
- **A community-curated JSON file** in the repo — we could ship facts
  (dimensions only, no photos) for the top N pedals as accepted CC0
  data. Brand names are nominative. Facts aren't copyrightable.

For v1, suggest combining (a) scraping JSON-LD when present + (c) a
small bundled "common pedals" facts file we maintain as the
authoritative fallback.

## Implementation sketch

New wizard step or button on the Image step:

1. "Search the web" button alongside the existing "Upload photo" and
   "Pick a color" affordances.
2. Tapping it surfaces an input prefilled with `{brand} {name}`.
3. Calls the search API, shows ~6 result thumbnails with source URL
   shown under each.
4. User taps one → app fetches that single image client-side → runs
   through the existing bg-removal + crop + auto-detect-color pipeline
   → previews → user confirms.
5. The pedal record stores the source URL in a new
   `imageSourceUrl?: string` field alongside `imagePath`. Edit Pedal
   surfaces this as "Where this came from" with a "Search again"
   affordance.
6. For dimensions: a parallel "Find dimensions" button that runs the
   spec-page parse + offers the result as a suggestion the user can
   accept or override (never silently writes).

## Schema impact

Single new optional column on `pedals`:
- `image_source_url TEXT NULL`

Migration #2 (we're at #1 currently). Adds to the `Pedal` interface in
`src/data/schema.ts` and the create/update inputs.

## What this UNBLOCKS

- Faster pedal-library bootstrapping for users without sacrificing the
  "all data is per-user" model.
- Optional future: a community-curated dimensions JSON we maintain in
  the repo (facts only, no photos) as a fallback when search fails.
- The original "seed top 200 pedals" idea (`other_todos.txt`), but
  reframed: ship the top-N as a *facts-only* dataset that pulls photos
  on-demand the first time a user picks one.

## What this does NOT solve

- Boards (`#20` in FOLLOWUPS) still need our own top-down renders —
  the search-then-fetch pattern would technically work for boards too
  but the result quality bar is much higher there (top-down, no
  perspective, no background), so generated renders are still the
  better answer for boards.

## Open questions

1. **API key custody** — user-supplies, proxy server, or edge function?
2. **Cache policy** — do we re-fetch on every app load, or save the
   actual JPEG bytes in the user's local DB? Saving locally is the
   right answer for offline use but adds storage pressure.
3. **Image quality screening** — search results have wildly different
   sizes / aspect ratios. Surface a min-resolution / aspect filter so
   users don't pick a 64×64 thumbnail thinking it's the real photo.
4. **What to do if the source 404s later?** The pedal record keeps
   the cached image bytes; the source URL would just become a dead
   "Where this came from" link. Acceptable.
