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

// The three cities Blake headlines (September 2026: "South Florida", with Fort Lauderdale,
// Miami and Hollywood as the specifics). They have NO dedicated page and no suburb record:
// their tiles stay on #contact, the footer sends them to /#areas, and they appear in the
// contact select and the LocalBusiness areaServed. Building a page for one needs verified
// local data in src/data/suburbs.json, the same bar the five below cleared.
export const HEADLINE_AREAS = [
  { name: 'Fort Lauderdale', county: 'Broward' },
  { name: 'Miami', county: 'Miami-Dade' },
  { name: 'Hollywood', county: 'Broward' }
];

// Cities WITH a dedicated page. Must stay in lockstep with src/data/suburbs.json: fixAreaLinks
// and the footer build /basketball-training/<slug> links from these names, so a name with no
// matching suburb record is a 404.
export const AREA_SERVED = [
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
// Only the group membership is publicly priced. The evaluation and the 1-on-1 are quoted on
// the call (Blake, September 2026), so they are not offers with a price.
export const OFFERS = [
  { name: 'Group Training Membership', price: '450', maxPrice: '1000', unit: 'per 3 or 6 month term', path: '/training/group-training' }
];

export function absoluteUrl(path) {
  return SITE_URL.replace(/\/$/, '') + path;
}
