import { absoluteUrl, BUSINESS_NAME } from './site-config.mjs';
import { founderSameAs } from './credential.mjs';

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
// page points at BUSINESS_ID. No `address`: this is a service-area business with no
// premises, and asserting one it does not have is what the per-city version did wrong.
// areaServed comes from the suburb records rather than a parallel city list, so the
// entity can never drift out of sync with the pages that actually exist.
export function businessEntity({ description, email, telephone, offers = [], suburbs }) {
  return {
    '@context': 'https://schema.org',
    '@type': ['LocalBusiness', 'SportsActivityLocation'],
    '@id': BUSINESS_ID,
    name: BUSINESS_NAME,
    slogan: 'Elevate to Execute',
    description,
    url: absoluteUrl('/'),
    email,
    telephone,
    priceRange: '$35 - $100 per session',
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
    areaServed: suburbs.map((s) => ({
      '@type': 'City',
      name: s.name,
      containedInPlace: { '@type': 'AdministrativeArea', name: s.county }
    })),
    founder: { '@id': PERSON_ID },
    employee: { '@id': PERSON_ID },
    sameAs: founderSameAs()
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
