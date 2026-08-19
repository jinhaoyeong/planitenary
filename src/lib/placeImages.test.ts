/**
 * Place photographs, imported straight from the Deno `_shared` module (which
 * has no Deno APIs) — the same precedent as `osmPlaces.test.ts` and
 * `placeCost.test.ts`.
 *
 * Three invariants are worth more than every parsing case below, and most of
 * this file exists to hold them:
 *
 * 1. **Nothing but a Wikimedia host ever reaches an `<img src>`.** The leads
 *    come from community-edited OSM tags, and an image element is loaded by
 *    the *traveller's* browser — so an arbitrary URL there hands a stranger
 *    the IP address of everybody who sees the card.
 * 2. **An unrecognised licence is not permission.** The gate is an allowlist,
 *    and a refusal costs a photograph, which is always the safe outcome.
 * 3. **A stored credit line is never trusted over the fields beside it.** The
 *    line exists because CC BY and CC BY-SA require the author be named; a row
 *    whose credit disagreed with its own licence column would be crediting the
 *    photograph wrongly, in the exact place where being right is the condition
 *    of showing it.
 */
import { describe, expect, it } from 'vitest';
import {
  attributionFor,
  buildPlaceImage,
  commonsFilePage,
  commonsFileTitleFromUrl,
  heldListingImages,
  isWikimediaImageUrl,
  licenceForDisplay,
  MAX_IMAGES_PER_PLACE,
  normaliseCommonsTitle,
  osmImageLeads,
  parseCommonsMetadata,
  parseImageLead,
  parsePlaceImage,
  parseWikidataId,
  parseWikipediaLead,
  rankPlaceImages,
  stripMarkup,
  wikimediaImageUrl,
  wikivoyageImageLeads,
  withholdListingImage,
  type ImageLead,
  type PlaceImage,
} from '../../supabase/functions/_shared/placeImages';

const UPLOAD = 'https://upload.wikimedia.org/wikipedia/commons';

/** A minimal free-licence metadata block, as Commons actually returns it. */
const freeMetadata = (overrides: Record<string, unknown> = {}) => ({
  Artist: { value: '<a href="/wiki/User:Someone" title="User:Someone">Someone</a>' },
  LicenseShortName: { value: 'CC BY-SA 4.0' },
  LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
  ...overrides,
});

const image = (overrides: Partial<PlaceImage> = {}): PlaceImage => ({
  url: `${UPLOAD}/a/ab/Castle.jpg`,
  source: 'wikimedia-commons',
  sourcePage: commonsFilePage('File:Castle.jpg'),
  licence: 'CC BY-SA 4.0',
  attribution: 'CC BY-SA 4.0 · Wikimedia Commons',
  lead: 'commons-file',
  ...overrides,
});

describe('only Wikimedia hosts can reach an <img src>', () => {
  it('accepts an https Wikimedia upload URL', () => {
    expect(isWikimediaImageUrl(`${UPLOAD}/a/ab/Castle.jpg`)).toBe(true);
  });

  it('refuses any other host, however plausible', () => {
    // The failure this prevents is not a broken picture — it is every viewer's
    // IP address arriving at a host an anonymous map editor chose.
    expect(isWikimediaImageUrl('https://images.example.com/castle.jpg')).toBe(false);
    expect(isWikimediaImageUrl('https://upload.wikimedia.org.evil.test/a.jpg')).toBe(false);
  });

  it('refuses plain http and embedded credentials', () => {
    expect(isWikimediaImageUrl('http://upload.wikimedia.org/a/ab/Castle.jpg')).toBe(false);
    expect(isWikimediaImageUrl('https://user:pass@upload.wikimedia.org/a/ab/Castle.jpg')).toBe(false);
  });

  it('refuses a non-URL rather than throwing', () => {
    expect(isWikimediaImageUrl('Castle.jpg')).toBe(false);
    expect(isWikimediaImageUrl(undefined)).toBe(false);
  });

  it('strips the campaign parameters Commons appends to every thumbnail', () => {
    // Copied verbatim from a live `imageinfo` response, which is the only way
    // this could have been noticed: no test here could have invented it.
    //
    // The parameters are harmless to fetch and dangerous to *store* —
    // `image_url` is half the cache's primary key and `rankPlaceImages`
    // de-duplicates on URL, so a parameter Wikimedia changes turns one
    // photograph into two rows and two gallery entries.
    const live = `${UPLOAD}/thumb/c/ca/Osaka_Castle_03bs3200.jpg/1280px-Osaka_Castle_03bs3200.jpg`
      + '?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail';
    expect(wikimediaImageUrl(live))
      .toBe(`${UPLOAD}/thumb/c/ca/Osaka_Castle_03bs3200.jpg/1280px-Osaka_Castle_03bs3200.jpg`);
  });

  it('carries the stripping through both parsers, so stored and shown agree', () => {
    const live = `${UPLOAD}/a/ab/Castle.jpg?utm_campaign=imageinfo`;
    const built = buildPlaceImage({
      title: 'File:Castle.jpg',
      lead: 'commons-file',
      url: live,
      thumbnailUrl: live,
      metadata: parseCommonsMetadata(freeMetadata()),
    });
    expect(built?.url).toBe(`${UPLOAD}/a/ab/Castle.jpg`);
    expect(built?.thumbnailUrl).toBe(`${UPLOAD}/a/ab/Castle.jpg`);
    expect(parsePlaceImage({ ...image(), url: live })?.url).toBe(`${UPLOAD}/a/ab/Castle.jpg`);
  });
});

describe('file titles out of URLs', () => {
  it('reads the file name from a direct upload URL', () => {
    expect(commonsFileTitleFromUrl(`${UPLOAD}/a/ab/Osaka_Castle.jpg`)).toBe('File:Osaka Castle.jpg');
  });

  it('reads the *file*, not the rendering, from a thumbnail URL', () => {
    // The last segment of a /thumb/ path is `800px-Osaka_Castle.jpg`, which is
    // not a file that exists on Commons — asking about it returns nothing, and
    // the place silently loses its photograph.
    expect(commonsFileTitleFromUrl(`${UPLOAD}/thumb/a/ab/Osaka_Castle.jpg/800px-Osaka_Castle.jpg`))
      .toBe('File:Osaka Castle.jpg');
  });

  it('reads a Commons file page link', () => {
    expect(commonsFileTitleFromUrl('https://commons.wikimedia.org/wiki/File:Osaka_Castle.jpg'))
      .toBe('File:Osaka Castle.jpg');
  });

  it('decodes a percent-encoded title', () => {
    expect(commonsFileTitleFromUrl(`${UPLOAD}/a/ab/Caf%C3%A9_de_Paris.jpg`)).toBe('File:Café de Paris.jpg');
  });

  it('yields nothing for a non-Wikimedia URL', () => {
    expect(commonsFileTitleFromUrl('https://flickr.com/photos/1/castle.jpg')).toBeUndefined();
  });
});

describe('one photograph is one title', () => {
  it('collapses underscores, spacing and leading case into a single title', () => {
    // Commons treats these as one file. Two spellings would otherwise become
    // two cache rows, two lookups, and two chances to show the same picture.
    expect(normaliseCommonsTitle('file:osaka_castle.jpg', 'File')).toBe('File:Osaka castle.jpg');
    expect(normaliseCommonsTitle('Osaka  castle.jpg', 'File')).toBe('File:Osaka castle.jpg');
    expect(normaliseCommonsTitle('File:Osaka castle.jpg', 'File')).toBe('File:Osaka castle.jpg');
  });

  it('refuses a value carrying URL punctuation, rather than guessing at it', () => {
    expect(normaliseCommonsTitle('File:Foo|Bar.jpg', 'File')).toBeUndefined();
    expect(normaliseCommonsTitle('', 'File')).toBeUndefined();
  });
});

describe('leads from OSM tags', () => {
  it('takes a mapper\'s own file tag first', () => {
    const leads = osmImageLeads({
      wikimedia_commons: 'File:Osaka Castle 03.jpg',
      wikidata: 'Q183395',
      wikipedia: 'en:Osaka Castle',
    });
    expect(leads[0]).toEqual({ kind: 'commons-file', value: 'File:Osaka Castle 03.jpg', origin: 'osm-tag' });
    // Strongest first, so a caller taking the first gets the best.
    expect(leads.map((lead) => lead.kind)).toEqual(['commons-file', 'wikidata', 'wikipedia']);
  });

  it('recognises a category tag as a category, not a file', () => {
    const leads = osmImageLeads({ wikimedia_commons: 'Category:Osaka Castle' });
    expect(leads).toEqual([{ kind: 'commons-category', value: 'Category:Osaka Castle', origin: 'osm-tag' }]);
  });

  it('accepts an image tag only as a Commons file title, never as a URL to load', () => {
    const leads = osmImageLeads({ image: `${UPLOAD}/a/ab/Shrine.jpg` });
    expect(leads).toEqual([{ kind: 'commons-file', value: 'File:Shrine.jpg', origin: 'osm-tag' }]);
  });

  it('drops an image tag hosted anywhere else entirely', () => {
    // This is the security rule, and it has to be a *drop*: keeping the URL
    // "just for the gallery" would put it in front of travellers eventually.
    expect(osmImageLeads({ image: 'https://my-blog.example/photos/shrine.jpg' })).toEqual([]);
  });

  it('produces nothing for the ordinary place that carries no pointer at all', () => {
    // The common case, and why the probe log matters more here than anywhere:
    // most OSM places have no photograph and must not be re-asked forever.
    expect(osmImageLeads({ tourism: 'attraction', name: 'Somewhere' })).toEqual([]);
  });

  it('does not emit the same lead twice when two tags agree', () => {
    const leads = osmImageLeads({
      wikimedia_commons: 'File:Shrine.jpg',
      image: `${UPLOAD}/thumb/a/ab/Shrine.jpg/640px-Shrine.jpg`,
    });
    expect(leads).toHaveLength(1);
  });

  it('reads a Wikidata id out of a tag carrying stray text', () => {
    expect(parseWikidataId(' q183395 ')).toBe('Q183395');
    expect(parseWikidataId('not an id')).toBeUndefined();
  });

  it('splits a wikipedia tag into language and title', () => {
    expect(parseWikipediaLead('ja:大阪城')).toEqual({ language: 'ja', title: '大阪城' });
    expect(parseWikipediaLead('Osaka Castle')).toBeUndefined();
  });

  it('says an OSM tag is an OSM tag', () => {
    // Provenance, not ranking. The same Q-id can reach us from a map object and
    // from a guidebook listing, and those are not the same statement.
    expect(osmImageLeads({ wikidata: 'Q183395' })[0].origin).toBe('osm-tag');
  });
});

/**
 * Leads from a Wikivoyage listing.
 *
 * Same union, same resolver, same validator — different source, and it says
 * so. The fields also *mean* different things from their OSM namesakes, which
 * is why this is a second gatherer rather than the same one with a different
 * argument: `image` here is a bare Commons file name where OSM's is a URL, and
 * `wikipedia` here is a bare title where OSM's carries a language.
 */
describe('leads from a Wikivoyage listing', () => {
  it('reads the listing\'s Wikidata item', () => {
    expect(wikivoyageImageLeads({ wikidata: 'Q865839' }))
      .toEqual([{ kind: 'wikidata', value: 'Q865839', origin: 'wikivoyage-listing' }]);
  });

  it('supplies the language the field omits, because en.wikivoyage means en', () => {
    // Nothing here consults a locale: the field names an article on the wiki
    // the listing was read from, and this app reads en.wikivoyage.
    expect(wikivoyageImageLeads({ wikipedia: 'Fukuoka Tower' }))
      .toEqual([{ kind: 'wikipedia', value: 'en:Fukuoka Tower', origin: 'wikivoyage-listing' }]);
  });

  it('does not prefix a language twice when an editor supplied one', () => {
    expect(wikivoyageImageLeads({ wikipedia: 'en:Fukuoka Tower' })[0].value).toBe('en:Fukuoka Tower');
  });

  it('reads a title that merely looks prefixed as a title', () => {
    /**
     * `parseWikipediaLead` would take `SS` for a wiki code and build a request
     * to `ss.wikipedia.org` — a hostname chosen by a wiki editor. A missed
     * photograph is the cheaper mistake, so only the local prefix is honoured.
     */
    expect(wikivoyageImageLeads({ wikipedia: 'SS: Great Britain' })[0].value)
      .toBe('en:SS: Great Britain');
  });

  it('turns a bare file name into a Commons file lead', () => {
    // The ACROS case: the listing's only identity is the photograph on it.
    expect(wikivoyageImageLeads({ image: 'Acrosfukuoka02.jpg' }))
      .toEqual([{ kind: 'commons-file', value: 'File:Acrosfukuoka02.jpg', origin: 'wikivoyage-listing' }]);
  });

  it('does not double the File: prefix when the editor already wrote one', () => {
    expect(wikivoyageImageLeads({ image: 'File:Acrosfukuoka02.jpg' })[0].value)
      .toBe('File:Acrosfukuoka02.jpg');
  });

  it('orders a listing that states everything, strongest first, without duplicates', () => {
    // Maizuru Park states both an item and a file; the file is the editor's
    // choice for this exact listing, so it leads.
    const leads = wikivoyageImageLeads({
      wikidata: 'Q11613685',
      wikipedia: 'Maizuru Park',
      image: 'Shimonohashi Gomon.JPG',
    });
    expect(leads.map((lead) => lead.kind)).toEqual(['commons-file', 'wikidata', 'wikipedia']);
    expect(new Set(leads.map((lead) => lead.origin))).toEqual(new Set(['wikivoyage-listing']));
    expect(new Set(leads.map((lead) => `${lead.kind}|${lead.value}`)).size).toBe(3);
  });

  it('promotes nothing from a malformed Wikidata field', () => {
    expect(wikivoyageImageLeads({ wikidata: 'see the article' })).toEqual([]);
  });

  it('promotes nothing from a file name that is really a URL in the wrong field', () => {
    // `normaliseCommonsTitle` refuses path and fragment punctuation rather than
    // guessing at a file that does not exist.
    expect(wikivoyageImageLeads({ image: 'https://example.com/photos/x.jpg|thumb' })).toEqual([]);
  });

  it('produces nothing for the ordinary listing that states no identity', () => {
    // 14 of the 28 Wikivoyage candidates on a Fukuoka deck. They keep the
    // placard, and that is the honest outcome.
    expect(wikivoyageImageLeads({})).toEqual([]);
    expect(wikivoyageImageLeads({ wikidata: '', wikipedia: '  ', image: undefined })).toEqual([]);
  });
});

/**
 * A refused identity must not be able to supply a picture through a second
 * door.
 *
 * v3 established this on the Wikipedia path, after Marui's Wikidata item was
 * correctly refused as a company and that same company's article then handed a
 * Fukuoka branch a photograph of a Tokyo head office. A Wikivoyage listing
 * opens a third door, because one listing can state both an identity and a
 * photograph.
 */
describe('a listing cannot bypass its own refused identity', () => {
  const listingLead = (kind: ImageLead['kind'], value: string): ImageLead =>
    ({ kind, value, origin: 'wikivoyage-listing' });

  it('holds a listing photograph back when the same listing also names an entity', () => {
    // Maizuru Park: `wikidata=Q11613685` and `image=…` on one listing. The
    // photograph waits for the entity verdict instead of being claimed first.
    expect(heldListingImages([{
      placeId: 'wv:Maizuru Park',
      leads: [listingLead('commons-file', 'File:Shimonohashi Gomon.JPG'), listingLead('wikidata', 'Q11613685')],
    }])).toEqual([{ placeId: 'wv:Maizuru Park', title: 'File:Shimonohashi Gomon.JPG' }]);
  });

  it('holds nothing back for a listing whose photograph is its only statement', () => {
    /**
     * ACROS. There is no identity to contradict the picture, so there is
     * nothing to wait for — refusing it here would be refusing evidence for
     * lacking evidence.
     */
    expect(heldListingImages([{
      placeId: 'wv:ACROS rooftop garden',
      leads: [listingLead('commons-file', 'File:Acrosfukuoka02.jpg')],
    }])).toEqual([]);
  });

  it('never holds a map object\'s photograph back for its own Wikidata tag', () => {
    /**
     * The rule is about **one listing** contradicting itself. A mapper's
     * `wikimedia_commons` tag and an OSM `wikidata` tag are separate statements
     * by separate people, and this behaviour is unchanged from v3.
     */
    expect(heldListingImages([{
      placeId: 'node/1',
      leads: [
        { kind: 'commons-file', value: 'File:Shrine.jpg', origin: 'osm-tag' },
        { kind: 'wikidata', value: 'Q6777917', origin: 'osm-tag' },
      ],
    }])).toEqual([]);
  });

  it('does not hold a legacy lead back, since every one of those is an OSM tag', () => {
    // Leads cached before provenance was recorded carry no `origin`.
    expect(heldListingImages([{
      placeId: 'node/1',
      leads: [{ kind: 'commons-file', value: 'File:Shrine.jpg' }, { kind: 'wikidata', value: 'Q1' }],
    }])).toEqual([]);
  });

  it('withholds the listing photograph when the listing named the wrong entity', () => {
    expect(withholdListingImage(['wikidata_non_place_entity'])).toBe(true);
    expect(withholdListingImage(['wikidata_coordinate_mismatch'])).toBe(true);
  });

  it('withholds it when the listing\'s article could not be tied to anything', () => {
    expect(withholdListingImage(['wikipedia_unverified_identity'])).toBe(true);
    expect(withholdListingImage(['wikipedia_wikidata_identity_mismatch'])).toBe(true);
  });

  it('keeps it when the identity was fine and simply had no picture', () => {
    /**
     * The distinction the whole rule turns on. An item with no `P18` said
     * nothing wrong about identity — and a listing whose editor supplied a
     * photograph is exactly the case worth keeping.
     */
    expect(withholdListingImage(['wikidata_no_p18'])).toBe(false);
  });

  it('keeps it when some other candidate photograph was merely a placeholder', () => {
    // A bad file is not a bad identity.
    expect(withholdListingImage(['non_photographic_asset'])).toBe(false);
  });

  it('keeps it when nothing was refused at all', () => {
    expect(withholdListingImage([])).toBe(false);
  });

  it('withholds on any refusal, even beside an acceptance', () => {
    // Deliberately conservative: a listing whose editor named a wrong entity
    // has shown their hand about that listing.
    expect(withholdListingImage(['wikidata_no_p18', 'wikidata_coordinate_mismatch'])).toBe(true);
  });
});

describe('an unrecognised licence is not permission', () => {
  it('admits a licence it can name', () => {
    expect(licenceForDisplay({ licenceShortName: 'CC BY-SA 4.0' })?.licence).toBe('CC BY-SA 4.0');
    expect(licenceForDisplay({ licenceShortName: 'CC0' })?.licence).toBe('CC0');
    expect(licenceForDisplay({ licenceShortName: 'Public domain' })?.licence).toBe('Public domain');
  });

  it('refuses a non-commercial or no-derivatives licence', () => {
    // `CC BY-NC` starts with an allowed prefix, so the refusal list has to run
    // first — otherwise the allowlist admits exactly what it exists to exclude.
    expect(licenceForDisplay({ licenceShortName: 'CC BY-NC 3.0' })).toBeUndefined();
    expect(licenceForDisplay({ licenceShortName: 'CC BY-ND 4.0' })).toBeUndefined();
  });

  it('refuses fair use however it is spelled', () => {
    expect(licenceForDisplay({ licenceShortName: 'Fair use' })).toBeUndefined();
    expect(licenceForDisplay({ licenceShortName: 'Non-free media' })).toBeUndefined();
  });

  it('refuses when a clean short name sits beside a restriction', () => {
    // The catch is routinely in another field: the photograph is CC BY-SA
    // while the building in it is not freely licensed.
    expect(licenceForDisplay({
      licenceShortName: 'CC BY-SA 3.0',
      restrictions: 'Non-free architectural work',
    })).toBeUndefined();
  });

  it('refuses a licence nobody here has heard of', () => {
    expect(licenceForDisplay({ licenceShortName: 'Some Museum Terms v2' })).toBeUndefined();
    expect(licenceForDisplay({})).toBeUndefined();
  });

  it('keeps a licence URL only when it is https', () => {
    expect(licenceForDisplay({ licenceShortName: 'CC0', licenceUrl: 'http://example.com' })?.licenceUrl)
      .toBeUndefined();
  });
});

describe('credit lines', () => {
  it('names the author, because the licence requires it', () => {
    expect(attributionFor('Jane Photographer', 'CC BY-SA 4.0'))
      .toBe('Jane Photographer · CC BY-SA 4.0 · Wikimedia Commons');
  });

  it('falls back to Commons when no author is published', () => {
    expect(attributionFor(undefined, 'CC0')).toBe('CC0 · Wikimedia Commons');
  });

  it('falls back when the author field is a template\'s paragraph rather than a name', () => {
    const paragraph = 'This file was uploaded as part of a partnership between '
      + 'a museum and Wikimedia, see the project page for details';
    expect(attributionFor(paragraph, 'CC BY 4.0')).toBe('CC BY 4.0 · Wikimedia Commons');
  });
});

describe('Commons metadata is markup, and is read as such', () => {
  it('strips the anchor a wiki template wraps an author in', () => {
    expect(parseCommonsMetadata(freeMetadata()).artist).toBe('Someone');
  });

  it('decodes entities after stripping tags, never before', () => {
    // Decoding first would turn a `&lt;` in somebody's name into a tag that
    // the stripper then removes, silently truncating the credit.
    expect(stripMarkup('A &lt;b&gt; B')).toBe('A <b> B');
    expect(stripMarkup('<i>Ren&eacute;</i> &amp; Co')).toBe('Ren&eacute; & Co');
  });

  it('returns an empty record for a malformed block rather than throwing', () => {
    expect(parseCommonsMetadata(null)).toEqual({});
    expect(parseCommonsMetadata(['not', 'a', 'map'])).toEqual({});
    expect(parseCommonsMetadata({ Artist: 'bare string, not { value }' }).artist).toBeUndefined();
  });
});

describe('building a photograph', () => {
  it('produces a credited image from a free file', () => {
    const built = buildPlaceImage({
      title: 'File:Castle.jpg',
      lead: 'commons-file',
      url: `${UPLOAD}/thumb/a/ab/Castle.jpg/1024px-Castle.jpg`,
      thumbnailUrl: `${UPLOAD}/thumb/a/ab/Castle.jpg/1024px-Castle.jpg`,
      width: 4000,
      height: 3000,
      descriptionUrl: 'https://commons.wikimedia.org/wiki/File:Castle.jpg',
      metadata: parseCommonsMetadata(freeMetadata()),
    });
    expect(built?.attribution).toBe('Someone · CC BY-SA 4.0 · Wikimedia Commons');
    expect(built?.sourcePage).toBe('https://commons.wikimedia.org/wiki/File:Castle.jpg');
  });

  it('refuses a perfectly good URL under a licence it may not display', () => {
    const built = buildPlaceImage({
      title: 'File:Castle.jpg',
      lead: 'commons-file',
      url: `${UPLOAD}/a/ab/Castle.jpg`,
      metadata: parseCommonsMetadata(freeMetadata({ LicenseShortName: { value: 'Fair use' } })),
    });
    expect(built).toBeUndefined();
  });

  it('refuses a free licence on a URL it may not load', () => {
    const built = buildPlaceImage({
      title: 'File:Castle.jpg',
      lead: 'commons-file',
      url: 'https://cdn.example.com/castle.jpg',
      metadata: parseCommonsMetadata(freeMetadata()),
    });
    expect(built).toBeUndefined();
  });

  it('falls back to the file page when no description URL came back', () => {
    const built = buildPlaceImage({
      title: 'File:Osaka Castle.jpg',
      lead: 'wikidata',
      url: `${UPLOAD}/a/ab/Osaka_Castle.jpg`,
      metadata: parseCommonsMetadata(freeMetadata()),
    });
    expect(built?.sourcePage).toBe('https://commons.wikimedia.org/wiki/File%3AOsaka_Castle.jpg');
  });
});

describe('ranking decides which photograph a traveller actually sees', () => {
  it('prefers the mapper\'s own choice over a category member', () => {
    const ranked = rankPlaceImages([
      image({ url: `${UPLOAD}/c/cd/Sign.jpg`, lead: 'commons-category' }),
      image({ url: `${UPLOAD}/a/ab/Building.jpg`, lead: 'commons-file' }),
    ]);
    expect(ranked[0].url).toContain('Building.jpg');
  });

  it('orders the four leads by who chose the picture and for what', () => {
    const ranked = rankPlaceImages([
      image({ url: `${UPLOAD}/1/Category.jpg`, lead: 'commons-category' }),
      image({ url: `${UPLOAD}/2/Article.jpg`, lead: 'wikipedia' }),
      image({ url: `${UPLOAD}/3/Item.jpg`, lead: 'wikidata' }),
      image({ url: `${UPLOAD}/4/Mapper.jpg`, lead: 'commons-file' }),
    ]);
    expect(ranked.map((entry) => entry.lead))
      .toEqual(['commons-file', 'wikidata', 'wikipedia', 'commons-category']);
  });

  it('shows one photograph once, credited to the stronger lead that found it', () => {
    // A mapper's tag and an article's lead image are frequently one file.
    // Twice in a gallery reads as two pictures of the same wall.
    const ranked = rankPlaceImages([
      image({ url: `${UPLOAD}/a/ab/Castle.jpg`, lead: 'wikipedia' }),
      image({ url: `${UPLOAD}/a/ab/Castle.jpg`, lead: 'commons-file' }),
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].lead).toBe('commons-file');
  });

  it('breaks a tie on pixel area, so a card is not filled with a thumbnail', () => {
    const ranked = rankPlaceImages([
      image({ url: `${UPLOAD}/small.jpg`, lead: 'commons-category', width: 320, height: 240 }),
      image({ url: `${UPLOAD}/large.jpg`, lead: 'commons-category', width: 4000, height: 3000 }),
    ]);
    expect(ranked[0].url).toContain('large.jpg');
  });

  it('prefers landscape at equal area, because the media slot is wide', () => {
    const ranked = rankPlaceImages([
      image({ url: `${UPLOAD}/tall.jpg`, lead: 'commons-category', width: 300, height: 400 }),
      image({ url: `${UPLOAD}/wide.jpg`, lead: 'commons-category', width: 400, height: 300 }),
    ]);
    expect(ranked[0].url).toContain('wide.jpg');
  });

  it('caps how many are kept per place', () => {
    const many = Array.from({ length: 12 }, (_, index) => image({
      url: `${UPLOAD}/file-${index}.jpg`,
      lead: 'commons-category',
    }));
    expect(rankPlaceImages(many)).toHaveLength(MAX_IMAGES_PER_PLACE);
  });
});

describe('a photograph crossing a boundary is re-checked, not trusted', () => {
  it('refuses a row whose URL is no longer a Wikimedia host', () => {
    expect(parsePlaceImage({ ...image(), url: 'https://cdn.example.com/castle.jpg' })).toBeUndefined();
  });

  it('refuses a row that lost its licence', () => {
    const withoutLicence: Record<string, unknown> = { ...image() };
    delete withoutLicence.licence;
    expect(parsePlaceImage(withoutLicence)).toBeUndefined();
  });

  it('rebuilds the credit rather than trusting the stored line', () => {
    // A stored credit that disagreed with its own licence column would be
    // crediting the photograph wrongly, in the one place where being right is
    // the condition of showing it at all.
    const parsed = parsePlaceImage({
      ...image({ author: 'Jane Photographer', licence: 'CC BY 4.0' }),
      attribution: 'Someone Else · CC0 · Wikimedia Commons',
    });
    expect(parsed?.attribution).toBe('Jane Photographer · CC BY 4.0 · Wikimedia Commons');
  });

  it('degrades a malformed payload to no photograph rather than throwing', () => {
    expect(parsePlaceImage(null)).toBeUndefined();
    expect(parsePlaceImage('a string')).toBeUndefined();
    expect(parsePlaceImage([])).toBeUndefined();
  });
});

describe('leads arriving from a client are bounded and normalised', () => {
  it('normalises a title the client spelled differently', () => {
    expect(parseImageLead({ kind: 'commons-file', value: 'file:osaka_castle.jpg' }))
      .toEqual({ kind: 'commons-file', value: 'File:Osaka castle.jpg' });
  });

  it('refuses an unbounded value, which would become somebody else\'s request', () => {
    expect(parseImageLead({ kind: 'commons-file', value: 'x'.repeat(400) })).toBeUndefined();
  });

  it('refuses a kind it does not know', () => {
    expect(parseImageLead({ kind: 'arbitrary-url', value: 'https://example.com/a.jpg' })).toBeUndefined();
  });

  it('refuses a wikipedia lead with no language, which would build a bad hostname', () => {
    expect(parseImageLead({ kind: 'wikipedia', value: 'Osaka Castle' })).toBeUndefined();
    expect(parseImageLead({ kind: 'wikipedia', value: 'ja:大阪城' }))
      .toEqual({ kind: 'wikipedia', value: 'ja:大阪城' });
  });

  it('carries provenance back across the round trip through the client', () => {
    /**
     * The server needs this: the rule that a refused listing identity cannot be
     * bypassed by that same listing's photograph is enforced here, and knowing
     * which leads came from one listing is how it recognises the case.
     */
    expect(parseImageLead({ kind: 'wikidata', value: 'Q865839', origin: 'wikivoyage-listing' }))
      .toEqual({ kind: 'wikidata', value: 'Q865839', origin: 'wikivoyage-listing' });
  });

  it('drops an origin it does not recognise rather than trusting it', () => {
    // This arrives in a request body. Dropping it only loses the *conditional*
    // treatment, so an invented origin can never grant anything.
    expect(parseImageLead({ kind: 'wikidata', value: 'Q1', origin: 'trust-me' }))
      .toEqual({ kind: 'wikidata', value: 'Q1' });
  });
});
