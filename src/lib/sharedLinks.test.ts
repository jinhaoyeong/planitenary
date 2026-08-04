import { describe, expect, it } from 'vitest';
import { describeImport, extractLinks, recogniseLink } from './sharedLinks';

describe('recognising a shared link', () => {
  it('reads a YouTube video id from both URL shapes', () => {
    expect(recogniseLink('https://www.youtube.com/watch?v=abc123')).toMatchObject({
      source: 'youtube',
      sourceItemId: 'abc123',
      resolvable: true,
    });
    expect(recogniseLink('https://youtu.be/xyz789')).toMatchObject({
      source: 'youtube',
      sourceItemId: 'xyz789',
    });
  });

  it('identifies the platforms that need a pasted link, and says why', () => {
    for (const [url, source] of [
      ['https://www.tiktok.com/@user/video/7300000000000000000', 'tiktok'],
      ['https://v.douyin.com/abc123/', 'douyin'],
      ['https://www.xiaohongshu.com/explore/650000000000000000', 'rednote'],
    ] as const) {
      const link = recogniseLink(url);
      expect(link?.source).toBe(source);
      // Honest about the limitation rather than silently doing nothing.
      expect(link?.resolvable).toBe(false);
      expect(link?.note).toBeTruthy();
    }
  });

  it('pulls a place id out of a Google Maps link', () => {
    expect(recogniseLink('https://www.google.com/maps/place/?q=place_id:ChIJ_abc-123')).toMatchObject({
      source: 'google-places',
      sourceItemId: 'ChIJ_abc-123',
    });
  });

  it('accepts an unknown blog rather than rejecting real evidence', () => {
    expect(recogniseLink('https://someblog.example/melbourne-guide')).toMatchObject({
      source: 'user-shared',
      resolvable: true,
    });
  });

  it('rejects junk and non-web protocols', () => {
    expect(recogniseLink('')).toBeNull();
    expect(recogniseLink('   ')).toBeNull();
    expect(recogniseLink('not a url at all !!')).toBeNull();
    expect(recogniseLink('javascript:alert(1)')).toBeNull();
    expect(recogniseLink('file:///etc/passwd')).toBeNull();
  });

  it('tolerates a bare domain without a scheme', () => {
    expect(recogniseLink('youtube.com/watch?v=abc')?.source).toBe('youtube');
  });

  it('never coerces a dangerous scheme into a storable https link', () => {
    // These get stored and later rendered as anchors; a javascript: URL that
    // survived normalisation would be a stored-XSS vector.
    for (const hostile of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'vbscript:msgbox(1)',
      'ftp://example.com/x',
    ]) {
      expect(recogniseLink(hostile)).toBeNull();
    }
  });

  it('does not pick up a dangerous scheme when scanning pasted text', () => {
    expect(extractLinks('see javascript:alert(1) and data:text/html,x')).toEqual([]);
  });
});

describe('extracting links from shared text', () => {
  it('finds every link in a pasted message and de-duplicates', () => {
    const links = extractLinks(`
      Check these out:
      https://www.tiktok.com/@a/video/7300000000000000000
      https://youtu.be/abc123 and again https://youtu.be/abc123
    `);
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.source).sort()).toEqual(['tiktok', 'youtube']);
  });

  it('returns nothing for text with no links', () => {
    expect(extractLinks('just some notes about the trip')).toEqual([]);
  });
});

describe('explaining what happened', () => {
  it('names the platforms it cannot read', () => {
    const message = describeImport(extractLinks('https://www.xiaohongshu.com/explore/65 https://v.douyin.com/a/'));
    expect(message).toMatch(/rednote|douyin/i);
    expect(message).toContain('not allow apps to read');
  });

  it('reports a clean read when everything is resolvable', () => {
    expect(describeImport(extractLinks('https://youtu.be/abc'))).toBe('Reading 1 link.');
  });

  it('guides the traveller when nothing was found', () => {
    expect(describeImport([])).toContain('Paste a link');
  });
});
