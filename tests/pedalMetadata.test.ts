import { describe, expect, it, vi } from 'vitest';
import {
  extractPedalMetadata,
  findPedalDimensionsByQuery,
  parseDimension,
  type ExtractedPedalMetadata,
} from '../src/lib/pedalMetadata';
import type { BraveWebOutcome, BraveWebResult } from '../src/lib/braveSearch';

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html' },
  });
}

function fetchReturning(response: Response): typeof fetch {
  return vi.fn(() => Promise.resolve(response));
}

function fetchThrowing(err: Error): typeof fetch {
  return vi.fn(() => Promise.reject(err));
}

function wrap(body: string): string {
  return `<!doctype html><html><head>${body}</head><body></body></html>`;
}

describe('parseDimension', () => {
  it('treats bare numbers as inches', () => {
    expect(parseDimension(2.87)).toBeCloseTo(2.87, 5);
  });

  it('parses inch strings with units', () => {
    expect(parseDimension('2.87 in')).toBeCloseTo(2.87, 5);
    expect(parseDimension('2.87"')).toBeCloseTo(2.87, 5);
    expect(parseDimension('2.87 inches')).toBeCloseTo(2.87, 5);
  });

  it('converts mm to inches', () => {
    expect(parseDimension('73 mm')).toBeCloseTo(73 / 25.4, 5);
    expect(parseDimension('73mm')).toBeCloseTo(73 / 25.4, 5);
  });

  it('converts cm to inches', () => {
    expect(parseDimension('7.3 cm')).toBeCloseTo(7.3 / 2.54, 5);
  });

  it('handles QuantitativeValue objects with unitCode', () => {
    expect(parseDimension({ value: 73, unitCode: 'MMT' })).toBeCloseTo(
      73 / 25.4,
      5,
    );
    expect(parseDimension({ value: 2.87, unitCode: 'INH' })).toBeCloseTo(
      2.87,
      5,
    );
  });

  it('drops out-of-range values', () => {
    expect(parseDimension(0.001)).toBeNull();
    expect(parseDimension(500)).toBeNull();
    expect(parseDimension('0.2 in')).toBeNull();
    expect(parseDimension('30 in')).toBeNull();
  });

  it('returns null for unknown units rather than guessing', () => {
    expect(parseDimension('3 furlongs')).toBeNull();
  });

  it('returns null for unparseable input', () => {
    expect(parseDimension('')).toBeNull();
    expect(parseDimension('about 3 inches')).toBeNull();
    expect(parseDimension(null)).toBeNull();
    expect(parseDimension(undefined)).toBeNull();
  });
});

describe('extractPedalMetadata — JSON-LD', () => {
  it('reads brand/name/dimensions from a Product schema', async () => {
    const json = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'DS-1 Distortion',
      brand: { '@type': 'Brand', name: 'Boss' },
      width: { '@type': 'QuantitativeValue', value: 2.87, unitCode: 'INH' },
      depth: { '@type': 'QuantitativeValue', value: 5.12, unitCode: 'INH' },
    };
    const html = wrap(
      `<script type="application/ld+json">${JSON.stringify(json)}</script>`,
    );
    const outcome = await extractPedalMetadata('https://example.com/ds1', {
      fetchImpl: fetchReturning(htmlResponse(html)),
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.metadata.brand).toBe('Boss');
    expect(outcome.metadata.name).toBe('DS-1 Distortion');
    expect(outcome.metadata.widthIn).toBeCloseTo(2.87, 5);
    expect(outcome.metadata.depthIn).toBeCloseTo(5.12, 5);
  });

  it('converts mm dimensions from JSON-LD QuantitativeValue', async () => {
    const json = {
      '@type': 'Product',
      name: 'Big Muff Pi',
      brand: 'Electro-Harmonix',
      width: { value: 73, unitCode: 'MMT' },
      depth: { value: 130, unitCode: 'MMT' },
    };
    const html = wrap(
      `<script type="application/ld+json">${JSON.stringify(json)}</script>`,
    );
    const outcome = await extractPedalMetadata('https://example.com/muff', {
      fetchImpl: fetchReturning(htmlResponse(html)),
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.metadata.widthIn).toBeCloseTo(73 / 25.4, 5);
    expect(outcome.metadata.depthIn).toBeCloseTo(130 / 25.4, 5);
  });

  it('clamps out implausible JSON-LD dimensions to null', async () => {
    const json = {
      '@type': 'Product',
      name: 'Bad Listing',
      brand: 'Mystery',
      width: 500,
      depth: 0.001,
    };
    const html = wrap(
      `<script type="application/ld+json">${JSON.stringify(json)}</script>`,
    );
    const outcome = await extractPedalMetadata('https://example.com/bad', {
      fetchImpl: fetchReturning(htmlResponse(html)),
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.metadata.widthIn).toBeNull();
    expect(outcome.metadata.depthIn).toBeNull();
    // Brand/name still pre-filled — they're independent signals.
    expect(outcome.metadata.brand).toBe('Mystery');
    expect(outcome.metadata.name).toBe('Bad Listing');
  });

  it('walks @graph wrappers', async () => {
    const json = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', name: 'Some page' },
        {
          '@type': 'Product',
          name: 'TS9 Tube Screamer',
          brand: { name: 'Ibanez' },
        },
      ],
    };
    const html = wrap(
      `<script type="application/ld+json">${JSON.stringify(json)}</script>`,
    );
    const outcome = await extractPedalMetadata('https://example.com/ts9', {
      fetchImpl: fetchReturning(htmlResponse(html)),
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.metadata.brand).toBe('Ibanez');
    expect(outcome.metadata.name).toBe('TS9 Tube Screamer');
  });

  it('falls back to height when depth is missing', async () => {
    const json = {
      '@type': 'Product',
      name: 'Compact Stompbox',
      brand: 'Acme',
      width: 2.5,
      height: 4.5,
    };
    const html = wrap(
      `<script type="application/ld+json">${JSON.stringify(json)}</script>`,
    );
    const outcome = await extractPedalMetadata('https://example.com/acme', {
      fetchImpl: fetchReturning(htmlResponse(html)),
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.metadata.depthIn).toBe(4.5);
  });
});

describe('extractPedalMetadata — labeled spec scrape', () => {
  it('reads <th>Width</th><td>2.87 in</td> spec tables', async () => {
    const html = `<!doctype html><html><body>
      <table><tbody>
        <tr><th>Width</th><td>2.87 in</td></tr>
        <tr><th>Depth</th><td>5.12 in</td></tr>
        <tr><th>Height</th><td>2.5 in</td></tr>
      </tbody></table>
    </body></html>`;
    const outcome = await extractPedalMetadata('https://example.com/x', {
      fetchImpl: fetchReturning(htmlResponse(html)),
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.metadata.widthIn).toBeCloseTo(2.87, 5);
    expect(outcome.metadata.depthIn).toBeCloseTo(5.12, 5);
    // Height is deliberately ignored — that's off-board knob clearance.
  });

  it('reads <dt>/<dd> definition list specs in mm', async () => {
    const html = `<!doctype html><html><body>
      <dl>
        <dt>Width</dt><dd>73 mm</dd>
        <dt>Depth</dt><dd>130 mm</dd>
      </dl>
    </body></html>`;
    const outcome = await extractPedalMetadata('https://example.com/x', {
      fetchImpl: fetchReturning(htmlResponse(html)),
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.metadata.widthIn).toBeCloseTo(73 / 25.4, 5);
    expect(outcome.metadata.depthIn).toBeCloseTo(130 / 25.4, 5);
  });

  it('reads colon-form `Width: 2.87"` with the inch glyph', async () => {
    const html = `<!doctype html><html><body>
      <p>Width: 2.87"</p>
      <p>Depth: 5.12"</p>
    </body></html>`;
    const outcome = await extractPedalMetadata('https://example.com/x', {
      fetchImpl: fetchReturning(htmlResponse(html)),
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.metadata.widthIn).toBeCloseTo(2.87, 5);
    expect(outcome.metadata.depthIn).toBeCloseTo(5.12, 5);
  });

  it('reads Strymon-style prose `6.75" wide x 5.1" deep`', async () => {
    const html = `<!doctype html><html><body>
      <ul><li>6.75” wide (17.15 cm) x 5.1” deep (12.95 cm) x 2.7” tall (6.86 cm)</li></ul>
    </body></html>`;
    const outcome = await extractPedalMetadata('https://example.com/x', {
      fetchImpl: fetchReturning(htmlResponse(html)),
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.metadata.widthIn).toBeCloseTo(6.75, 5);
    expect(outcome.metadata.depthIn).toBeCloseTo(5.1, 5);
  });

  it('reads Sweetwater-style embedded JSON with escaped inch glyphs', async () => {
    // Real shape from a Sweetwater product page: the dimension data lives
    // inside a JSON blob in a <script> tag. The `"name":"Width"` field is
    // a duplicate label that sits close enough to the value to anchor the
    // regex even when the outer key is further away.
    const blob = `{"specs":{"Width":{"name":"Width","data":"","detail":"2.97\\"","quantityUnit":{"code":"INH"}},"Depth":{"name":"Depth","data":"","detail":"4.75\\"","quantityUnit":{"code":"INH"}}}}`;
    const html = `<!doctype html><html><body>
      <script>window.__STATE__ = ${blob};</script>
    </body></html>`;
    const outcome = await extractPedalMetadata('https://example.com/x', {
      fetchImpl: fetchReturning(htmlResponse(html)),
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.metadata.widthIn).toBeCloseTo(2.97, 5);
    expect(outcome.metadata.depthIn).toBeCloseTo(4.75, 5);
  });

  it('rejects bare numbers without explicit units', async () => {
    const html = `<!doctype html><html><body>
      <p>Width: 2.87</p>
      <p>Depth: 5.12</p>
    </body></html>`;
    const outcome = await extractPedalMetadata('https://example.com/x', {
      fetchImpl: fetchReturning(htmlResponse(html)),
    });
    // No usable signals — bare numbers don't count.
    expect(outcome.kind).toBe('empty');
  });

  it('rejects out-of-range labeled values', async () => {
    const html = `<!doctype html><html><body>
      <p>Width: 500 in</p>
      <p>Depth: 0.1 in</p>
    </body></html>`;
    const outcome = await extractPedalMetadata('https://example.com/x', {
      fetchImpl: fetchReturning(htmlResponse(html)),
    });
    expect(outcome.kind).toBe('empty');
  });

  it('ignores height / tall / high (off-board, not footprint)', async () => {
    const html = `<!doctype html><html><body>
      <p>Height: 2.5 in</p>
      <p>2.5" tall</p>
    </body></html>`;
    const outcome = await extractPedalMetadata('https://example.com/x', {
      fetchImpl: fetchReturning(htmlResponse(html)),
    });
    expect(outcome.kind).toBe('empty');
  });

  it('ignores CSS rules like `min-width: 320px`', async () => {
    const html = `<!doctype html><html><head>
      <style>.container { min-width: 320px; width: 100%; max-width: 1200px; }</style>
    </head><body>
      <p>An unrelated paragraph.</p>
    </body></html>`;
    const outcome = await extractPedalMetadata('https://example.com/x', {
      fetchImpl: fetchReturning(htmlResponse(html)),
    });
    expect(outcome.kind).toBe('empty');
  });

  it('takes the first occurrence when a label appears multiple times', async () => {
    const html = `<!doctype html><html><body>
      <p>Width: 2.87 in</p>
      <p>Customer review: "I expected a width of 4 in but it's smaller"</p>
    </body></html>`;
    const outcome = await extractPedalMetadata('https://example.com/x', {
      fetchImpl: fetchReturning(htmlResponse(html)),
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.metadata.widthIn).toBeCloseTo(2.87, 5);
  });

  it('JSON-LD dimensions still win over text scrape when both present', async () => {
    const json = {
      '@type': 'Product',
      name: 'Some Pedal',
      brand: 'Acme',
      width: 3.5,
      depth: 6.0,
    };
    const html = `<!doctype html><html><body>
      <script type="application/ld+json">${JSON.stringify(json)}</script>
      <p>Width: 99 in</p>
      <p>Depth: 99 in</p>
    </body></html>`;
    const outcome = await extractPedalMetadata('https://example.com/x', {
      fetchImpl: fetchReturning(htmlResponse(html)),
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.metadata.widthIn).toBe(3.5);
    expect(outcome.metadata.depthIn).toBe(6.0);
  });
});

describe('extractPedalMetadata — OpenGraph fallback', () => {
  it('reads brand/name from meta tags when JSON-LD is absent', async () => {
    const html = wrap(`
      <meta property="og:title" content="MXR Phase 90" />
      <meta property="product:brand" content="MXR" />
    `);
    const outcome = await extractPedalMetadata('https://example.com/p90', {
      fetchImpl: fetchReturning(htmlResponse(html)),
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.metadata.brand).toBe('MXR');
    expect(outcome.metadata.name).toBe('MXR Phase 90');
    expect(outcome.metadata.widthIn).toBeNull();
    expect(outcome.metadata.depthIn).toBeNull();
  });

  it('does not surface dimensions from meta tags (medium confidence)', async () => {
    const html = wrap(`
      <meta property="og:title" content="Some Pedal" />
      <meta property="product:width" content="73mm" />
    `);
    const outcome = await extractPedalMetadata('https://example.com/p', {
      fetchImpl: fetchReturning(htmlResponse(html)),
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.metadata.widthIn).toBeNull();
    expect(outcome.metadata.depthIn).toBeNull();
  });
});

describe('extractPedalMetadata — title heuristic', () => {
  it('splits "Brand Model" titles when the brand is known', async () => {
    const html = wrap(`<title>Boss DS-1 Distortion Pedal | Reverb</title>`);
    const outcome = await extractPedalMetadata(
      'https://reverb.com/p/boss-ds1',
      {
        fetchImpl: fetchReturning(htmlResponse(html)),
      },
    );
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.metadata.brand).toBe('Boss');
    expect(outcome.metadata.name).toBe('DS-1');
  });

  it('matches multi-word brand names', async () => {
    const html = wrap(`<title>Chase Bliss Audio Mood MKII</title>`);
    const outcome = await extractPedalMetadata('https://example.com/mood', {
      fetchImpl: fetchReturning(htmlResponse(html)),
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.metadata.brand).toBe('Chase Bliss Audio');
    expect(outcome.metadata.name).toBe('Mood MKII');
  });

  it('leaves fields blank when no known brand appears in the title', async () => {
    const html = wrap(`<title>Some Random Boutique Pedal</title>`);
    const outcome = await extractPedalMetadata('https://example.com/x', {
      fetchImpl: fetchReturning(htmlResponse(html)),
    });
    // "boutique pedal" matches no known brand and there's no other signal.
    expect(outcome.kind).toBe('empty');
  });

  it('JSON-LD wins over title when both are present', async () => {
    const json = {
      '@type': 'Product',
      name: 'OD-3 Overdrive',
      brand: 'Boss',
    };
    const html = wrap(`
      <title>MXR Phase 90 | Sweetwater</title>
      <script type="application/ld+json">${JSON.stringify(json)}</script>
    `);
    const outcome = await extractPedalMetadata('https://example.com/x', {
      fetchImpl: fetchReturning(htmlResponse(html)),
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.metadata.brand).toBe('Boss');
    expect(outcome.metadata.name).toBe('OD-3 Overdrive');
  });
});

describe('extractPedalMetadata — failure modes', () => {
  it('returns page_unreachable on fetch failure', async () => {
    const outcome = await extractPedalMetadata('https://example.com/x', {
      fetchImpl: fetchThrowing(new TypeError('network')),
    });
    expect(outcome.kind).toBe('page_unreachable');
  });

  it('returns page_unreachable on non-OK response', async () => {
    const outcome = await extractPedalMetadata('https://example.com/x', {
      fetchImpl: fetchReturning(htmlResponse('not found', 404)),
    });
    expect(outcome.kind).toBe('page_unreachable');
  });

  it('returns empty when the page has no usable signals', async () => {
    const html = wrap(`<title>Just a homepage</title>`);
    const outcome = await extractPedalMetadata('https://example.com/', {
      fetchImpl: fetchReturning(htmlResponse(html)),
    });
    expect(outcome.kind).toBe('empty');
  });

  it('re-throws AbortError instead of swallowing it', async () => {
    const err = new DOMException('aborted', 'AbortError');
    await expect(
      extractPedalMetadata('https://example.com/x', {
        fetchImpl: vi.fn(() => Promise.reject(err)),
      }),
    ).rejects.toBe(err);
  });

  it('skips malformed JSON-LD blocks without crashing', async () => {
    const html = wrap(`
      <script type="application/ld+json">{ not valid json }</script>
      <meta property="og:title" content="Strymon Timeline" />
    `);
    const outcome = await extractPedalMetadata('https://example.com/x', {
      fetchImpl: fetchReturning(htmlResponse(html)),
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.metadata.name).toBe('Strymon Timeline');
  });
});

describe('findPedalDimensionsByQuery', () => {
  function webOk(...results: BraveWebResult[]): BraveWebOutcome {
    return { kind: 'ok', results };
  }

  function pageWith(
    metadata: Partial<ExtractedPedalMetadata>,
  ): ReturnType<typeof extractPedalMetadata> {
    const full: ExtractedPedalMetadata = {
      brand: null,
      name: null,
      widthIn: null,
      depthIn: null,
      ...metadata,
    };
    return Promise.resolve({ kind: 'ok' as const, metadata: full });
  }

  it('runs the web search with " dimensions" appended', async () => {
    const webSearchImpl = vi.fn(() => Promise.resolve(webOk()));
    await findPedalDimensionsByQuery('Boss DS-1', {
      webSearchImpl,
      extractImpl: vi.fn(),
    });
    expect(webSearchImpl).toHaveBeenCalledTimes(1);
    expect(webSearchImpl).toHaveBeenCalledWith(
      'Boss DS-1 dimensions',
      expect.any(Object),
    );
  });

  it('scrapes top hits and merges, first-source-wins per field', async () => {
    const webSearchImpl = vi.fn(() =>
      Promise.resolve(
        webOk(
          {
            title: 'Sweetwater',
            url: 'https://www.sweetwater.com/x',
            description: '',
            hostname: 'www.sweetwater.com',
          },
          {
            title: 'Thomann',
            url: 'https://thomann.de/y',
            description: '',
            hostname: 'thomann.de',
          },
        ),
      ),
    );
    const extractImpl = vi.fn((url: string) => {
      if (url.includes('sweetwater')) {
        return pageWith({ brand: 'Boss', widthIn: 2.87 });
      }
      if (url.includes('thomann')) {
        return pageWith({ brand: 'WRONG', name: 'DS-1', depthIn: 5.12 });
      }
      return Promise.resolve({ kind: 'empty' as const });
    });
    const result = await findPedalDimensionsByQuery('Boss DS-1', {
      webSearchImpl,
      extractImpl: extractImpl as unknown as typeof extractPedalMetadata,
    });
    expect(result).not.toBeNull();
    // Sweetwater (first) wins for brand + widthIn; Thomann fills name + depthIn.
    expect(result?.brand).toBe('Boss');
    expect(result?.name).toBe('DS-1');
    expect(result?.widthIn).toBe(2.87);
    expect(result?.depthIn).toBe(5.12);
  });

  it('filters out social/forum hostnames before scraping', async () => {
    const webSearchImpl = vi.fn(() =>
      Promise.resolve(
        webOk(
          {
            title: 'Reddit',
            url: 'https://www.reddit.com/r/guitarpedals/x',
            description: '',
            hostname: 'www.reddit.com',
          },
          {
            title: 'YouTube',
            url: 'https://youtube.com/watch?v=x',
            description: '',
            hostname: 'youtube.com',
          },
          {
            title: 'eBay',
            url: 'https://www.ebay.com/itm/x',
            description: '',
            hostname: 'www.ebay.com',
          },
          {
            // Reverb: blacklisted because per-listing pages mix accessory
            // dimensions (cables, cases) into the spec text and produce
            // false positives.
            title: 'Reverb',
            url: 'https://reverb.com/p/strymon-timeline',
            description: '',
            hostname: 'reverb.com',
          },
          {
            title: 'Manufacturer',
            url: 'https://strymon.net/timeline',
            description: '',
            hostname: 'strymon.net',
          },
        ),
      ),
    );
    const extractImpl = vi.fn(() => pageWith({ widthIn: 6.75 }));
    await findPedalDimensionsByQuery('Strymon Timeline', {
      webSearchImpl,
      extractImpl: extractImpl as unknown as typeof extractPedalMetadata,
    });
    // Only the manufacturer page should have been scraped.
    expect(extractImpl).toHaveBeenCalledTimes(1);
    expect(extractImpl).toHaveBeenCalledWith(
      'https://strymon.net/timeline',
      expect.any(Object),
    );
  });

  it('boosts spec hostnames to the front of the scrape order', async () => {
    const webSearchImpl = vi.fn(() =>
      Promise.resolve(
        webOk(
          {
            title: 'Random blog',
            url: 'https://example-blog.com/post',
            description: '',
            hostname: 'example-blog.com',
          },
          {
            title: 'Sweetwater',
            url: 'https://www.sweetwater.com/store/detail/x',
            description: '',
            hostname: 'www.sweetwater.com',
          },
          {
            title: 'Another blog',
            url: 'https://other-blog.org/p',
            description: '',
            hostname: 'other-blog.org',
          },
        ),
      ),
    );
    const extractImpl = vi.fn((url: string) =>
      url.includes('sweetwater')
        ? pageWith({ brand: 'Boss', widthIn: 2.87 })
        : pageWith({}),
    );
    const result = await findPedalDimensionsByQuery('Boss DS-1', {
      webSearchImpl,
      extractImpl: extractImpl as unknown as typeof extractPedalMetadata,
    });
    // Sweetwater should have been scraped FIRST despite being result #2 in
    // the SERP, because spec hostnames are boosted ahead of unknowns.
    expect(extractImpl).toHaveBeenNthCalledWith(
      1,
      'https://www.sweetwater.com/store/detail/x',
      expect.any(Object),
    );
    expect(result?.brand).toBe('Boss');
    expect(result?.widthIn).toBe(2.87);
  });

  it('respects maxPages cap', async () => {
    const results = Array.from({ length: 10 }, (_, i) => ({
      title: `R${i}`,
      url: `https://other-blog-${i}.com/p`,
      description: '',
      hostname: `other-blog-${i}.com`,
    }));
    const webSearchImpl = vi.fn(() => Promise.resolve(webOk(...results)));
    const extractImpl = vi.fn(() => pageWith({}));
    await findPedalDimensionsByQuery('q', {
      webSearchImpl,
      extractImpl: extractImpl as unknown as typeof extractPedalMetadata,
      maxPages: 3,
    });
    expect(extractImpl).toHaveBeenCalledTimes(3);
  });

  it('returns null when the web search itself fails', async () => {
    const webSearchImpl = vi.fn(() =>
      Promise.resolve({ kind: 'rate_limited' as const }),
    );
    const result = await findPedalDimensionsByQuery('q', {
      webSearchImpl,
      extractImpl: vi.fn(),
    });
    expect(result).toBeNull();
  });

  it('returns null when every scraped page yielded no signals', async () => {
    const webSearchImpl = vi.fn(() =>
      Promise.resolve(
        webOk({
          title: 'Empty',
          url: 'https://example-blog.com/empty',
          description: '',
          hostname: 'example-blog.com',
        }),
      ),
    );
    const extractImpl = vi.fn(() =>
      Promise.resolve({ kind: 'empty' as const }),
    );
    const result = await findPedalDimensionsByQuery('q', {
      webSearchImpl,
      extractImpl: extractImpl as unknown as typeof extractPedalMetadata,
    });
    expect(result).toBeNull();
  });

  it('prefers a result with BOTH dimensions over a partial earlier result (Wampler Mini Ego 76 regression)', async () => {
    // Repro of a real failure: searching "Wampler Mini Ego 76 dimensions"
    // produced one page that incidentally matched a labeled spec scrape
    // and returned widthIn=1 (likely from an unrelated "1 in/out" or
    // accessory spec) with no depth. A separate page had both correct
    // values. The complete result should win wholesale — we must NOT
    // ship widthIn=1 just because that source happened to come first.
    const webSearchImpl = vi.fn(() =>
      Promise.resolve(
        webOk(
          {
            title: 'Spec-host with bad partial data',
            url: 'https://www.sweetwater.com/wampler-mini-ego-76',
            description: '',
            hostname: 'www.sweetwater.com',
          },
          {
            title: 'Manufacturer with complete data',
            url: 'https://wamplerpedals.com/mini-ego-76',
            description: '',
            hostname: 'wamplerpedals.com',
          },
        ),
      ),
    );
    const extractImpl = vi.fn((url: string) => {
      if (url.includes('sweetwater')) {
        // The bug shape: brand/name extract fine, but the dimension
        // regex grabbed an incidental "1 in" and left depth null.
        return pageWith({
          brand: 'Wampler',
          name: 'Mini Ego 76',
          widthIn: 1,
          depthIn: null,
        });
      }
      if (url.includes('wamplerpedals')) {
        return pageWith({
          brand: 'Wampler',
          name: 'Mini Ego 76 Compressor',
          widthIn: 1.75,
          depthIn: 3.7,
        });
      }
      return Promise.resolve({ kind: 'empty' as const });
    });
    const result = await findPedalDimensionsByQuery(
      'Wampler Mini Ego 76 Compressor Pedal',
      {
        webSearchImpl,
        extractImpl: extractImpl as unknown as typeof extractPedalMetadata,
      },
    );
    expect(result).not.toBeNull();
    // Dimensions came wholesale from the complete result.
    expect(result?.widthIn).toBe(1.75);
    expect(result?.depthIn).toBe(3.7);
    // Brand/name still inherit from the first source per the existing rule.
    expect(result?.brand).toBe('Wampler');
    expect(result?.name).toBe('Mini Ego 76');
  });

  it('falls back to per-field merge when no single result has both dimensions', async () => {
    // The existing "first-source-wins per field" path still applies when
    // no result was complete on its own. Split-source merge stays useful
    // for partially-spec'd retailer / manufacturer pages.
    const webSearchImpl = vi.fn(() =>
      Promise.resolve(
        webOk(
          {
            title: 'Width only',
            url: 'https://www.sweetwater.com/x',
            description: '',
            hostname: 'www.sweetwater.com',
          },
          {
            title: 'Depth only',
            url: 'https://thomann.de/y',
            description: '',
            hostname: 'thomann.de',
          },
        ),
      ),
    );
    const extractImpl = vi.fn((url: string) =>
      url.includes('sweetwater')
        ? pageWith({ widthIn: 2.87 })
        : pageWith({ depthIn: 5.12 }),
    );
    const result = await findPedalDimensionsByQuery('q', {
      webSearchImpl,
      extractImpl: extractImpl as unknown as typeof extractPedalMetadata,
    });
    expect(result?.widthIn).toBe(2.87);
    expect(result?.depthIn).toBe(5.12);
  });

  it('survives individual extraction failures and uses the rest', async () => {
    const webSearchImpl = vi.fn(() =>
      Promise.resolve(
        webOk(
          {
            title: 'Bad page',
            url: 'https://bad.example.com/x',
            description: '',
            hostname: 'bad.example.com',
          },
          {
            title: 'Good page',
            url: 'https://good.example.com/x',
            description: '',
            hostname: 'good.example.com',
          },
        ),
      ),
    );
    const extractImpl = vi.fn((url: string) => {
      if (url.includes('bad')) return Promise.reject(new Error('boom'));
      return pageWith({ widthIn: 2.87 });
    });
    const result = await findPedalDimensionsByQuery('q', {
      webSearchImpl,
      extractImpl: extractImpl as unknown as typeof extractPedalMetadata,
    });
    expect(result?.widthIn).toBe(2.87);
  });

  it('returns null for empty / whitespace queries without calling the API', async () => {
    const webSearchImpl = vi.fn();
    const result = await findPedalDimensionsByQuery('   ', {
      webSearchImpl,
      extractImpl: vi.fn(),
    });
    expect(result).toBeNull();
    expect(webSearchImpl).not.toHaveBeenCalled();
  });
});
