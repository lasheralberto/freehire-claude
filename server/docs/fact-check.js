const norm = (s) =>
  String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

export function checkCvFacts(cv, baseText) {
  const base = norm(baseText);
  const warnings = new Set();
  const names = [
    ...cv.experience.map((e) => e.company),
    ...cv.education.map((e) => e.institution),
    ...cv.certifications,
  ];
  for (const v of names) {
    if (v && !base.includes(norm(v))) warnings.add(`"${v}" no aparece en tu CV base`);
  }
  const dates = [...cv.experience, ...cv.education].flatMap((e) => [e.start, e.end]);
  for (const d of dates) {
    for (const y of String(d || '').match(/\b(19|20)\d{2}\b/g) || []) {
      if (!new RegExp(`\\b${y}\\b`).test(base)) warnings.add(`Año ${y} no aparece en tu CV base`);
    }
  }
  return [...warnings];
}
