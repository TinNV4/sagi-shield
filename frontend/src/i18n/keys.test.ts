import {describe, expect, it} from 'vitest';
import en from './en.json';
import ja from './ja.json';
import vi from './vi.json';

// A key missing from one dictionary renders as its path ("api.offline") on the screen. The three files must carry
// exactly the same keys, and every value must be a non-empty string.
const flatten = (node: unknown, prefix = ''): string[] =>
  node && typeof node === 'object'
    ? Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k))
    : [prefix];

const lookup = (node: any, path: string) => path.split('.').reduce((cur, k) => cur?.[k], node);

describe('UI dictionaries', () => {
  const enKeys = flatten(en).sort();

  it.each([
    ['ja', ja],
    ['vi', vi],
  ])('%s has exactly the keys of en', (_name, dict) => {
    const keys = flatten(dict).sort();
    expect(keys.filter((k) => !enKeys.includes(k))).toEqual([]);
    expect(enKeys.filter((k) => !keys.includes(k))).toEqual([]);
  });

  it.each([
    ['en', en],
    ['ja', ja],
    ['vi', vi],
  ])('%s has no empty strings', (_name, dict) => {
    const empty = flatten(dict).filter((k) => typeof lookup(dict, k) !== 'string' || lookup(dict, k).trim() === '');
    expect(empty).toEqual([]);
  });

  it('never promises certainty', () => {
    // Constraint: the app never claims something "is 100% safe" (ja / vi forms included). A disclaimer that says
    // low risk does NOT mean 100% safety is the opposite claim and stays allowed.
    const claim = /\b(is|are|be|was)\s+100\s*%\s+(safe|secure)\b|100\s*%\s*安全です|là an toàn 100\s*%/i;
    const all = [en, ja, vi].flatMap((d) => flatten(d).map((k) => String(lookup(d, k))));
    expect(all.filter((s) => claim.test(s))).toEqual([]);
  });
});
