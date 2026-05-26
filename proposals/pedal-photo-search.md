# Proposal: in-app pedal photo + dimensions search

Status: **design resolved 2026-05-25, implementation deferred.** Initial
design captured 2026-05; API + key-handling resolved in follow-up
discussion 2026-05-25 (see "API option (photo search)" and "Key handling"
below). Future session can pick up implementation without redoing the
analysis.

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
4. **Respect robots.txt + ToS.** Query via the chosen official API
   (Brave Search — see below) — do NOT HTML-scrape Sweetwater / Reverb
   / manufacturer product pages, and do NOT reverse-engineer keyless
   endpoints (DDG `i.js`, Qwant, SearXNG instances).
5. **No sharing between users.** The library stays per-user.
6. **Document the model.** README + an in-wizard note: "Photos found
   via search are subject to their source's terms. You're responsible
   for confirming any photo you save is OK for your personal use."
7. **Provide a "Where this came from" affordance** on saved pedals
   that shows the source URL and lets the user replace / remove.

## API option (photo search): Brave Search API

**Decision (2026-05-25): Brave Search API, image endpoint, key baked
at build time via CI secret.**

Reasoning trail:

- **In-app search UX is non-negotiable** (Zach, 2026-05-25). Rules out
  patterns that require leaving the wizard (paste-URL primary,
  embedded webview against a real search engine).
- **Render results in our own UI grid**, not in a webview chrome —
  this is what makes the feature feel cohesive with the rest of the
  app. The chosen API needs to return structured JSON (thumb URL,
  full URL, source URL, dimensions, mime).
- **Keyless options were considered and rejected**: DuckDuckGo `i.js`,
  Qwant, SearXNG public instances all work without keys but are
  undocumented / reverse-engineered, can break without notice, and
  live in a ToS gray zone. Fragility unacceptable for a shipped
  feature.
- **Bing Image Search is unavailable**: Microsoft retired the Bing
  Search APIs in August 2025. Do not propose it.
- **Google Custom Search JSON API** considered: 100 queries/day free,
  but the daily cap is unforgiving (a busy Saturday can blow the
  quota and dark the feature until midnight Pacific). Also requires
  configuring a CSE in image-search mode and calling with
  `searchType=image` — more setup overhead than Brave.
- **Brave Search API chosen**: 2,000 queries/month free, 1 qps,
  first-class `/res/v1/images/search` endpoint built for this exact
  use case. Returns the clean shape we need. Monthly bucket forgives
  bursty real-world usage that would hit Google's daily cap. Privacy
  ethos aligns with the app. No CSE configuration overhead. At ~100
  users averaging ~5 searches/week the free tier fits (~2,000/month);
  there's no headroom for growth past that without paying or
  switching providers.

## Key handling

**Decision (2026-05-25): bake the API key into the shipped build at
build time via CI secret. No in-app user-supplied-key field.**

- Key lives in CI secrets / build-environment variable; build step
  injects it into the bundle. Public repo stays clean.
- **No "use your own Brave API key" field in Settings.** Considered
  and rejected: most users have no idea what that means, the small
  fraction who do can rebuild from source with their own key, and
  carrying the setting forever costs more in UI surface + tests +
  edit/migration paths than it's worth.
- **Self-builders from source** get a build with no key (or a build
  error if the key is required) and must supply their own at
  build-time to use the feature. Document this in the README's build
  section.
- **The key is shipped, so it's extractable.** Treat as obfuscation,
  not secrecy. Mitigations:
  - Never enable billing on the key. Brave's free tier hard-stops at
    quota rather than billing through — verify this is still true at
    build time.
  - Monitor usage in Brave's dashboard. A 24h flat-line at quota cap
    means abuse, not 100 enthusiasts; rotate the key + ship a new
    build (treat as a normal release).
  - Re-verify Brave's current ToS before shipping that they don't
    track API users by default and don't prohibit keys-in-clients.

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

New "Search the web" button on the wizard's Image step, alongside
existing "Upload photo" and "Pick a color" affordances.

1. Tap "Search the web" → input prefilled with `{brand} {name}` from
   prior wizard steps.
2. Call Brave Image Search via the existing HTTP client. Render
   results in our own grid (mobile-first sizing, app typography, app
   tap targets) — **not** in a webview. Source URL shown under each
   thumbnail.
3. User taps a thumbnail → app fetches that single image
   client-side → runs through the existing bg-removal + crop +
   auto-detect-color pipeline → previews → user confirms.
4. The pedal record stores the source URL in a new
   `imageSourceUrl?: string` field alongside `imagePath`. Edit Pedal
   surfaces this as "Where this came from" with a "Search again"
   affordance.
5. For dimensions: parallel "Find dimensions" button that runs the
   spec-page parse + offers the result as a suggestion the user can
   accept or override (never silently writes). See "API options
   (dimensions)" above — this part of the design is not yet resolved.
6. Empty / error state: if Brave returns no results, or the request
   fails (quota exhausted, network error), show a clear empty state
   in the same grid — "No results" or "Search is temporarily
   unavailable" — rather than a broken-looking wizard. Falls back to
   the existing upload / color affordances which always work.

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

1. **Dimensions source.** Photo search is resolved (Brave); dimensions
   approach is not. Leading candidate is JSON-LD scrape of the source
   page Brave returned, with a bundled common-pedals facts file as
   fallback. Needs a follow-up design pass.
2. **Cache policy** — do we re-fetch on every app load, or save the
   actual JPEG bytes in the user's local DB? Saving locally is the
   right answer for offline use but adds storage pressure.
3. **Image quality screening** — search results have wildly different
   sizes / aspect ratios. Surface a min-resolution / aspect filter so
   users don't pick a 64×64 thumbnail thinking it's the real photo.
4. **What to do if the source 404s later?** The pedal record keeps
   the cached image bytes; the source URL would just become a dead
   "Where this came from" link. Acceptable.
5. **Quota headroom.** Brave free tier (2,000/month) fits ~100 users
   but has no growth headroom. If user count grows past ~150–200,
   need to revisit: pay Brave, switch providers, or split traffic.
