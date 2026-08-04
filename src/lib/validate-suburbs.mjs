const VALID_COUNTIES = ['Miami-Dade', 'Broward'];
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function validateSuburb(record, label) {
  const errors = [];
  const name = label || record.slug || record.name || 'unknown record';

  function fail(field, message) {
    errors.push({ record: name, field, message });
  }

  if (!record.name || typeof record.name !== 'string' || record.name.trim() === '') {
    fail('name', 'is required and must be a non-empty string');
  }

  if (!record.slug || typeof record.slug !== 'string' || record.slug.trim() === '') {
    fail('slug', 'is required and must be a non-empty string');
  } else if (!SLUG_PATTERN.test(record.slug)) {
    fail('slug', 'must be lowercase and hyphenated, for example "coral-gables"');
  }

  if (!record.county || !VALID_COUNTIES.includes(record.county)) {
    fail('county', 'is required and must be exactly "Miami-Dade" or "Broward"');
  }

  if (!record.local_paragraph || typeof record.local_paragraph !== 'string' || record.local_paragraph.trim() === '') {
    fail('local_paragraph', 'is required and must be a non-empty string');
  } else {
    const words = wordCount(record.local_paragraph);
    if (words < 90 || words > 130) {
      fail('local_paragraph', 'must be between 90 and 130 words, found ' + words);
    }
  }

  if (!Array.isArray(record.high_schools) || record.high_schools.length < 1) {
    fail('high_schools', 'is required and must contain at least one entry');
  } else if (record.high_schools.some((h) => !h || !h.name)) {
    fail('high_schools', 'every entry must have a name');
  }

  if (!Array.isArray(record.training_venues) || record.training_venues.length < 1) {
    fail('training_venues', 'is required and must contain at least one entry');
  } else if (record.training_venues.some((v) => !v || !v.name)) {
    fail('training_venues', 'every entry must have a name');
  }

  if (!Array.isArray(record.nearest_neighbors) || record.nearest_neighbors.length !== 3) {
    fail('nearest_neighbors', 'is required and must contain exactly 3 slugs, found ' + (Array.isArray(record.nearest_neighbors) ? record.nearest_neighbors.length : 0));
  }

  if (!record.meta_title || typeof record.meta_title !== 'string' || record.meta_title.trim() === '') {
    fail('meta_title', 'is required and must be a non-empty string');
  } else if (record.meta_title.length >= 60) {
    fail('meta_title', 'must be under 60 characters, found ' + record.meta_title.length);
  }

  if (!record.meta_description || typeof record.meta_description !== 'string' || record.meta_description.trim() === '') {
    fail('meta_description', 'is required and must be a non-empty string');
  } else if (record.meta_description.length >= 155) {
    fail('meta_description', 'must be under 155 characters, found ' + record.meta_description.length);
  }

  return errors;
}

export function validateSuburbs(records) {
  if (!Array.isArray(records)) {
    return [{ record: 'suburbs.json', field: 'root', message: 'must be a JSON array of suburb records' }];
  }
  const allErrors = [];
  const seenSlugs = new Set();
  records.forEach((record, index) => {
    const label = record && record.slug ? record.slug : 'record #' + (index + 1);
    allErrors.push(...validateSuburb(record, label));
    if (record && record.slug) {
      if (seenSlugs.has(record.slug)) {
        allErrors.push({ record: label, field: 'slug', message: 'is duplicated across suburb records, slugs must be unique' });
      }
      seenSlugs.add(record.slug);
    }
  });
  return allErrors;
}

export function formatErrors(errors) {
  return errors.map((e) => 'suburb record "' + e.record + '": field "' + e.field + '" ' + e.message).join('\n');
}
