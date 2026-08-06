// Shape validation for src/data/site.json.
//
// Runs on every save from the editor and is the reason a malformed document cannot
// reach disk. The element-level checks (required fields per type) live in
// canvas-schema.mjs and are reused here so there is one definition of "valid element".

import { ELEMENT_TYPES, validateElement } from './canvas-schema.mjs';

const SLUG = /^\/[a-z0-9/-]*$/;

function validateBox(box, where, errors) {
  if (!box || typeof box !== 'object') { errors.push(where + ': box is required'); return; }
  if (!box.desktop) { errors.push(where + ': a desktop box is required'); return; }
  for (const bp of ['desktop', 'tablet', 'mobile']) {
    const b = box[bp];
    if (b === null || b === undefined) continue;
    for (const key of ['x', 'y', 'w']) {
      if (typeof b[key] !== 'number' || !Number.isFinite(b[key])) {
        errors.push(where + ' (' + bp + '): ' + key + ' must be a number');
      }
    }
    // Coordinates are percentages of the section. Values outside this range are how an
    // element ends up parked off-screen where the owner cannot find it again to fix it.
    if (b.x < -50 || b.x > 150) errors.push(where + ' (' + bp + '): x is off the canvas');
    if (b.y < -50 || b.y > 200) errors.push(where + ' (' + bp + '): y is off the canvas');
    if (b.w <= 0 || b.w > 200) errors.push(where + ' (' + bp + '): width must be between 0 and 200%');
  }
}

export function validateSite(site) {
  const errors = [];
  if (!site || typeof site !== 'object') return ['site.json must be an object'];
  if (!Array.isArray(site.pages)) return ['site.json needs a pages array'];

  const seenPaths = new Set();
  const seenIds = new Set();

  for (const page of site.pages) {
    const where = 'page "' + (page.id || '?') + '"';
    if (!page.id) errors.push(where + ': an id is required');
    if (!page.path || !SLUG.test(page.path)) errors.push(where + ': path must look like /example');
    if (!page.title) errors.push(where + ': a page title is required');
    if (seenPaths.has(page.path)) errors.push(where + ': two pages share the path ' + page.path);
    seenPaths.add(page.path);

    for (const section of page.sections || []) {
      const sw = where + ' section "' + (section.id || '?') + '"';
      if (!section.id) errors.push(sw + ': an id is required');
      if (seenIds.has(section.id)) errors.push(sw + ': duplicate id');
      seenIds.add(section.id);
      if (section.type === 'legacy') continue;

      for (const el of section.elements || []) {
        const ew = sw + ' element "' + (el.id || '?') + '"';
        if (!el.id) errors.push(ew + ': an id is required');
        // Element ids become CSS selectors (#el_x) in the generated stylesheet, so an
        // id that is not a valid identifier silently produces a rule that matches
        // nothing and an element that ignores every style it was given.
        else if (!/^[A-Za-z][\w-]*$/.test(el.id)) errors.push(ew + ': id must start with a letter and contain only letters, numbers, - or _');
        if (seenIds.has(el.id) && el.id) errors.push(ew + ': duplicate id');
        seenIds.add(el.id);
        if (!ELEMENT_TYPES[el.type]) { errors.push(ew + ': unknown type "' + el.type + '"'); continue; }
        validateBox(el.box, ew, errors);
        errors.push(...validateElement(el));
      }
    }
  }
  return errors;
}
