import { absoluteUrl, BUSINESS_NAME } from './site-config.mjs';
import { founderSameAs } from './credential.mjs';

export function founderPerson() {
  return {
    '@type': 'Person',
    name: 'Blake Kingsley',
    jobTitle: 'Basketball Skills Coach',
    description: 'College basketball coach who was on staff for the 2025 Horizon League champion Robert Morris Colonials and the 2024 NJCAA Region 16 champion Moberly Area Community College Greyhounds.',
    sameAs: founderSameAs(),
    url: absoluteUrl('/coach-blake-kingsley')
  };
}

export function suburbLocalBusiness(suburb) {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': absoluteUrl('/basketball-training/' + suburb.slug + '#business'),
    name: BUSINESS_NAME + ' - ' + suburb.name,
    description: 'Private and small group basketball skills training in ' + suburb.name + ', ' + suburb.county + ', built around college recruiting goals.',
    url: absoluteUrl('/basketball-training/' + suburb.slug),
    areaServed: { '@type': 'City', name: suburb.name },
    founder: founderPerson(),
    address: { '@type': 'PostalAddress', addressLocality: suburb.name, addressRegion: 'FL', addressCountry: 'US' }
  };
}

export function suburbService(suburb) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    serviceType: 'Private Basketball Skills Training',
    provider: { '@type': 'LocalBusiness', name: BUSINESS_NAME, url: absoluteUrl('/') },
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
