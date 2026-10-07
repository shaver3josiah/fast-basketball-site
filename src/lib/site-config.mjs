// Canonicals, the sitemap and the structured data are built from this. SITE_URL wins; the
// default is fast-basketball.com, the domain Blake bought from Wix in September 2026.
//
// The host moved to Firebase Hosting that month, and Firebase sets no automatic URL
// variable the way Netlify did, so the deploy workflow passes SITE_URL explicitly: the
// firebase web.app address until Wix DNS points at Firebase, the real domain after. It is a
// repository variable in .github/workflows/deploy.yml, so switching it is not a code change.
// build.mjs still hard-fails a production build on a *.example placeholder, so never put
// one back here.
export const SITE_URL = process.env.SITE_URL || 'https://fast-basketball.com';

export const BUSINESS_NAME = 'Fast Basketball';

// Cities served but with no page of their own: the tile stays on #contact, the footer sends
// it to /#areas, and it still appears in the contact select and the LocalBusiness areaServed.
// Miami is held here on purpose (October 2026). Its suburb record is verified and kept in
// docs/held-city-records/miami.json at the project root, but the gym is 25 miles away, every
// sentence on the page would have to say so, and one more far city page is the pattern Google
// reads as a doorway. Paging it is: move the record back into suburbs.json, move the name below.
export const HEADLINE_AREAS = [
  { name: 'Miami', county: 'Miami-Dade' }
];

// Cities WITH a dedicated page. Must stay in lockstep with src/data/suburbs.json: fixAreaLinks
// and the footer build /basketball-training/<slug> links from these names, so a name with no
// matching suburb record is a 404. Fort Lauderdale leads because the gym is there, which is
// also why it is the first tile and the first footer link (AREA_TILE_ORDER in render.mjs).
export const AREA_SERVED = [
  'Fort Lauderdale', 'Hollywood',
  'Coral Springs', 'Parkland', 'Coconut Creek', 'Margate', 'Tamarac'
];

// Order here is the footer "Training" column and the suburb-page program list.
export const PROGRAM_PAGES = [
  { path: '/training/evaluation', label: 'Evaluation Session' },
  { path: '/training/group-training', label: 'Group Training Membership' },
  { path: '/training/private', label: 'Private 1-on-1 Training' }
];

// One place for how families reach Coach Blake. Values come from the signed training
// agreement and Blake's email signature (docs/source-of-truth/fast-basketball-facts.md).
export const CONTACT = {
  phone: '(503) 686-8371',
  tel: '+15036868371',
  email: 'blake@fast-basketball.com'
};

// Published rates, used for the LocalBusiness makesOffer structured data. Amounts must
// match src/templates/sections/programs.html, TRAINING_PAGES in build.mjs and /terms.
// The evaluation is quoted on the call (Blake, September 2026), so it is not an offer with a
// price. Individual training has been publicly priced since 7 October 2026.
export const OFFERS = [
  { name: 'Group Training Membership', price: '450', maxPrice: '1000', unit: 'per 3 or 6 month term', path: '/training/group-training' },
  { name: 'Private 1-on-1 Training', price: '100', maxPrice: '750', unit: 'per session, or per month on a weekly plan', path: '/training/private' }
];

export function absoluteUrl(path) {
  return SITE_URL.replace(/\/$/, '') + path;
}
