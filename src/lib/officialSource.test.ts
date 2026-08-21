/**
 * Tests for reading a place's own website, imported straight from the Deno
 * `_shared` module — the same precedent as `cacheKeys.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  admissionFromJsonLd,
  admissionFromVisibleText,
  closureNotices,
  extractJsonLd,
  isLikelyResellerUrl,
  isSafePublicUrl,
  officialAdmissionClaims,
  officialTicketLinks,
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

describe('reading structured admission offers', () => {
  const page = (body: string) => `<script type="application/ld+json">${body}</script>`;

  it('reads an explicit adult fare and keeps a verbatim JSON-LD excerpt', () => {
    const nodes = extractJsonLd(page(JSON.stringify({
      '@type': 'Museum',
      offers: { '@type': 'Offer', price: '600', priceCurrency: 'JPY' },
    })));
    const admission = admissionFromJsonLd(nodes, 'JP');
    expect(admission).toMatchObject({ class: 'ticketed', source: 'official-website', confidence: 'high' });
    expect(admission?.fares).toEqual([{ audience: 'adult', amount: 600, currency: 'JPY' }]);
    expect(officialAdmissionClaims(nodes, admission)[0].excerpt).toContain('600');
    expect(officialAdmissionClaims(nodes, admission)[0].excerpt).toContain('JPY');
  });

  it('handles AggregateOffer low and high prices without inventing a second audience', () => {
    const nodes = extractJsonLd(page(JSON.stringify({
      offers: { '@type': 'AggregateOffer', lowPrice: '600', highPrice: '1000', priceCurrency: 'JPY' },
    })));
    const fare = admissionFromJsonLd(nodes, 'JP')?.fares?.[0];
    expect(fare).toMatchObject({
      audience: 'adult', amount: 600, minAmount: 600, maxAmount: 1000, currency: 'JPY', note: 'from 600 to 1000 JPY',
    });
  });

  it('uses isAccessibleForFree when the operator says entry is free', () => {
    const nodes = extractJsonLd(page(JSON.stringify({ isAccessibleForFree: true })));
    const admission = admissionFromJsonLd(nodes, 'JP');
    expect(admission).toMatchObject({ class: 'free', source: 'official-website' });
    expect(officialAdmissionClaims(nodes, admission)[0].summary).toContain('admission is free');
  });

  it('keeps the operator product and validity conditions beside the fare', () => {
    const nodes = extractJsonLd(page(JSON.stringify({
      offers: {
        '@type': 'Offer',
        name: '1-Day Passport',
        price: '7900',
        priceCurrency: 'JPY',
        validThrough: '2026-12-31',
      },
    })));
    const admission = admissionFromJsonLd(nodes, 'JP');
    expect(admission?.fares?.[0]).toMatchObject({
      amount: 7900,
      currency: 'JPY',
      note: '1-Day Passport; valid now to 2026-12-31',
    });
  });

  /**
   * A zero-priced `Offer` is how a great many operators publish free entry —
   * `isAccessibleForFree` is optional and frequently omitted. Requiring both
   * signals classified those places as ticketed, and the card then read
   * "JP¥0 · adult ticket": technically derived from the source, and the worst
   * possible way to say "free".
   */
  it('treats a zero-priced offer as free entry even without isAccessibleForFree', () => {
    const nodes = extractJsonLd(page(JSON.stringify({
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'JPY' },
    })));
    expect(admissionFromJsonLd(nodes, 'JP')).toMatchObject({ class: 'free', source: 'official-website' });
  });

  it('does not call a paid place free because one audience gets in for nothing', () => {
    const nodes = extractJsonLd(page(JSON.stringify({
      offers: [
        { '@type': 'Offer', price: '1500', priceCurrency: 'JPY' },
        { '@type': 'Offer', price: '0', priceCurrency: 'JPY', eligibleCustomerType: 'child' },
      ],
    })));
    const admission = admissionFromJsonLd(nodes, 'JP');
    expect(admission?.class).toBe('ticketed');
    expect(admission?.fares?.some((fare) => fare.amount === 1500)).toBe(true);
  });

  it('resolves a bare structured number only when the country supplies the currency', () => {
    const nodes = extractJsonLd(page(JSON.stringify({ offers: { price: '600' } })));
    expect(admissionFromJsonLd(nodes, 'JP')?.fares?.[0]).toMatchObject({ amount: 600, currency: 'JPY' });
    expect(admissionFromJsonLd(nodes)?.fares).toEqual([]);
  });

  it('keeps an unparseable price range as text instead of treating a band as a fare', () => {
    const nodes = extractJsonLd(page(JSON.stringify({ priceRange: '$$' })));
    expect(admissionFromJsonLd(nodes, 'JP')).toMatchObject({
      class: 'unknown',
      rawText: '$$',
      source: 'official-website',
    });
    expect(officialAdmissionClaims(nodes, admissionFromJsonLd(nodes, 'JP'))).toEqual([]);
  });

  it('keeps the original text when a numeric range only yields its lower fare', () => {
    const nodes = extractJsonLd(page(JSON.stringify({ priceRange: '¥600–¥1,000' })));
    const admission = admissionFromJsonLd(nodes, 'JP');
    expect(admission?.fares?.[0]).toMatchObject({ amount: 600, currency: 'JPY' });
    expect(admission?.rawText).toContain('¥1,000');
  });

  it('reads an explicit fare from visible operator text and keeps the excerpt', () => {
    const admission = admissionFromVisibleText('Tickets: Adults ¥7,900–¥10,900 depending on visit date.', 'JP');
    expect(admission).toMatchObject({
      class: 'ticketed',
      source: 'official-website',
      fares: [{ audience: 'adult', amount: 7900, minAmount: 7900, maxAmount: 10900, currency: 'JPY' }],
    });
    expect(admission?.rawText).toContain('Tickets');
  });
});

describe('finding official ticket pages without leaving the operator origin', () => {
  it('keeps only bounded same-origin ticket links', () => {
    const html = '<a href="/tickets">Tickets</a><a href="https://reseller.example/tickets">Tickets</a><a href="/map">Map</a>';
    expect(officialTicketLinks(html, 'https://venue.example/')).toEqual(['https://venue.example/tickets']);
  });

  it('rejects known map and reseller domains', () => {
    expect(isLikelyResellerUrl('https://www.klook.com/activity/123')).toBe(true);
    expect(isLikelyResellerUrl('https://www.usj.co.jp/')).toBe(false);
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
