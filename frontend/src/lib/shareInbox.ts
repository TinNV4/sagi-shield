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
}

export interface RejectedShare {
  name: string;
  reason: 'size' | 'type';
}

export interface ShareCheckInput {
  text: string;
  images: File[];
  rejected: RejectedShare[];
}

/** Reads the shared content once and clears it. Null when nothing was shared (or Cache Storage is unavailable). */
export async function readShareInbox(): Promise<SharedInput | null> {
  try {
    if (typeof caches === 'undefined') return null;
    const cache = await caches.open(CACHE_NAME);
    const indexResponse = await cache.match(INDEX_KEY);
    if (!indexResponse) return null;
    const index = (await indexResponse.json()) as {title?: string; text?: string; url?: string; files?: {name: string; type: string}[]};
    const files: SharedInput['files'] = [];
    for (let i = 0; i < (index.files?.length ?? 0); i++) {
      const response = await cache.match(`${INDEX_KEY}/${i}`);
      if (!response) continue;
      const meta = index.files![i];
      files.push({name: meta.name, type: meta.type, blob: await response.blob()});
    }
    for (const key of await cache.keys()) await cache.delete(key);
    return {title: index.title ?? '', text: index.text ?? '', url: index.url ?? '', files};
  } catch {
    return null;
  }
}

export function toCheckInput(shared: SharedInput): ShareCheckInput {
  const images: File[] = [];
  const rejected: RejectedShare[] = [];
  for (const f of shared.files) {
    if (!f.type.startsWith('image/')) rejected.push({name: f.name, reason: 'type'});
    else if (f.blob.size > MAX_IMAGE_BYTES) rejected.push({name: f.name, reason: 'size'});
    else if (images.length < MAX_IMAGES) images.push(new File([f.blob], f.name, {type: f.type}));
  }
  return {text: [shared.title, shared.text, shared.url].filter(Boolean).join('\n'), images, rejected};
}
