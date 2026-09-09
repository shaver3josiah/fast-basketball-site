// /locker: The Locker and the Free Playbook, moved off the homepage in September 2026 (owner's
// call) behind the nav's "The Locker". Same recipe as /playbook in build.mjs. The Locker section
// leads, so its heading becomes the page's h1, and its fold wrapper is gone from resources.html
// because a page whose whole body hides behind a pill is not a page. Both scripts ride along: each
// finds its own section by id and returns when it is absent, which is also why the homepage no
// longer loads them. This lives here rather than inline in build.mjs for the same reason
// coach-page.mjs does: server/functions/preview.mjs renders it for the admin's Preview button.
import { applyTextEdits, applyAttrEdits, applyGroupOrder, fixPlaybookForm, trimToFirstSectionClose, promoteFirstH2, buildSimplePage } from '../render.mjs';
import { breadcrumbList } from './structured-data.mjs';

export function renderLockerPage({ sections, content, prelude, playbookTemplates }) {
  let body = trimToFirstSectionClose(sections.resources) + trimToFirstSectionClose(sections.playbook);
  body = applyTextEdits(body, content.text);
  body = applyAttrEdits(body, content.text);
  body = fixPlaybookForm(body, playbookTemplates);
  body = applyGroupOrder(body, content.order);
  body = '<main id="main">\n' + promoteFirstH2(body) + '</main>\n';
  return buildSimplePage({
    title: 'The Locker: Workouts, Drill Packs and a Free Playbook | Fast Basketball',
    description: 'Workout blocks, drill packs and film guides Coach Blake Kingsley assigns, plus a free four week playbook built for your player. Fast Basketball, South Florida.',
    canonicalPath: '/locker',
    bodyHtml: body,
    content,
    prelude,
    jsonLd: [breadcrumbList([{ name: 'Home', path: '/' }, { name: 'The Locker', path: '/locker' }])],
    extraScripts: ['/js/locker.js', '/js/playbook-form.js']
  });
}
