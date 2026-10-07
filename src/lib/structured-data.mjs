import { absoluteUrl, BUSINESS_NAME } from './site-config.mjs';
import { founderSameAs, businessSameAs, GOOGLE_PROFILE_URL } from './credential.mjs';

// One stable id per real thing, referenced everywhere else. Inlining a copy of the
// Person or the business on each page creates N unlinked entities instead of one.
export const BUSINESS_ID = absoluteUrl('/#business');
export const PERSON_ID = absoluteUrl('/coach-blake-kingsley#person');

export function founderPerson() {
  return {
    '@type': 'Person',
    '@id': PERSON_ID,
    name: 'Blake Kingsley',
    jobTitle: 'Basketball Skills Coach',
    description: 'College basketball coach who was on staff for the 2025 Horizon League champion Robert Morris Colonials and the 2024 NJCAA Region 16 champion Moberly Area Community College Greyhounds.',
    sameAs: founderSameAs(),
    worksFor: { '@id': BUSINESS_ID },
    url: absoluteUrl('/coach-blake-kingsley')
  };
}

// The canonical business. This ships on the homepage and nowhere else; every other
// page points at BUSINESS_ID. The address is the gym, the one place every session runs and
// the address the Google Business Profile shows; it has to match the profile, because
// that match is how Google ties this entity to the map listing. What the
// per-city version did wrong was invent an address in every city, not publish the real one.
// areaServed comes from the suburb records rather than a parallel city list, so the
// entity can never drift out of sync with the pages that actually exist.
export function businessEntity({ description, offers = [], suburbs, extraAreas = [] }) {
  return {
    '@context': 'https://schema.org',
    '@type': ['LocalBusiness', 'SportsActivityLocation'],
    '@id': BUSINESS_ID,
    name: BUSINESS_NAME,
    slogan: 'Elevate to Execute',
    description,
    url: absoluteUrl('/'),
    priceRange: '$$',
    // Published rates as offers, so a rich result can quote a price without inventing one.
    makesOffer: offers.map((o) => ({
      '@type': 'Offer',
      name: o.name,
      url: absoluteUrl(o.path),
      priceCurrency: 'USD',
      ...(o.maxPrice
        ? { priceSpecification: { '@type': 'PriceSpecification', minPrice: o.price, maxPrice: o.maxPrice, priceCurrency: 'USD' } }
        : { price: o.price }),
      itemOffered: { '@type': 'Service', name: o.name, serviceType: 'Basketball Skills Training', provider: { '@id': BUSINESS_ID } }
    })),
    image: absoluteUrl('/brand/og-image-1200x630.png'),
    logo: absoluteUrl('/brand/logo.svg'),
    address: {
      '@type': 'PostalAddress',
      streetAddress: '100 SW 9th Ave',
      addressLocality: 'Fort Lauderdale',
      addressRegion: 'FL',
      postalCode: '33312',
      addressCountry: 'US'
    },
    // OpenStreetMap's point for 100 SW 9th Ave, October 2026.
    geo: { '@type': 'GeoCoordinates', latitude: 26.1212, longitude: -80.1534 },
    hasMap: GOOGLE_PROFILE_URL,
    // Headline cities first (no page of their own), then every city with a page.
    areaServed: [...extraAreas, ...suburbs].map((s) => ({
      '@type': 'City',
      name: s.name,
      containedInPlace: { '@type': 'AdministrativeArea', name: s.county }
    })),
    founder: { '@id': PERSON_ID },
    employee: { '@id': PERSON_ID },
    sameAs: businessSameAs()
  };
}

// One Service per training page. The page-level counterpart to makesOffer on the business:
// makesOffer says the business sells this, this says the page is about it. Only pages with a
// PUBLIC price carry an `offers` block - the evaluation is quoted on the call (Blake,
// September 2026), and a Service with no offers is correct for it, not incomplete.
export function trainingService({ name, description, path, offer }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': absoluteUrl(path + '#service'),
    name,
    description,
    serviceType: 'Basketball Skills Training',
    provider: { '@id': BUSINESS_ID },
    url: absoluteUrl(path),
    ...(offer
      ? {
          offers: {
            '@type': 'Offer',
            url: absoluteUrl(path),
            priceCurrency: 'USD',
            priceSpecification: {
              '@type': 'PriceSpecification',
              minPrice: offer.price,
              maxPrice: offer.maxPrice,
              priceCurrency: 'USD'
            }
          }
        }
      : {})
  };
}

export function suburbService(suburb) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': absoluteUrl('/basketball-training/' + suburb.slug + '#service'),
    serviceType: 'Private Basketball Skills Training',
    provider: { '@id': BUSINESS_ID },
    areaServed: { '@type': 'City', name: suburb.name, containedInPlace: { '@type': 'AdministrativeArea', name: suburb.county } },
    url: absoluteUrl('/basketball-training/' + suburb.slug)
  };
}

export function breadcrumbList(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path)
    }))
  };
}

// The homepage's WebSite entity is what Google reads for the site name shown above a search
// result. alternateName carries the all-caps form the Google profile and Instagram use.
export function websiteEntity() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': absoluteUrl('/#website'),
    name: BUSINESS_NAME,
    alternateName: 'FAST Basketball',
    url: absoluteUrl('/'),
    publisher: { '@id': BUSINESS_ID }
  };
}

export function faqPage(pairs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: pairs.map((pair) => ({
      '@type': 'Question',
      name: pair.question,
      acceptedAnswer: { '@type': 'Answer', text: pair.answer }
    }))
  };
}

export function jsonLdScript(data) {
  return '<script type="application/ld+json">' + JSON.stringify(data) + '</script>';
}
