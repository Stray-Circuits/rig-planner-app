import { describe, expect, it, vi } from 'vitest';
import {
  fetchImageAsBlob,
  searchPedalImages,
  type BraveSearchOutcome,
} from '../src/lib/braveSearch';

const FIXTURE_KEY = 'test-key';

/**
 * Minimal Brave-shape JSON for one valid + one row-with-missing-fields. The
 * second row exercises the "drop incomplete rows rather than render junk"
 * behavior in `parseResult`.
 */
const VALID_RESPONSE = {
  type: 'images',
  results: [
    {
      type: 'image_result',
      title: 'Boss DS-1 on Reverb',
      url: 'https://reverb.com/p/boss-ds-1',
      thumbnail: {
        src: 'https://imgs.search.brave.com/abc/thumb.jpg',
        original: 'https://imgs.search.brave.com/abc/orig.jpg',
      },
      properties: {
        url: 'https://reverb.com/images/ds1-full.jpg',
      },
      width: 1200,
      height: 900,
    },
    {
      type: 'image_result',
      // No properties.url — should be dropped.
      title: 'orphan row',
      url: 'https://example.com/page',
      thumbnail: { src: 'https://example.com/thumb.jpg' },
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Resolve-once fetch mock that returns the given Response. */
function fetchReturning(response: Response): typeof fetch {
  return vi.fn(() => Promise.resolve(response));
}

function fetchThrowing(err: Error): typeof fetch {
  return vi.fn(() => Promise.reject(err));
}

/** Extract the URL string + RequestInit from the first fetch call. */
function firstCall(impl: typeof fetch): { url: string; init: RequestInit } {
  const calls = vi.mocked(impl).mock.calls;
  const call = calls[0];
  if (!call) throw new Error('expected fetch to be called');
  const [input, init] = call;
  if (typeof input !== 'string') {
    throw new Error('expected first arg to fetch to be a string URL');
  }
  if (!init) throw new Error('expected init object');
  return { url: input, init };
}

describe('searchPedalImages', () => {
  it('parses a successful response and drops incomplete rows', async () => {
    const fetchImpl = fetchReturning(jsonResponse(VALID_RESPONSE));
    const outcome = await searchPedalImages('Boss DS-1', {
      apiKey: FIXTURE_KEY,
      fetchImpl,
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('unreachable');
    expect(outcome.results).toHaveLength(1);
    const [result] = outcome.results;
    expect(result?.imageUrl).toBe('https://reverb.com/images/ds1-full.jpg');
    expect(result?.thumbnailUrl).toBe(
      'https://imgs.search.brave.com/abc/thumb.jpg',
    );
    expect(result?.sourceUrl).toBe('https://reverb.com/p/boss-ds-1');
    expect(result?.title).toBe('Boss DS-1 on Reverb');
    expect(result?.width).toBe(1200);
    expect(result?.height).toBe(900);
  });

  it('sends the API key in the X-Subscription-Token header', async () => {
    const fetchImpl = fetchReturning(jsonResponse({ results: [] }));
    await searchPedalImages('foo', { apiKey: FIXTURE_KEY, fetchImpl });
    const { init } = firstCall(fetchImpl);
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Subscription-Token']).toBe(FIXTURE_KEY);
    expect(headers.Accept).toBe('application/json');
  });

  it('URL-encodes the query', async () => {
    const fetchImpl = fetchReturning(jsonResponse({ results: [] }));
    await searchPedalImages('Big Muff π', { apiKey: FIXTURE_KEY, fetchImpl });
    const { url } = firstCall(fetchImpl);
    expect(url).toContain('q=Big%20Muff%20%CF%80');
  });

  it('returns disabled when no API key is configured', async () => {
    const fetchImpl = fetchReturning(jsonResponse({ results: [] }));
    // We explicitly want to test "no apiKey supplied AND no env var set."
    // The test runner doesn't bake the key in, so omitting it falls through
    // to readBraveApiKey() returning undefined.
    const outcome = await searchPedalImages('foo', { fetchImpl });
    expect(outcome).toEqual({ kind: 'disabled' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns empty_query without hitting the API for blank input', async () => {
    const fetchImpl = fetchReturning(jsonResponse({ results: [] }));
    const outcome = await searchPedalImages('   ', {
      apiKey: FIXTURE_KEY,
      fetchImpl,
    });
    expect(outcome).toEqual({ kind: 'empty_query' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps 429 to rate_limited', async () => {
    const fetchImpl = fetchReturning(
      new Response('rate limit', { status: 429 }),
    );
    const outcome = await searchPedalImages('foo', {
      apiKey: FIXTURE_KEY,
      fetchImpl,
    });
    expect(outcome).toEqual({ kind: 'rate_limited' });
  });

  it('maps 401 and 403 to unauthorized', async () => {
    for (const status of [401, 403]) {
      const fetchImpl = fetchReturning(new Response('forbidden', { status }));
      const outcome = await searchPedalImages('foo', {
        apiKey: FIXTURE_KEY,
        fetchImpl,
      });
      expect(outcome).toEqual({ kind: 'unauthorized' });
    }
  });

  it('maps other 5xx to server_error with status', async () => {
    const fetchImpl = fetchReturning(new Response('boom', { status: 503 }));
    const outcome = await searchPedalImages('foo', {
      apiKey: FIXTURE_KEY,
      fetchImpl,
    });
    expect(outcome.kind).toBe('server_error');
    if (outcome.kind === 'server_error') {
      expect(outcome.status).toBe(503);
    }
  });

  it('maps thrown fetch (e.g. CORS / offline) to network_error', async () => {
    const fetchImpl = fetchThrowing(new TypeError('Failed to fetch'));
    const outcome = await searchPedalImages('foo', {
      apiKey: FIXTURE_KEY,
      fetchImpl,
    });
    expect(outcome.kind).toBe('network_error');
    if (outcome.kind === 'network_error') {
      expect(outcome.message).toBe('Failed to fetch');
    }
  });

  it('re-throws AbortError so callers can distinguish cancel from failure', async () => {
    const fetchImpl = fetchThrowing(new DOMException('Aborted', 'AbortError'));
    await expect(
      searchPedalImages('foo', { apiKey: FIXTURE_KEY, fetchImpl }),
    ).rejects.toThrow('Aborted');
  });

  it('returns ok with an empty list when Brave returns no results', async () => {
    const fetchImpl = fetchReturning(jsonResponse({ results: [] }));
    const outcome = await searchPedalImages('xyzqqq', {
      apiKey: FIXTURE_KEY,
      fetchImpl,
    });
    expect(outcome).toEqual<BraveSearchOutcome>({ kind: 'ok', results: [] });
  });

  it('treats malformed JSON as server_error', async () => {
    const fetchImpl = fetchReturning(
      new Response('not json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const outcome = await searchPedalImages('foo', {
      apiKey: FIXTURE_KEY,
      fetchImpl,
    });
    expect(outcome.kind).toBe('server_error');
  });

  it('honors the count option in the URL', async () => {
    const fetchImpl = fetchReturning(jsonResponse({ results: [] }));
    await searchPedalImages('foo', {
      apiKey: FIXTURE_KEY,
      fetchImpl,
      count: 5,
    });
    const { url } = firstCall(fetchImpl);
    expect(url).toContain('count=5');
  });
});

describe('fetchImageAsBlob', () => {
  it('returns the blob on success', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchImpl = fetchReturning(
      new Response(bytes, {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      }),
    );
    const result = await fetchImageAsBlob('https://example.com/x.jpg', {
      fetchImpl,
    });
    expect(result).not.toBeNull();
    expect(result?.size).toBe(3);
  });

  it('returns null on non-2xx status', async () => {
    const fetchImpl = fetchReturning(new Response('nope', { status: 404 }));
    const result = await fetchImageAsBlob('https://example.com/x.jpg', {
      fetchImpl,
    });
    expect(result).toBeNull();
  });

  it('returns null when fetch throws (CORS, offline)', async () => {
    const fetchImpl = fetchThrowing(new TypeError('Failed to fetch'));
    const result = await fetchImageAsBlob('https://example.com/x.jpg', {
      fetchImpl,
    });
    expect(result).toBeNull();
  });

  it('returns null for empty-body responses', async () => {
    const fetchImpl = fetchReturning(
      new Response(new Uint8Array(), { status: 200 }),
    );
    const result = await fetchImageAsBlob('https://example.com/x.jpg', {
      fetchImpl,
    });
    expect(result).toBeNull();
  });

  it('re-throws AbortError', async () => {
    const fetchImpl = fetchThrowing(new DOMException('Aborted', 'AbortError'));
    await expect(
      fetchImageAsBlob('https://example.com/x.jpg', { fetchImpl }),
    ).rejects.toThrow('Aborted');
  });
});
