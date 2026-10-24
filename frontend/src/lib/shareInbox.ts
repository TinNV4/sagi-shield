// Content handed over by the OS share sheet (public/share-sw.js parks it in Cache Storage). Treated like pasted text
// or an uploaded image: never fetched, never sent anywhere except to the check the person starts.

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGES = 5;

const CACHE_NAME = 'sagi-share';
const INDEX_KEY = '/share-inbox';

export interface SharedInput {
  title: string;
  text: string;
  url: string;
  files: {name: string; type: string; blob: Blob}[];
  /** Files the index lists but the cache no longer holds. */
  missing: number;
}

export interface RejectedShare {
  name: string;
  reason: 'size' | 'type' | 'count' | 'missing';
}

export interface ShareCheckInput {
  text: string;
  images: File[];
  rejected: RejectedShare[];
}

/** Reads the shared content once and always clears it. Null when there is no (readable) index or Cache Storage is
 *  unavailable. Files the index lists but the cache lost are counted in `missing`, never skipped silently. */
export async function readShareInbox(): Promise<SharedInput | null> {
  if (typeof caches === 'undefined') return null;
  let cache: Cache;
  try {
    cache = await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
  try {
    const indexResponse = await cache.match(INDEX_KEY);
    if (!indexResponse) return null;
    const index = (await indexResponse.json()) as {title?: string; text?: string; url?: string; files?: {name: string; type: string}[]};
    const metas = Array.isArray(index.files) ? index.files : [];
    const files: SharedInput['files'] = [];
    let missing = 0;
    for (let i = 0; i < metas.length; i++) {
      const response = await cache.match(`${INDEX_KEY}/${i}`);
      if (!response) {
        missing++;
        continue;
      }
      files.push({name: metas[i].name, type: metas[i].type, blob: await response.blob()});
    }
    return {title: index.title ?? '', text: index.text ?? '', url: index.url ?? '', files, missing};
  } catch {
    return null;
  } finally {
    try {
      for (const key of await cache.keys()) await cache.delete(key);
    } catch {
      // nothing more to do; the next share clears the cache first
    }
  }
}

export function toCheckInput(shared: SharedInput): ShareCheckInput {
  const images: File[] = [];
  const rejected: RejectedShare[] = [];
  for (const f of shared.files) {
    if (!f.type.startsWith('image/')) rejected.push({name: f.name, reason: 'type'});
    else if (f.blob.size > MAX_IMAGE_BYTES) rejected.push({name: f.name, reason: 'size'});
    else if (images.length >= MAX_IMAGES) rejected.push({name: f.name, reason: 'count'});
    else images.push(new File([f.blob], f.name, {type: f.type}));
  }
  for (let i = 0; i < shared.missing; i++) rejected.push({name: '', reason: 'missing'});
  return {text: [shared.title, shared.text, shared.url].filter(Boolean).join('\n'), images, rejected};
}
