// SITE_URL (explicit override) wins; Netlify's automatic URL env var covers the
// .netlify.app stage; the default is the production domain the business owns.
// build.mjs still hard-fails a production build on a *.example placeholder, so
// never put one back here — set SITE_URL in the Netlify environment instead.
export const SITE_URL = process.env.SITE_URL || process.env.URL || 'https://kingfastbasketball.com';

export const BUSINESS_NAME = 'Fast Basketball';

// Must stay in lockstep with src/data/suburbs.json: the footer builds
// /basketball-training/<slug> links from these names, so a name with no matching
// suburb record is a 404 in the footer of every page.
export const AREA_SERVED = [
  'Coral Springs', 'Parkland', 'Coconut Creek', 'Margate', 'Tamarac'
];

// Order here is the footer "Training" column and the suburb-page program list.
export const PROGRAM_PAGES = [
  { path: '/training/evaluation', label: 'Evaluation Session' },
  { path: '/training/group-training', label: 'Group Training Membership' },
  { path: '/training/private', label: 'Private One on One' },
  { path: '/training/small-group', label: 'Private Small Group' }
];

// One place for how families reach Coach Blake. Values come from the signed training
// agreement and Blake's email signature (docs/source-of-truth/fast-basketball-facts.md).
export const CONTACT = {
  phone: '(503) 686-8371',
  tel: '+15036868371',
  email: 'blake.kingsley@gmail.com'
};

// Published rates, used for the LocalBusiness makesOffer structured data. Amounts must
// match src/templates/sections/programs.html, TRAINING_PAGES in build.mjs and /terms.
export const OFFERS = [
  { name: 'Evaluation Session', price: '50', unit: 'per 60 minute session', path: '/training/evaluation' },
  { name: 'Group Training Membership', price: '480', maxPrice: '2300', unit: 'per 3 or 12 month term', path: '/training/group-training' },
  { name: 'Private One on One', price: '100', unit: 'per hour', path: '/training/private' },
  { name: 'Private Small Group', price: '75', unit: 'per player per hour', path: '/training/small-group' }
];

export function absoluteUrl(path) {
  return SITE_URL.replace(/\/$/, '') + path;
}
