import {describe, expect, it} from 'vitest';
import retention from './retention.json';
import {PRIVACY} from './privacy';

const LANGS = ['ja', 'vi', 'en'] as const;
const flat = (l: (typeof LANGS)[number]) =>
  PRIVACY[l].sections.flatMap((s) => [s.title, ...s.paragraphs]).join('\n');

describe('privacy notice content', () => {
  it('has the same sections in every language', () => {
    const n = PRIVACY.en.sections.length;
    expect(n).toBe(7);
    for (const l of LANGS) {
      expect(PRIVACY[l].sections.length).toBe(n);
      expect(PRIVACY[l].updated).toMatch(/\d{4}/);
      PRIVACY[l].sections.forEach((s, i) => {
        expect(s.title.length).toBeGreaterThan(0);
        expect(s.paragraphs.length).toBeGreaterThan(0);
      });
    }
  });

  it('resolves every placeholder and uses the retention figures', () => {
    for (const l of LANGS) {
      const text = flat(l);
      expect(text).not.toMatch(/\{[a-z_]+\}/);
      for (const days of Object.values(retention)) expect(text).toContain(String(days));
    }
  });

  it('writes Vietnamese with diacritics', () => {
    expect(flat('vi')).toMatch(/[ắấếốơư]/);
  });

  it('never says 100% in any language', () => {
    for (const l of LANGS) expect(flat(l)).not.toContain('100');
  });

  it('lists the hotlines of each market', () => {
    expect(flat('ja')).toContain('#9110');
    expect(flat('ja')).toContain('188');
    expect(flat('vi')).toContain('113');
    const en = flat('en');
    expect(en).toContain('#9110');
    expect(en).toContain('188');
    expect(en).toContain('113');
    expect(en).toMatch(/Japan/);
    expect(en).toMatch(/Vietnam/);
  });
});
