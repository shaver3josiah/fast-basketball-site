function joinList(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return items[0] + ' and ' + items[1];
  return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
}

export function schoolsProse(suburb) {
  const parts = [];
  if (suburb.high_schools && suburb.high_schools.length > 0) {
    const names = suburb.high_schools.map((h) => h.name);
    parts.push('The high school game in ' + suburb.name + ' runs through ' + joinList(names) + '.');
    for (const h of suburb.high_schools) {
      if (h.note) parts.push(h.name + ': ' + h.note);
    }
  }
  if (suburb.middle_schools && suburb.middle_schools.length > 0) {
    const names = suburb.middle_schools.map((m) => m.name);
    parts.push('Middle schoolers mostly come up through ' + joinList(names) + '. That is the age to fix a habit, before a varsity tryout finds it first.');
  }
  return parts.join(' ');
}

export function venuesProse(suburb) {
  if (!suburb.training_venues || suburb.training_venues.length === 0) return '';
  const parts = ['In ' + suburb.name + ', sessions run at ' + joinList(suburb.training_venues.map((v) => v.name)) + '.'];
  for (const v of suburb.training_venues) {
    let sentence = v.name + ' is a ' + v.type + ' with ' + v.courts + ' courts';
    if (v.address) sentence += ' at ' + v.address;
    sentence += '.';
    if (v.note) sentence += ' ' + v.note;
    parts.push(sentence);
  }
  return parts.join(' ');
}

export function drivingProse(suburb) {
  if (suburb.drive_time_from_base_min === null || suburb.drive_time_from_base_min === undefined) return '';
  return 'From ' + suburb.name + ', the drive to a session runs about ' + suburb.drive_time_from_base_min + ' minutes.';
}

export function landmarksProse(suburb) {
  if (!suburb.landmarks || suburb.landmarks.length === 0) return '';
  return suburb.name + ' sessions get booked around the neighborhoods near ' + joinList(suburb.landmarks) + ' — close enough that a school night session does not eat the whole evening.';
}

export function neighborsProse(suburb) {
  if (!suburb.nearest_neighbors || suburb.nearest_neighbors.length === 0) return '';
  const links = suburb.nearest_neighbors.map((slug) => '<a href="/basketball-training/' + slug + '">' + slugToName(slug) + '</a>');
  return 'Families also drive in from ' + joinList(links) + ' for the same weekly slots.';
}

export function whyHereProse(suburb) {
  const tierLine = suburb.tier === 1
    ? suburb.name + ' is core coverage, so weekly recurring slots are easiest to hold here and rarely get bumped.'
    : suburb.name + ' runs on a scheduled rotation, so booking a recurring weekly slot early keeps the same time all season.';
  return 'Coach Blake came to Miami straight off the college side of the recruiting table — two staffs, two championships, an NCAA Tournament run. Every ' + suburb.name + ' session gets that same evaluator’s eye. ' +
    tierLine + ' The method does not change by zip code: screen, isolate, load, read, log. A ' + suburb.name + ' player builds the exact same foundation as every player in the program, just closer to home.';
}

export function slugToName(slug) {
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
