/**
 * Identity validation for place photographs, imported straight from the Deno
 * `_shared` module — the same precedent as `placeImages.test.ts`.
 *
 * Every fixture here is a mapping that actually occurred in production. A
 * correctly licensed photograph of the wrong subject passes every other gate in
 * this pipeline, so these are the only tests standing between a traveller and a
 * confident picture of somewhere else.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_ENTITY_DISTANCE_KM,
  NON_PLACE_INSTANCE_OF,
  PLACE_IMAGE_VALIDATION_VERSION,
  distanceKm,
  isNonPhotographicAsset,
  validateEntityForPlace,
} from '../../supabase/functions/_shared/placeImages.ts';

const FUKUOKA = { lat: 33.5904, lng: 130.4017 };
const SINGAPORE = { lat: 1.3521, lng: 103.8198 };
const SEOUL = { lat: 37.5665, lng: 126.978 };

describe('coordinate compatibility', () => {
  it('accepts an entity sitting on the candidate', () => {
    // Solaria Stage: the median observed match is ~20 m away.
    const result = validateEntityForPlace(
      { lat: 33.5906, lng: 130.4019, instanceOf: ['Q11331980'] },
      FUKUOKA,
    );
    expect(result.ok).toBe(true);
  });

  it('keeps a large place whose entity is a centroid', () => {
    // Bugaksan, 1.685 km: the largest legitimate distance in the sample. A
    // tighter threshold would start discarding mountains and parks.
    const entity = { lat: 37.5816, lng: 126.9812, instanceOf: ['Q8502'] };
    expect(distanceKm(SEOUL.lat, SEOUL.lng, entity.lat, entity.lng)).toBeLessThan(MAX_ENTITY_DISTANCE_KM);
    expect(validateEntityForPlace(entity, SEOUL).ok).toBe(true);
  });

  it('rejects a same-name store in another country', () => {
    // Singapore Takashimaya resolved to Takashimaya Nihonbashi, Tokyo —
    // 4,952 km away, and it had coordinates, so presence alone approved it.
    const nihonbashi = { lat: 35.6817, lng: 139.7745, instanceOf: ['Q4830453'] };
    expect(distanceKm(SINGAPORE.lat, SINGAPORE.lng, nihonbashi.lat, nihonbashi.lng)).toBeGreaterThan(4000);
    expect(validateEntityForPlace(nihonbashi, SINGAPORE)).toEqual({
      ok: false,
      reason: 'wikidata_coordinate_mismatch',
    });
  });

  it('does not punish a candidate for our own missing coordinates', () => {
    const entity = { lat: 35.6817, lng: 139.7745, instanceOf: [] };
    expect(validateEntityForPlace(entity, undefined).ok).toBe(true);
    expect(validateEntityForPlace(entity, { lat: undefined, lng: undefined }).ok).toBe(true);
  });
});

describe('non-place entities without coordinates', () => {
  it('rejects the retailer behind a branch', () => {
    // Marui (Q6777917) is a company; its P18 is the Shibuya flagship, shown on
    // a Fukuoka candidate.
    expect(validateEntityForPlace({ instanceOf: ['Q4830453', 'Q507619'] }, FUKUOKA)).toEqual({
      ok: false,
      reason: 'wikidata_non_place_entity',
    });
  });

  it('rejects an idol group standing in for a venue', () => {
    // HKT48 Theater resolved to Q47925, the group, whose P18 is an AKB48
    // concert photograph — not a building at all.
    expect(validateEntityForPlace({ instanceOf: ['Q641066'] }, FUKUOKA)).toEqual({
      ok: false,
      reason: 'wikidata_non_place_entity',
    });
  });

  it('rejects museum hardware described as a vehicle model', () => {
    // The War Memorial of Korea exhibits resolve to aircraft/tank *classes*,
    // whose pictures were taken elsewhere entirely.
    for (const p31 of ['Q15056993', 'Q100710213', 'Q18487018', 'Q18487055', 'Q100709275']) {
      expect(validateEntityForPlace({ instanceOf: [p31] }, SEOUL)).toEqual({
        ok: false,
        reason: 'wikidata_non_place_entity',
      });
    }
  });

  it('keeps legitimate places whose entity simply lacks coordinates', () => {
    // Both of these produced a correct photograph of themselves. Blanket
    // rejection on "no P625" would have discarded them.
    expect(validateEntityForPlace({ instanceOf: ['Q34651', 'Q16970'] }, { lat: 25.033, lng: 121.5654 }).ok).toBe(true);
    expect(validateEntityForPlace({ instanceOf: ['Q329477'] }, { lat: 25.033, lng: 121.5654 }).ok).toBe(true);
  });

  it('does not refuse an unrecognised type', () => {
    // Ambiguity must not cost coverage: only a known-bad type is refused.
    expect(validateEntityForPlace({ instanceOf: ['Q99999999'] }, FUKUOKA).ok).toBe(true);
    expect(validateEntityForPlace({ instanceOf: [] }, FUKUOKA).ok).toBe(true);
  });

  it('never denies a type that a legitimate place resolved through', () => {
    for (const keep of ['Q16970', 'Q34651', 'Q329477', 'Q11331980']) {
      expect(NON_PLACE_INSTANCE_OF.has(keep)).toBe(false);
    }
  });
});

describe('non-photographic assets', () => {
  it('rejects the placeholder two Fukuoka shrines received', () => {
    expect(isNonPhotographicAsset('File:Gthumb.svg')).toBe(true);
  });

  it('rejects symbols that are not photographs of a place', () => {
    for (const title of [
      'File:Flag of Japan.svg',
      'File:Coat of arms of Fukuoka.svg',
      'File:Some logo.png',
      'File:No image available.png',
      'File:Placeholder.png',
      'File:Map of Kyoto.png',
    ]) {
      expect(isNonPhotographicAsset(title)).toBe(true);
    }
  });

  it('keeps real photographs, including ones that merely mention a place', () => {
    for (const title of [
      'File:Fukuoka_City_Science_Museum_20171103-3.jpg',
      'File:Hakata-Machiya_Furusato_Museum_20170918.jpg',
      'File:Tachibanayama02.jpg',
      'File:Najima_Seaplane_Station_1945-06-06.jpg',
    ]) {
      expect(isNonPhotographicAsset(title)).toBe(false);
    }
  });
});

describe('validation version', () => {
  it('is ahead of the unstamped legacy default', () => {
    // Legacy rows carry no version and are read as 1, so they must revalidate.
    expect(PLACE_IMAGE_VALIDATION_VERSION).toBeGreaterThan(1);
  });
});

describe('every image authority meets the same gate', () => {
  /**
   * The production bypass: Marui's Wikidata item was correctly refused, and the
   * article for that same company then supplied its Tokyo head office to a
   * Fukuoka branch. Both paths resolve to Q6777917, so both must refuse it —
   * the entity is the thing being judged, never the route that reached it.
   */
  it('refuses Marui through the Wikidata path and the Wikipedia path alike', () => {
    const marui = { instanceOf: ['Q4830453', 'Q507619'] };

    // Reached via the OSM wikidata tag.
    expect(validateEntityForPlace(marui, FUKUOKA)).toEqual({
      ok: false,
      reason: 'wikidata_non_place_entity',
    });

    // Reached via the article's pageprops.wikibase_item — same entity, same verdict.
    const fromArticle = { ...marui, title: 'File:Marui_head_office_nakano_2009.JPG' };
    expect(validateEntityForPlace(fromArticle, FUKUOKA)).toEqual({
      ok: false,
      reason: 'wikidata_non_place_entity',
    });
  });

  it('refuses an article entity that is far from the candidate', () => {
    // A Wikipedia-only lead gets the identical coordinate treatment.
    const nihonbashi = { lat: 35.6817, lng: 139.7745, instanceOf: ['Q4830453'] };
    expect(validateEntityForPlace(nihonbashi, SINGAPORE)).toEqual({
      ok: false,
      reason: 'wikidata_coordinate_mismatch',
    });
  });

  it('accepts an article entity that sits on the candidate', () => {
    expect(validateEntityForPlace({ lat: 33.5906, lng: 130.4019, instanceOf: ['Q33506'] }, FUKUOKA).ok).toBe(true);
  });
});

describe('validation version retires looser decisions', () => {
  it('is 3, because v2 did not prove Wikipedia-lead identity', () => {
    // Every v2 row was accepted under a policy that trusted article images, so
    // v2 must be a cache miss rather than a cheaper answer.
    expect(PLACE_IMAGE_VALIDATION_VERSION).toBe(3);
  });
});
