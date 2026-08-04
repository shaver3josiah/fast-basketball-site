export const SITE_URL = 'https://SITE-DOMAIN-PENDING.example';

export const BUSINESS_NAME = 'Fast Basketball';

export const AREA_SERVED = [
  'Kendall', 'Pinecrest', 'Coral Gables', 'Doral', 'Westchester', 'Miami Lakes',
  'Palmetto Bay', 'Aventura', 'Weston', 'Pembroke Pines', 'Miramar', 'Cooper City'
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
