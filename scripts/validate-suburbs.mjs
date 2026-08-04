import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateSuburbs, formatErrors } from '../src/lib/validate-suburbs.mjs';

function main() {
  const arg = process.argv[2] || 'src/data/suburbs.json';
  const path = resolve(arg);
  const records = JSON.parse(readFileSync(path, 'utf8'));
  const errors = validateSuburbs(records);
  if (errors.length > 0) {
    console.error('suburbs.json validation failed with ' + errors.length + ' error(s):');
    console.error(formatErrors(errors));
    process.exit(1);
  }
  console.log('suburbs.json valid: ' + records.length + ' record(s) passed validation.');
}

main();
