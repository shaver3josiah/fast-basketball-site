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

export const PROGRAM_PAGES = [
  { path: '/training/private', label: 'Private One on One' },
  { path: '/training/small-group', label: 'Small Group' },
  { path: '/training/college-track', label: 'College Track Program' },
  { path: '/training/first-look', label: 'First Look Session' }
];

export function absoluteUrl(path) {
  return SITE_URL.replace(/\/$/, '') + path;
}
