import {afterEach, describe, expect, it, vi} from 'vitest';
import {MAX_IMAGE_BYTES, readShareInbox, toCheckInput, type SharedInput} from './shareInbox';

const blob = (type: string, size = 10) => new Blob([new Uint8Array(size)], {type});

describe('toCheckInput', () => {
  it('joins title, text and url, skipping empty parts', () => {
    const out = toCheckInput({title: 'T', text: '', url: 'https://x.test', files: [], missing: 0});
    expect(out.text).toBe('T\nhttps://x.test');
    expect(out.images).toEqual([]);
    expect(out.rejected).toEqual([]);
  });

  it('keeps at most 5 images', () => {
    const files = Array.from({length: 7}, (_, i) => ({name: `${i}.png`, type: 'image/png', blob: blob('image/png')}));
    const out = toCheckInput({title: '', text: '', url: '', files, missing: 0});
    expect(out.images).toHaveLength(5);
    expect(out.images[0].name).toBe('0.png');
    expect(out.rejected).toEqual([
      {name: '5.png', reason: 'count'},
      {name: '6.png', reason: 'count'},
    ]);
  });

  it('reports files that were listed but missing from the inbox', () => {
    const out = toCheckInput({title: '', text: 'x', url: '', files: [], missing: 2});
    expect(out.rejected.map((r) => r.reason)).toEqual(['missing', 'missing']);
  });

  it('rejects a 9 MB image by size and a PDF by type, with reasons', () => {
    const shared: SharedInput = {
      title: '',
      text: '',
      url: '',
      missing: 0,
      files: [
        {name: 'big.png', type: 'image/png', blob: blob('image/png', 9 * 1024 * 1024)},
        {name: 'doc.pdf', type: 'application/pdf', blob: blob('application/pdf')},
        {name: 'ok.jpg', type: 'image/jpeg', blob: blob('image/jpeg')},
      ],
    };
    expect(9 * 1024 * 1024).toBeGreaterThan(MAX_IMAGE_BYTES);
    const out = toCheckInput(shared);
    expect(out.images.map((f) => f.name)).toEqual(['ok.jpg']);
    expect(out.rejected).toEqual([
      {name: 'big.png', reason: 'size'},
      {name: 'doc.pdf', reason: 'type'},
    ]);
  });
});

describe('readShareInbox', () => {
  afterEach(() => vi.unstubAllGlobals());

  const fakeCaches = (entries: Map<string, Response>) => ({
    open: async () => ({
      match: async (k: string) => entries.get(k)?.clone(),
      delete: async (k: string | {url: string}) => entries.delete(typeof k === 'string' ? k : k.url),
      keys: async () => [...entries.keys()].map((u) => ({url: u})),
    }),
  });

  it('returns null when nothing was shared', async () => {
    vi.stubGlobal('caches', fakeCaches(new Map()));
    expect(await readShareInbox()).toBeNull();
  });

  it('rebuilds the shared files and clears the entries', async () => {
    const entries = new Map<string, Response>([
      ['/share-inbox', new Response(JSON.stringify({title: 'T', text: 'hi', url: '', files: [{name: 'a.png', type: 'image/png'}]}))],
      ['/share-inbox/0', new Response(new Uint8Array(4), {headers: {'Content-Type': 'image/png'}})],
    ]);
    vi.stubGlobal('caches', fakeCaches(entries));
    const shared = await readShareInbox();
    expect(shared?.text).toBe('hi');
    expect(shared?.files[0].name).toBe('a.png');
    expect(shared?.files[0].blob.size).toBe(4);
    expect(entries.size).toBe(0);
  });

  it('returns null for a malformed index and clears the inbox', async () => {
    const entries = new Map<string, Response>([['/share-inbox', new Response('not json')], ['/share-inbox/0', new Response('x')]]);
    vi.stubGlobal('caches', fakeCaches(entries));
    expect(await readShareInbox()).toBeNull();
    expect(entries.size).toBe(0);
  });

  it('reports a file entry missing from the cache and returns the others', async () => {
    const entries = new Map<string, Response>([
      ['/share-inbox', new Response(JSON.stringify({title: '', text: '', url: '', files: [{name: 'a.png', type: 'image/png'}, {name: 'b.png', type: 'image/png'}]}))],
      ['/share-inbox/1', new Response(new Uint8Array(3))],
    ]);
    vi.stubGlobal('caches', fakeCaches(entries));
    const shared = await readShareInbox();
    expect(shared?.files.map((f) => f.name)).toEqual(['b.png']);
    expect(shared?.missing).toBe(1);
    expect(entries.size).toBe(0);
  });

  it('clears the inbox even when reading a file throws', async () => {
    const bad = new Response(new Uint8Array(3));
    bad.blob = () => Promise.reject(new Error('boom'));
    const entries = new Map<string, Response>([
      ['/share-inbox', new Response(JSON.stringify({files: [{name: 'a.png', type: 'image/png'}]}))],
      ['/share-inbox/0', bad],
    ]);
    const cache = {
      match: async (k: string) => entries.get(k),
      delete: async (k: string | {url: string}) => entries.delete(typeof k === 'string' ? k : k.url),
      keys: async () => [...entries.keys()].map((u) => ({url: u})),
    };
    vi.stubGlobal('caches', {open: async () => cache});
    expect(await readShareInbox()).toBeNull();
    expect(entries.size).toBe(0);
  });
});
