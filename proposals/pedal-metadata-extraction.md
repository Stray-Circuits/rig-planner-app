# Proposal: pre-fill brand / model / dimensions from a picked search result

Status: **ready to implement** (next session). Continuation of
`proposals/pedal-photo-search.md` (which is now implemented).

## Goal

After the user picks a Brave search result on the Add Pedal wizard's
Image step, fetch the source page, extract what we can about the pedal,
and pre-fill the wizard's Name & Size step (brand, model, width, depth).
The user always sees and confirms the values — we never silently write.

The premise: typing a pedal's brand and model is mildly annoying. Looking
up its dimensions is _genuinely_ annoying — you have to consult specs
or measure it. If we can auto-fill, the wizard goes from "type a bunch
of stuff" to "tap a photo, hit Continue." That's the magic.

## The trust-cost principle (most important constraint)

Pre-fill only when confidence is high. Specifically for dimensions: **a
wrong dimension is worse than no dimension**.

When the dimension is wrong, the canvas renders the pedal at the wrong
scale, which Zach will see in the app and have to correct. That's a
worse experience than the field starting blank, because (a) the user
doesn't know whether to trust the pre-filled value, (b) if they don't
double-check, the board layout will be silently wrong, and (c) fixing
it requires editing the pedal after they already accepted it.

Practical implications:

- For brand/model: pre-fill aggressively. Wrong values are obvious from
  the typed field and easy to fix before the user has built a board.
- For dimensions: pre-fill **only** when we have high-confidence
  structured data (JSON-LD `Product` schema with proper units). If the
  best we have is text scraped from a spec section, leave the field
  blank — don't guess.
- All pre-filled values are editable, with no UI indication of
  "auto-filled vs. user-typed" — the user just sees prefilled fields
  in Name & Size as if they'd already typed.

## Sources, in priority order

1. **JSON-LD `Product` schema** in `<script type="application/ld+json">`
   on the source page. Manufacturers and big retailers publish this for
   Google Shopping; it includes `brand.name`, `name`, sometimes
   `width`/`depth`/`height` with units. **Highest confidence.**
2. **OpenGraph + meta tags** — `og:title`, `og:site_name`,
   `<meta name="product:..." />`. Decent for brand/name, rarely has
   dimensions. **Medium confidence.**
3. **Page `<title>` heuristic** — split "Boss DS-1 Distortion Pedal" into
   brand + model with a small known-brands list. **Low confidence,
   fallback only.**
4. **Brave result's `title` and `meta_url.hostname`** — we already have
   these in memory from the search result. Free fallback for brand/name
   when the page itself fails to load.

## What we will NOT do

- **Scrape Reverb / Sweetwater / Equipboard spec tables.** The original
  proposal explicitly forbade this on ToS / brittleness grounds, and
  that's still right. JSON-LD is fair game because manufacturers
  publish it for machines; spec tables are HTML structure we'd be
  reverse-engineering.
- **Bundle a curated facts file** (originally proposed as Tier 3). Zach
  decided dimension accuracy mattered more than completeness — bundled
  facts would create a different trust problem (stale data, wrong
  variant of a pedal model, etc.).
- **Silently pre-fill dimensions from low-confidence sources** (see
  trust-cost principle).

## Implementation sketch

### New module: `src/lib/pedalMetadata.ts`

Pure function plus discriminated outcomes, same shape as
`braveSearch.ts`:

```ts
export interface ExtractedPedalMetadata {
  brand: string | null;
  name: string | null;
  /** Only set when extracted from JSON-LD with explicit units. */
  widthIn: number | null;
  /** Only set when extracted from JSON-LD with explicit units. */
  depthIn: number | null;
}

export type MetadataOutcome =
  | { kind: 'ok'; metadata: ExtractedPedalMetadata }
  | { kind: 'page_unreachable' } // network / CORS / 4xx-5xx
  | { kind: 'empty' };           // page loaded but no usable signals

export async function extractPedalMetadata(
  pageUrl: string,
  options?: { signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<MetadataOutcome>;
```

Internals:

1. Fetch `pageUrl` via the platform fetch (same `platformFetch` switch
   used in `braveSearch.ts` — under Tauri this routes through
   `@tauri-apps/plugin-http`; in browser-dev it'll mostly CORS-fail,
   which is fine).
2. Parse HTML with `DOMParser` (already available in webview + jsdom).
3. Extract candidates in priority order, merge into one
   `ExtractedPedalMetadata`. Earlier sources win.
4. Run sanity clamps on dimensions (0.5–24 inches inclusive). Drop
   anything outside that range to null.
5. Return `{ kind: 'ok', metadata }` even when all fields are null —
   `{ kind: 'empty' }` is reserved for "page literally had zero
   usable signals," which is rare.

### Unit parsing

Spec tables / JSON-LD use many formats: `2.87`, `"2.87 in"`, `"2.87
inches"`, `"73 mm"`, `"73mm"`, `"2.87\""`. Write a small parser:

```ts
function parseDimension(raw: string | number): number | null
```

Returns inches as a number. Drops anything outside 0.5–24 (defends
against bad markup that yields `0.001` or `500`). Convert mm → in by
`/ 25.4`.

### Wizard integration

The picked-image flow currently is:

```
pickResult → fetchImageAsBlob → processFile (bg removal pipeline)
                              → setDraft({ photoSourceUrl })
```

After this work, extend to:

```
pickResult → fetchImageAsBlob → processFile (bg removal)
                              → setDraft({ photoSourceUrl })
                              → extractPedalMetadata (in background)
                              → setDraft({ brand?, name?, widthIn?, depthIn? })
```

Two important properties:

- Metadata extraction runs **in parallel with** the existing bg-removal
  flow, not in sequence. It's slower than the image fetch and shouldn't
  block the user from advancing to Name & Size.
- Only overwrite draft fields that are currently empty. If the user
  already typed something into brand/name, don't blow it away. Same for
  dimensions.

### File-level changes anticipated

- New: `src/lib/pedalMetadata.ts`
- New: `tests/pedalMetadata.test.ts` (fixture HTML strings inline,
  exercise each source path + the unit parser + sanity clamp)
- Edit: `src/screens/add-pedal/AddPedalWizard.tsx` — add the
  parallel-fire in `pickResult`, plus a "don't overwrite typed fields"
  guard

No schema changes. Brand/name/widthIn/depthIn already exist.

## What's already in place (don't re-derive)

- **Tauri HTTP plugin** is wired (Cargo + capability +
  `@tauri-apps/plugin-http`). Capability allows arbitrary HTTPS/HTTP
  hosts, which already covers fetching arbitrary product pages — no
  capability changes needed.
- **`platformFetch` pattern** in `src/lib/braveSearch.ts` shows how to
  pick the right fetch impl for the environment. Copy or extract.
- **`vi.stubEnv` pattern** in `tests/braveSearch.test.ts` shows how to
  test code that reads `import.meta.env` deterministically (not needed
  for metadata extraction directly, but useful if you add any
  feature-flag-style env reads).
- **The Image step's wizard draft** already has `photoSourceUrl`
  threaded through and persisted via `imageSourceUrl` on the Pedal
  schema. Use the same `setDraft((d) => …)` pattern to land the new
  fields.

## Testing approach

- **Fixture HTML strings inline** in the test file. Don't pull live
  pages in tests — same reasoning as `braveSearch.test.ts`'s
  fixture-based approach.
- Cover at least: JSON-LD-only page, OpenGraph-only page, title-only
  page, page with all three (JSON-LD wins), JSON-LD with mm units,
  JSON-LD with insane numbers (gets clamped out), unfetchable URL.
- Don't burn live API quota during dev — Brave search is unchanged.
- The actual page fetches in production go through `@tauri-apps/plugin-http`
  which has the same CORS-bypass behavior as the image fetches.

## Open questions to confirm before implementing

1. **Pre-fill timing.** Should we wait for both bg-removal AND
   metadata to finish before advancing to Name & Size, or let the user
   tap Continue early and let the metadata "appear" in the fields if
   they're still on the step? The second is more in-line with how
   bg-removal already works (banner says "still removing background")
   but means fields can change under the user's cursor.
2. **Edit Pedal behavior.** When the user re-picks a search result for
   an existing pedal, should metadata extraction overwrite existing
   non-empty fields? My instinct: no, preserve the existing values
   (treat them as "trust the user's prior typing"). Worth confirming.
3. **Known-brands list for title heuristic.** Worth shipping a short
   list (Boss, MXR, EHX, Strymon, Walrus, JHS, Chase Bliss, Way Huge,
   Wampler, Earthquaker, Source Audio, Empress, Eventide, Keeley,
   Mooer, TC Electronic, Line 6, ZVEX, Catalinbread, Maxon) so the
   heuristic isn't completely random? Or skip the heuristic entirely
   if no high-confidence source matched, leaving fields blank?

## Prompt for the next session (paste as-is)

> Implement Tier 2 pedal metadata extraction per
> `proposals/pedal-metadata-extraction.md`. The proposal has the full
> design, constraints (especially the trust-cost principle), file
> layout, and open questions. Build the pure module + tests first, then
> wire it into the wizard's `pickResult` flow as a parallel fire after
> bg-removal kicks off. Don't re-derive the API/transport plumbing —
> the Brave search and Tauri HTTP plugin work is already done. Run all
> four gates green and commit at feature boundary.
