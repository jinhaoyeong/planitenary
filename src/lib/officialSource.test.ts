/**
 * Tests for reading a place's own website, imported straight from the Deno
 * `_shared` module — the same precedent as `cacheKeys.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  closureNotices,
  extractJsonLd,
  isSafePublicUrl,
  openingRulesFromJsonLd,
  visibleText,
} from '../../supabase/functions/_shared/officialSource';
import { parseOsmOpeningRules } from '../../supabase/functions/_shared/osmPlaces';

const rules = (nodes: Array<Record<string, unknown>>) => openingRulesFromJsonLd(nodes, parseOsmOpeningRules);

describe('refusing to fetch somewhere it should not', () => {
  // These addresses arrive from community-edited map tags, so this is an SSRF
  // guard, not input validation for convenience.
  it('accepts an ordinary venue site', () => {
    expect(isSafePublicUrl('https://www.osakacastle.net/')).toBe(true);
  });

  it('refuses the cloud metadata endpoint', () => {
    expect(isSafePublicUrl('https://169.254.169.254/latest/meta-data/')).toBe(false);
  });

  it('refuses private and loopback addresses', () => {
    for (const host of ['10.0.0.5', '127.0.0.1', '192.168.1.1', '172.16.0.9', '0.0.0.0']) {
      expect(isSafePublicUrl(`https://${host}/`)).toBe(false);
    }
  });

  it('allows a public address that merely looks similar', () => {
    expect(isSafePublicUrl('https://172.32.0.1/')).toBe(true);
    expect(isSafePublicUrl('https://11.0.0.1/')).toBe(true);
  });

  it('refuses internal-only hostnames', () => {
    expect(isSafePublicUrl('https://localhost/')).toBe(false);
    expect(isSafePublicUrl('https://db.internal/')).toBe(false);
    expect(isSafePublicUrl('https://printer.local/')).toBe(false);
  });

  it('refuses plain HTTP, embedded credentials and odd ports', () => {
    expect(isSafePublicUrl('http://example.com/')).toBe(false);
    expect(isSafePublicUrl('https://user:pass@example.com/')).toBe(false);
    expect(isSafePublicUrl('https://example.com:8080/')).toBe(false);
  });

  it('refuses nonsense rather than throwing', () => {
    expect(isSafePublicUrl('not a url')).toBe(false);
    expect(isSafePublicUrl('')).toBe(false);
    expect(isSafePublicUrl(undefined)).toBe(false);
  });
});

describe('reading structured opening hours', () => {
  const page = (body: string) => `<html><head><script type="application/ld+json">${body}</script></head><body></body></html>`;

  it('reads an openingHoursSpecification', () => {
    const nodes = extractJsonLd(page(JSON.stringify({
      '@type': 'Museum',
      openingHoursSpecification: [
        { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Tuesday', 'Wednesday'], opens: '10:00', closes: '18:00' },
      ],
    })));
    expect(rules(nodes)).toEqual([{ daysOfWeek: [2, 3], opensAt: '10:00', closesAt: '18:00' }]);
  });

  it('accepts schema.org URLs as day names', () => {
    const nodes = extractJsonLd(page(JSON.stringify({
      openingHoursSpecification: { dayOfWeek: 'https://schema.org/Monday', opens: '09:00', closes: '17:00' },
    })));
    expect(rules(nodes)[0].daysOfWeek).toEqual([1]);
  });

  it('reads the text form by reusing the OSM parser', () => {
    const nodes = extractJsonLd(page(JSON.stringify({ openingHours: 'Tu-Su 10:00-18:00' })));
    // The same weekday closure the OSM path handles, from a different source.
    expect(rules(nodes)[0].daysOfWeek).not.toContain(1);
  });

  it('trims seconds off a time', () => {
    const nodes = extractJsonLd(page(JSON.stringify({
      openingHoursSpecification: { dayOfWeek: 'Friday', opens: '09:00:00', closes: '17:30:00' },
    })));
    expect(rules(nodes)[0]).toMatchObject({ opensAt: '09:00', closesAt: '17:30' });
  });

  it('walks a @graph, which is how many sites nest it', () => {
    const nodes = extractJsonLd(page(JSON.stringify({
      '@graph': [{ '@type': 'Restaurant', openingHours: 'Mo-Fr 09:00-17:00' }],
    })));
    expect(rules(nodes)).toHaveLength(1);
  });

  it('survives a malformed block without losing a valid one', () => {
    const html = `${page('{ not json')}${page(JSON.stringify({ openingHours: '09:00-17:00' }))}`;
    expect(rules(extractJsonLd(html))).toHaveLength(1);
  });

  it('reports nothing for a page with no structured data', () => {
    expect(extractJsonLd('<html><body>Open daily!</body></html>')).toEqual([]);
    expect(rules([])).toEqual([]);
  });
});

describe('reading visible text', () => {
  it('drops scripts and styles before tags', () => {
    // Otherwise a word inside an analytics snippet could read as a claim.
    const text = visibleText('<style>.a{color:red}</style><script>var closed="permanently closed"</script><p>Welcome</p>');
    expect(text).toBe('Welcome');
  });

  it('decodes the entities that appear in prose', () => {
    expect(visibleText('<p>Tea&nbsp;&amp; cake &quot;here&quot;</p>')).toBe('Tea & cake "here"');
  });
});

describe('closure notices', () => {
  it('reads a permanent closure, which only an official page may assert', () => {
    const notices = closureNotices('This venue is permanently closed. Thank you for 40 years.');
    expect(notices[0]).toMatchObject({ type: 'closed' });
    expect(notices[0].excerpt).toContain('permanently closed');
  });

  it('reads a closure for works as renovation, not a shutdown', () => {
    expect(closureNotices('The hall is closed for renovation until spring.')[0].type).toBe('renovation');
  });

  it('does not mistake normal weekly hours for a shutdown', () => {
    // "Closed Mondays" is an opening pattern. Reading it as a closure would
    // delete a working venue from every plan.
    expect(closureNotices('Open 10:00-18:00. Closed Mondays.')).toEqual([]);
    expect(closureNotices('We are temporarily closed on Sundays')).toEqual([]);
  });

  it('says nothing about an ordinary page', () => {
    expect(closureNotices('Welcome! Book tickets online for the summer exhibition.')).toEqual([]);
    expect(closureNotices('')).toEqual([]);
  });
});
