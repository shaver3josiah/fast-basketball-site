// The shared reorder registry. P (build) creates this; E (editor) reads it to know
// which selected elements are reorderable and what to label them.
//
// `container` and `item` are CLASS NAMES, matched as whitespace-delimited tokens against
// the real markup in src/templates/sections/*.html — never by substring (`rcp` must not
// match `rcp-c`, `area` must not match `areas`). `count` is the natural item count the
// template ships; `renumberVar` marks the one group (résumé cards) whose `--i` stagger
// hook has to be rewritten to the new visual position after a reorder.
//
// Deliberately excluded (not in this list, and not reorderable): method steps (visible
// 01-05 numerals plus --i would both need renumbering), audience tiles (base.css
// .aud-c:nth-child hard-codes an escalating badge size to position), playbook sample rows
// (hardcoded "Week 1..4" ordinal labels), ticker items (hand-duplicated twice in the DOM
// for the marquee loop).
export const CONTENT_GROUPS = [
  { id: 'rcp', section: 'receipts', label: 'Résumé card', container: 'rcp', item: 'rcp-c', count: 4, renumberVar: true },
  { id: 'prog', section: 'programs', label: 'Program card', container: 'prog', item: 'prog-c', count: 4, renumberVar: false },
  { id: 'cred', section: 'coach', label: 'Credential', container: 'creds', item: 'cred', count: 4, renumberVar: false },
  { id: 'sb', section: 'coach', label: 'Scoreboard tile', container: 'score', item: 'score-c', count: 4, renumberVar: false },
  { id: 'lkr', section: 'resources', label: 'Locker card', container: 'res', item: 'res-c', count: 6, renumberVar: false },
  { id: 'area', section: 'areas', label: 'Area tile', container: 'areas', item: 'area', count: 5, renumberVar: false },
  { id: 'faq', section: 'areas', label: 'FAQ item', container: 'faq', item: 'faq-i', count: 6, renumberVar: false }
];
