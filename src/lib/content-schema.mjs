export const TEXT_KEYS = [
  'hero.eyebrow', 'hero.lede', 'hero.stat1n', 'hero.stat1l',
  'hero.stat2n', 'hero.stat2l', 'hero.stat3n', 'hero.stat3l',
  'aud.1', 'aud.2', 'aud.3',
  'prog.1', 'prog.2', 'prog.3', 'prog.4',
  'coach.name', 'coach.title', 'coach.p1', 'coach.p2', 'coach.p3',
  'pb.lede',
  'tst.1', 'tst.2', 'tst.3',
  'ct.lede', 'ct.phone', 'ct.email', 'ct.ig', 'ct.area'
];

export const IMAGE_KEYS = [
  'hero.nets', 'rcp.trophy', 'rcp.team', 'rcp.juco', 'rcp.work', 'coach.portrait'
];

export const TEXT_GROUPS = {
  hero: ['hero.eyebrow', 'hero.lede', 'hero.stat1n', 'hero.stat1l', 'hero.stat2n', 'hero.stat2l', 'hero.stat3n', 'hero.stat3l'],
  audience: ['aud.1', 'aud.2', 'aud.3'],
  programs: ['prog.1', 'prog.2', 'prog.3', 'prog.4'],
  coach: ['coach.name', 'coach.title', 'coach.p1', 'coach.p2', 'coach.p3'],
  playbook: ['pb.lede'],
  testimonials: ['tst.1', 'tst.2', 'tst.3'],
  contact: ['ct.lede', 'ct.phone', 'ct.email', 'ct.ig', 'ct.area']
};

export const TEXT_LABELS = {
  'hero.eyebrow': 'Hero eyebrow line',
  'hero.lede': 'Hero opening paragraph',
  'hero.stat1n': 'Hero stat 1 number',
  'hero.stat1l': 'Hero stat 1 label',
  'hero.stat2n': 'Hero stat 2 number',
  'hero.stat2l': 'Hero stat 2 label',
  'hero.stat3n': 'Hero stat 3 number',
  'hero.stat3l': 'Hero stat 3 label',
  'aud.1': 'Middle school audience paragraph',
  'aud.2': 'High school audience paragraph',
  'aud.3': 'College track audience paragraph',
  'prog.1': 'First Look program description',
  'prog.2': 'Private training program description',
  'prog.3': 'Small group program description',
  'prog.4': 'College Track program description',
  'coach.name': 'Coach name',
  'coach.title': 'Coach title',
  'coach.p1': 'Coach bio paragraph 1',
  'coach.p2': 'Coach bio paragraph 2',
  'coach.p3': 'Coach bio paragraph 3',
  'pb.lede': 'Playbook section intro',
  'tst.1': 'Testimonial 1',
  'tst.2': 'Testimonial 2',
  'tst.3': 'Testimonial 3',
  'ct.lede': 'Contact section intro',
  'ct.phone': 'Phone number',
  'ct.email': 'Email address',
  'ct.ig': 'Instagram handle',
  'ct.area': 'Service area line'
};

export const IMAGE_LABELS = {
  'hero.nets': 'Hero photo (net-cutting championship photo)',
  'rcp.trophy': 'Resume card 1 (Horizon League trophy)',
  'rcp.team': 'Resume card 2 (team celebration)',
  'rcp.juco': 'Resume card 3 (NJCAA Region 16)',
  'rcp.work': 'Resume card 4 (working with players)',
  'coach.portrait': 'Coach bio portrait'
};

export const IMAGE_ASPECT_RULES = {
  'hero.nets': { ratio: 0.74, tolerance: 0.18 },
  'rcp.trophy': { ratio: 0.8, tolerance: 0.15 },
  'rcp.team': { ratio: 0.8, tolerance: 0.15 },
  'rcp.juco': { ratio: 0.8, tolerance: 0.15 },
  'rcp.work': { ratio: 0.8, tolerance: 0.15 },
  'coach.portrait': { ratio: 0.8, tolerance: 0.15 }
};

export function validateContentShape(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') return ['payload must be an object'];
  if (!payload.text || typeof payload.text !== 'object') errors.push('text object is required');
  if (!payload.images || typeof payload.images !== 'object') errors.push('images object is required');
  if (errors.length > 0) return errors;
  for (const key of TEXT_KEYS) {
    if (typeof payload.text[key] !== 'string' || payload.text[key].trim() === '') {
      errors.push('text field "' + key + '" is required and must be a non-empty string');
    }
  }
  for (const key of IMAGE_KEYS) {
    const image = payload.images[key];
    if (!image || typeof image !== 'object') {
      errors.push('image field "' + key + '" is required');
      continue;
    }
    if (!image.src || typeof image.src !== 'string') errors.push('image "' + key + '" is missing src');
    if (!image.alt || typeof image.alt !== 'string' || image.alt.trim() === '') errors.push('image "' + key + '" is missing required alt text');
  }
  return errors;
}
