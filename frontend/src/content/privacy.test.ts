import {describe, expect, it} from 'vitest';
import retention from './retention.json';
import {PRIVACY} from './privacy';

const LANGS = ['ja', 'vi', 'en'] as const;
const flat = (l: (typeof LANGS)[number]) =>
  PRIVACY[l].sections.flatMap((s) => [s.title, ...s.paragraphs]).join('\n');
const KEPT = 2; // "What is kept"

describe('privacy notice content', () => {
  it('has the same sections and paragraph counts in every language', () => {
    expect(PRIVACY.en.sections.length).toBe(7);
    for (const l of LANGS) {
      expect(PRIVACY[l].sections.length).toBe(7);
      expect(PRIVACY[l].updated).toMatch(/\d{4}/);
      expect(PRIVACY[l].sections.map((s) => s.paragraphs.length)).toEqual(
        PRIVACY.en.sections.map((s) => s.paragraphs.length),
      );
      PRIVACY[l].sections.forEach((s) => expect(s.title.length).toBeGreaterThan(0));
    }
  });

  it('resolves every placeholder', () => {
    for (const l of LANGS) expect(flat(l)).not.toMatch(/\{+[a-z_]+\}+/);
  });

  it('puts each retention figure in its own sentence', () => {
    for (const l of LANGS) {
      const kept = PRIVACY[l].sections[KEPT].paragraphs;
      expect(kept[0]).toContain(String(retention.alert_days)); // alerts
      expect(kept[1]).toContain(String(retention.feedback_days)); // feedback answers
      expect(kept[4]).toContain(String(retention.verdict_days)); // technical log
      expect(kept[3]).toContain('24'); // recovery chat
      expect(kept[2]).not.toMatch(/\d/); // community reports: no invented period
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
