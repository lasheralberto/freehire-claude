import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import PDFDocument from 'pdfkit';

const require = createRequire(import.meta.url);
const FONT_DIR = join(dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const REG = join(FONT_DIR, 'DejaVuSans.ttf');
const BOLD = join(FONT_DIR, 'DejaVuSans-Bold.ttf');

function newDoc(name) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: name, Author: name } });
  doc.registerFont('R', REG);
  doc.registerFont('B', BOLD);
  return doc;
}

function finish(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

const contactLine = (c) => [c.email, c.phone, c.location, ...c.links].filter(Boolean).join(' · ');

function section(doc, title, body) {
  doc.moveDown(0.8);
  doc.font('B').fontSize(12).text(title);
  const y = doc.y + 1;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).lineWidth(0.5).stroke();
  doc.moveDown(0.4);
  doc.font('R').fontSize(10.5);
  body();
}

export function renderCvPdf(cv) {
  const doc = newDoc(cv.name);
  doc.font('B').fontSize(18).text(cv.name);
  if (cv.headline) doc.font('R').fontSize(11).text(cv.headline);
  const cl = contactLine(cv.contact);
  if (cl) doc.font('R').fontSize(10.5).text(cl);
  const h = cv.headings;
  if (cv.summary) section(doc, h.summary, () => doc.text(cv.summary));
  if (cv.experience.length) {
    section(doc, h.experience, () => {
      cv.experience.forEach((e, i) => {
        if (i) doc.moveDown(0.6);
        doc.font('B').text([e.title, e.company].filter(Boolean).join(' — '));
        const when = [e.start, e.end].filter(Boolean).join(' – ');
        const meta = [e.location, when].filter(Boolean).join(' · ');
        doc.font('R');
        if (meta) doc.text(meta);
        for (const b of e.bullets) doc.text(`• ${b}`);
      });
    });
  }
  if (cv.education.length) {
    section(doc, h.education, () => {
      for (const e of cv.education) {
        doc.font('B').text([e.degree, e.institution].filter(Boolean).join(' — '));
        const when = [e.start, e.end].filter(Boolean).join(' – ');
        doc.font('R');
        if (when) doc.text(when);
      }
    });
  }
  if (cv.skills.length) section(doc, h.skills, () => doc.text(cv.skills.join(', ')));
  if (cv.certifications.length) section(doc, h.certifications, () => cv.certifications.forEach((c) => doc.text(c)));
  if (cv.languages.length) section(doc, h.languages, () => doc.text(cv.languages.join(', ')));
  return finish(doc);
}

export function renderLetterPdf(l) {
  const doc = newDoc(l.name);
  doc.font('B').fontSize(11).text(l.name);
  const cl = contactLine(l.contact);
  doc.font('R');
  if (cl) doc.text(cl);
  const gap = { paragraphGap: 8 };
  if (l.date) doc.moveDown().text(l.date, gap);
  if (l.recipient) doc.text(l.recipient, gap);
  if (l.greeting) doc.text(l.greeting, gap);
  for (const p of l.paragraphs) doc.text(p, gap);
  if (l.closing) doc.text(l.closing, gap);
  if (l.signature) doc.text(l.signature);
  return finish(doc);
}
