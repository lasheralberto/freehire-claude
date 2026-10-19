const str = (v) => (typeof v === 'string' ? v : '');
const arr = (v) => (Array.isArray(v) ? v : []);
const strs = (v) => arr(v).filter((x) => typeof x === 'string');
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

function contact(c) {
  c = obj(c);
  return { email: str(c.email), phone: str(c.phone), location: str(c.location), links: strs(c.links) };
}

export function validateCv(o) {
  o = obj(o);
  if (typeof o.name !== 'string' || !o.name.trim()) throw new Error('CV: name vacío');
  if (!Array.isArray(o.experience)) throw new Error('CV: experience debe ser un array');
  if (!o.headings || typeof o.headings !== 'object') throw new Error('CV: falta headings');
  const h = o.headings;
  return {
    language: str(o.language),
    name: o.name,
    headline: str(o.headline),
    contact: contact(o.contact),
    headings: {
      summary: str(h.summary),
      experience: str(h.experience),
      education: str(h.education),
      skills: str(h.skills),
      certifications: str(h.certifications),
      languages: str(h.languages),
    },
    summary: str(o.summary),
    skills: strs(o.skills),
    experience: o.experience.map((e) => {
      e = obj(e);
      return {
        title: str(e.title), company: str(e.company), location: str(e.location),
        start: str(e.start), end: str(e.end), bullets: strs(e.bullets),
      };
    }),
    education: arr(o.education).map((e) => {
      e = obj(e);
      return { degree: str(e.degree), institution: str(e.institution), start: str(e.start), end: str(e.end) };
    }),
    certifications: strs(o.certifications),
    languages: strs(o.languages),
  };
}

export function validateLetter(o) {
  o = obj(o);
  if (typeof o.name !== 'string' || !o.name.trim()) throw new Error('Carta: name vacío');
  if (!Array.isArray(o.paragraphs) || !o.paragraphs.length || !o.paragraphs.every((p) => typeof p === 'string')) {
    throw new Error('Carta: paragraphs debe ser un array no vacío de strings');
  }
  return {
    language: str(o.language),
    name: o.name,
    contact: contact(o.contact),
    date: str(o.date),
    recipient: str(o.recipient),
    greeting: str(o.greeting),
    paragraphs: o.paragraphs,
    closing: str(o.closing),
    signature: str(o.signature),
  };
}
