// Run: node --test src/lib/reorder.test.mjs
//
// Guards the build-time reorder engine (src/render.mjs's scanBalancedElement,
// reorderGroup, applyGroupOrder), driven against src/lib/content-groups.mjs's real
// registry plus one deliberately-excluded shape (the playbook sample sheet) that proves
// the container scan only ever touches item-classed direct children.

import assert from 'node:assert/strict';
import { scanBalancedElement, reorderGroup, applyGroupOrder } from '../render.mjs';

// ---------------------------------------------------------------- scanBalancedElement

// The crux case: an item tag whose OWN tag name is reused by an element nested inside it.
// A plain /<\/div>/ regex would match the wrong (inner) close tag; the scanner must count
// depth and keep going.
{
  const html = '<div class="wrap"><article class="item" id="a"><div class="outer"><div class="inner">X</div></div>tail</article><p>after</p></div>';
  const openStart = html.indexOf('<article');
  const el = scanBalancedElement(html, openStart);
  const expectedEnd = html.indexOf('</article>') + '</article>'.length;
  assert.equal(el.tagName, 'article');
  assert.equal(el.end, expectedEnd, 'must resolve to the outer </article>, not an inner </div>: ' + html.slice(openStart, el.end));
  assert.equal(html.slice(el.start, el.end), '<article class="item" id="a"><div class="outer"><div class="inner">X</div></div>tail</article>');
}

// Void and self-closing tags never open a nested scope and resolve with no scan at all.
{
  const html = '<div class="wrap"><img class="ph" src="a.jpg"><p>next</p></div>';
  const el = scanBalancedElement(html, html.indexOf('<img'));
  assert.equal(el.tagName, 'img');
  assert.equal(html.slice(el.start, el.end), '<img class="ph" src="a.jpg">');
}
{
  const html = '<svg><path d="M0 0"/><circle r="1"/></svg>';
  const el = scanBalancedElement(html, html.indexOf('<path'));
  assert.equal(html.slice(el.start, el.end), '<path d="M0 0"/>', 'an explicit self-close must not scan forward for a </path>');
}

// ---------------------------------------------------------------- reorderGroup: balanced extraction under a custom group

// Same crux case as above, but through the full extract-reorder-splice pipeline with the
// item tag itself set to <div>, nested with an unrelated inner <div> — the shape a naive
// regex-based splitter cannot parse at all.
{
  const html = '<div class="grp"><div class="x-c" data-k="1"><div>inner one</div>tail1</div><div class="x-c" data-k="2"><div>inner two</div>tail2</div></div>';
  const group = { id: 'x', container: 'grp', item: 'x-c', renumberVar: false };
  const out = reorderGroup(html, group, [1, 0]);
  assert.ok(out.indexOf('data-k="2"') < out.indexOf('data-k="1"'), 'reordered same-tag items must swap position: ' + out);
  assert.ok(out.includes('<div>inner one</div>tail1'), 'nested content of the swapped item must ride along intact: ' + out);
  assert.ok(out.includes('<div>inner two</div>tail2'), 'nested content of the swapped item must ride along intact: ' + out);
}

// ---------------------------------------------------------------- applyGroupOrder: real registry group (rcp), full pipeline

function rcpFixture() {
  return '<div class="rcp stg">' +
    '<article class="rcp-c rise" style="--i:0"><div class="rcp-shot"><img src="a.jpg" alt="A"></div><div class="rcp-txt"><h3>One</h3></div></article>' +
    '<article class="rcp-c rise" style="--i:1"><div class="rcp-shot"><img src="b.jpg" alt="B"></div><div class="rcp-txt"><h3>Two</h3></div></article>' +
    '<article class="rcp-c rise" style="--i:2"><div class="rcp-shot"><img src="c.jpg" alt="C"></div><div class="rcp-txt"><h3>Three</h3></div></article>' +
    '<article class="rcp-c rise" style="--i:3"><div class="rcp-shot"><img src="d.jpg" alt="D"></div><div class="rcp-txt"><h3>Four</h3></div></article>' +
    '</div>';
}

// Reorder produces the items in the requested order, --i renumbers 0..n-1 in that visual
// order, and every item is byte-identical apart from --i/data-gi (its photo, alt and
// heading text never change).
{
  const out = applyGroupOrder(rcpFixture(), { rcp: [2, 0, 1, 3] });
  const headings = [...out.matchAll(/<h3>(\w+)<\/h3>/g)].map((m) => m[1]);
  assert.deepEqual(headings, ['Three', 'One', 'Two', 'Four'], 'visual order must follow order.rcp: ' + out);

  const gi = [...out.matchAll(/data-gi="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(gi, [2, 0, 1, 3], 'data-gi must carry the ORIGINAL index at each new visual slot: ' + out);

  const vars = [...out.matchAll(/--i:(\d+)/g)].map((m) => Number(m[1]));
  assert.deepEqual(vars, [0, 1, 2, 3], '--i must renumber to the new 0-based visual index: ' + out);

  assert.ok(out.includes('data-group="rcp"'), 'every item must carry data-group: ' + out);
  // Untouched apart from the tag's own attributes: photo src/alt for the item that moved
  // to visual slot 0 (originally index 2) must still read exactly as it did.
  assert.ok(out.includes('<img src="c.jpg" alt="C">'), 'item content must move verbatim, byte for byte: ' + out);
}

// ---------------------------------------------------------------- fallback to natural order, never throws

{
  const natural = ['One', 'Two', 'Three', 'Four'];
  const cases = {
    'absent group': {},
    'short array': { rcp: [0, 1] },
    'non-permutation (out of range)': { rcp: [0, 1, 2, 5] },
    'duplicate index': { rcp: [0, 0, 1, 2] }
  };
  for (const [label, order] of Object.entries(cases)) {
    let out;
    assert.doesNotThrow(() => { out = applyGroupOrder(rcpFixture(), order); }, label + ' must never throw');
    const headings = [...out.matchAll(/<h3>(\w+)<\/h3>/g)].map((m) => m[1]);
    assert.deepEqual(headings, natural, label + ' must fall back to natural order: ' + out);
    const gi = [...out.matchAll(/data-gi="(\d+)"/g)].map((m) => Number(m[1]));
    assert.deepEqual(gi, [0, 1, 2, 3], label + ' must still mark natural original indices: ' + out);
  }
}

// ---------------------------------------------------------------- scoping proof: non-item siblings never move

// The playbook sample sheet's shape (.pb-sheet containing a heading, a subtitle, and four
// .pbs-row items) — deliberately excluded from CONTENT_GROUPS (its rows carry hardcoded
// "Week 1..4" labels), used here purely to prove the container scan only ever touches
// item-classed direct children and leaves everything else exactly where it was.
{
  const html = '<div class="pb-sheet">' +
    '<h3 data-edit="pb.sheet.head">Guard Development Playbook</h3>' +
    '<div class="pbs-sub" data-edit="pb.sheet.sub">Sample / 4 Week Block</div>' +
    '<div class="pbs-row"><b>Week 1</b><span>A</span></div>' +
    '<div class="pbs-row"><b>Week 2</b><span>B</span></div>' +
    '<div class="pbs-row"><b>Week 3</b><span>C</span></div>' +
    '<div class="pbs-row"><b>Week 4</b><span>D</span></div>' +
    '</div>';
  const group = { id: 'pbs', container: 'pb-sheet', item: 'pbs-row', renumberVar: false };
  const out = reorderGroup(html, group, [3, 2, 1, 0]);

  assert.ok(out.startsWith('<div class="pb-sheet"><h3 data-edit="pb.sheet.head">Guard Development Playbook</h3>' +
    '<div class="pbs-sub" data-edit="pb.sheet.sub">Sample / 4 Week Block</div>'),
    'the heading and subtitle are non-item siblings and must stay first, untouched: ' + out);

  const weeks = [...out.matchAll(/<b>(Week \d)<\/b>/g)].map((m) => m[1]);
  assert.deepEqual(weeks, ['Week 4', 'Week 3', 'Week 2', 'Week 1'], 'only the .pbs-row items reorder, per [3,2,1,0]: ' + out);
}

console.log('reorder: ok');
