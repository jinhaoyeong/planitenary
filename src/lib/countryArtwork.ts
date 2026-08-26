import type { Itinerary } from '../data';
import generalPlanningArtwork from '../assets/journey/trip-planning-start.jpg';
import ae from '../assets/journey/countries/country-ae-united-arab-emirates.jpg';
import ar from '../assets/journey/countries/country-ar-argentina.jpg';
import at from '../assets/journey/countries/country-at-austria.jpg';
import au from '../assets/journey/countries/country-au-australia.jpg';
import br from '../assets/journey/countries/country-br-brazil.jpg';
import ca from '../assets/journey/countries/country-ca-canada.jpg';
import ch from '../assets/journey/countries/country-ch-switzerland.jpg';
import cl from '../assets/journey/countries/country-cl-chile.jpg';
import cn from '../assets/journey/countries/country-cn-china.jpg';
import cz from '../assets/journey/countries/country-cz-czechia.jpg';
import de from '../assets/journey/countries/country-de-germany.jpg';
import dk from '../assets/journey/countries/country-dk-denmark.jpg';
import eg from '../assets/journey/countries/country-eg-egypt.jpg';
import es from '../assets/journey/countries/country-es-spain.jpg';
import fi from '../assets/journey/countries/country-fi-finland.jpg';
import fr from '../assets/journey/countries/country-fr-france.jpg';
import gb from '../assets/journey/countries/country-gb-united-kingdom.jpg';
import gr from '../assets/journey/countries/country-gr-greece.jpg';
import hk from '../assets/journey/countries/country-hk-hong-kong.jpg';
import hu from '../assets/journey/countries/country-hu-hungary.jpg';
import id from '../assets/journey/countries/country-id-indonesia.jpg';
import ie from '../assets/journey/countries/country-ie-ireland.jpg';
import il from '../assets/journey/countries/country-il-israel.jpg';
import india from '../assets/journey/countries/country-in-india.jpg';
import is from '../assets/journey/countries/country-is-iceland.jpg';
import it from '../assets/journey/countries/country-it-italy.jpg';
import jo from '../assets/journey/countries/country-jo-jordan.jpg';
import jp from '../assets/journey/countries/country-jp-japan.jpg';
import ke from '../assets/journey/countries/country-ke-kenya.jpg';
import kh from '../assets/journey/countries/country-kh-cambodia.jpg';
import kr from '../assets/journey/countries/country-kr-south-korea.jpg';
import la from '../assets/journey/countries/country-la-laos.jpg';
import lk from '../assets/journey/countries/country-lk-sri-lanka.jpg';
import ma from '../assets/journey/countries/country-ma-morocco.jpg';
import mv from '../assets/journey/countries/country-mv-maldives.jpg';
import mx from '../assets/journey/countries/country-mx-mexico.jpg';
import my from '../assets/journey/countries/country-my-malaysia.jpg';
import nl from '../assets/journey/countries/country-nl-netherlands.jpg';
import no from '../assets/journey/countries/country-no-norway.jpg';
import np from '../assets/journey/countries/country-np-nepal.jpg';
import nz from '../assets/journey/countries/country-nz-new-zealand.jpg';
import pe from '../assets/journey/countries/country-pe-peru.jpg';
import ph from '../assets/journey/countries/country-ph-philippines.jpg';
import pl from '../assets/journey/countries/country-pl-poland.jpg';
import pt from '../assets/journey/countries/country-pt-portugal.jpg';
import qa from '../assets/journey/countries/country-qa-qatar.jpg';
import sa from '../assets/journey/countries/country-sa-saudi-arabia.jpg';
import se from '../assets/journey/countries/country-se-sweden.jpg';
import sg from '../assets/journey/countries/country-sg-singapore.jpg';
import th from '../assets/journey/countries/country-th-thailand.jpg';
import tr from '../assets/journey/countries/country-tr-turkey.jpg';
import tw from '../assets/journey/countries/country-tw-taiwan.jpg';
import us from '../assets/journey/countries/country-us-united-states.jpg';
import vn from '../assets/journey/countries/country-vn-vietnam.jpg';
import za from '../assets/journey/countries/country-za-south-africa.jpg';
import { resolveCountryIdentity, resolveTripCountry } from './tripCountry';

export const COUNTRY_ARTWORK_BY_CODE: Readonly<Record<string, string>> = {
  AE: ae, AR: ar, AT: at, AU: au, BR: br, CA: ca, CH: ch, CL: cl, CN: cn,
  CZ: cz, DE: de, DK: dk, EG: eg, ES: es, FI: fi, FR: fr, GB: gb, GR: gr,
  HK: hk, HU: hu, ID: id, IE: ie, IL: il, IN: india, IS: is, IT: it, JO: jo,
  JP: jp, KE: ke, KH: kh, KR: kr, LA: la, LK: lk, MA: ma, MV: mv, MX: mx,
  MY: my, NL: nl, NO: no, NP: np, NZ: nz, PE: pe, PH: ph, PL: pl, PT: pt,
  QA: qa, SA: sa, SE: se, SG: sg, TH: th, TR: tr, TW: tw, US: us, VN: vn,
  ZA: za,
};

export interface CountryArtwork {
  src: string;
  countryCode?: string;
  countryName?: string;
  alt: string;
}

export function countryArtworkForCountry(
  countryCode?: string | null,
  countryName?: string | null,
): CountryArtwork {
  const country = resolveCountryIdentity(countryCode, countryName);
  const src = country ? COUNTRY_ARTWORK_BY_CODE[country.code] : undefined;
  if (!country || !src) {
    return {
      src: generalPlanningArtwork,
      alt: 'An illustrated route waiting for a new trip plan',
    };
  }
  return {
    src,
    countryCode: country.code,
    countryName: country.name,
    alt: `An illustrated journey through ${country.name}`,
  };
}

export function countryArtworkForItinerary(itinerary: Itinerary): CountryArtwork {
  const country = resolveTripCountry(itinerary);
  return countryArtworkForCountry(country?.code, country?.name);
}

export function countryArtworkForSummary(summary: {
  countryCode?: string;
  countryName?: string;
}): CountryArtwork {
  return countryArtworkForCountry(summary.countryCode, summary.countryName);
}

export { generalPlanningArtwork };
