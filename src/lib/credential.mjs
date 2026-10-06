export function renderCredentialBlock() {
  return '' +
    '<div class="credential-block">' +
    '<p class="credential-lede">Coach Blake Kingsley spent the two seasons before founding Fast Basketball on staff for two championship college programs: the 2025 Horizon League champion Robert Morris Colonials and the 2024 NJCAA Region 16 champion Moberly Area Community College Greyhounds. Fifty-one wins combined, two titles, one NCAA Tournament run.</p>' +
    '<p class="credential-links">Verify the record at <a href="https://rmucolonials.com/news/2025/3/12/mens-basketball-horizon-league-champions.aspx" target="_blank" rel="noopener">rmucolonials.com</a> and <a href="https://moberlygreyhounds.com/" target="_blank" rel="noopener">moberlygreyhounds.com</a>. Read the full record on <a href="/coach-blake-kingsley">Coach Blake Kingsley&#39;s page</a>.</p>' +
    '</div>';
}

// The Robert Morris staff page is the one independent page that names him with the staff
// history the site claims, so it is the strongest proof the Person here is that coach.
export function founderSameAs() {
  return [
    'https://www.instagram.com/blakekingsleyjr/',
    'https://rmucolonials.com/sports/mens-basketball/roster/staff/blake-kingsley/212'
  ];
}

// The business's own profiles, which are not the same set as the founder's. The Google
// Business Profile belongs to Fast Basketball, not to Blake, so it is wrong on the Person
// entity: it is the strongest entity-disambiguation signal there is and it has to point at
// the business. The cid URL is the one already linked from contact.html and families.html.
// The Instagram here is the business's own account; Blake's personal one is on the Person.
export const GOOGLE_PROFILE_URL = 'https://www.google.com/maps?cid=8149558339790634144';
export function businessSameAs() {
  return [
    'https://www.instagram.com/fast_basketball/',
    GOOGLE_PROFILE_URL
  ];
}
