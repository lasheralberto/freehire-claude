# CV personalizado y cover letter por oferta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the job drawer, generate an ATS-ready tailored CV PDF and a cover letter PDF for the open offer. Both are saved under `<dataDir>/<slug>/` and built from a base CV the user uploads once.

**Architecture:** A new server-side folder `server/docs/` holds pure, testable units: config, paths, CV-base extraction, schemas, fact-check, PDF render, prompts, and the generation orchestrator. `server/index.js` adds thin Express routes over them. The React app gets a settings panel (data dir, model, CV upload), and `JobDrawer` gets two buttons plus a notes textarea. Generation uses the existing `runClaude()` (local `claude -p`) through dependency injection, so tests never call Claude.

**Tech Stack:** Node 20 ESM, Express 5, React 19 + Vite, `node:test`. New dependencies: `pdfkit` (rendering), `unpdf` (text extraction), `dejavu-fonts-ttf` (Unicode TTF font).

**Spec:** `docs/superpowers/specs/2026-10-19-cv-cover-letter-design.md`

## Global Constraints

- **Disk layout.** Files live at `<dataDir>/_cv-base/cv-base.pdf`, `<dataDir>/_cv-base/cv-base.md`, `<dataDir>/<slug>/cv.pdf` and `<dataDir>/<slug>/cover-letter.pdf`. Regenerating overwrites them.
- **Config file.** `config.json` at the freehire project root, added to `.gitignore`. Shape: `{ "dataDir": string, "docModel": "haiku"|"sonnet"|"opus" }`. Default `docModel` is `"sonnet"`.
- **Safe paths.** Never write outside `dataDir`. The slug folder name may only contain `[A-Za-z0-9._-]`.
- **Generated content.**
  - Use only facts found in `cv-base.md`.
  - Write in the language of the job posting.
  - Translate titles, descriptions, bullets and headings.
  - Never translate company, institution or certification names.
  - For official degrees, keep the original name and add the translation in parentheses.
- **Cover letter.** 250–400 words, 1 page, 3–4 paragraphs. Motivation comes only from the user's notes. Company and role facts come only from the posting.
- **PDF.**
  - Single column, using embedded DejaVu Sans TTF (regular + bold) with body text at 10–11 pt.
  - No tables, images or icons, and no data in headers or footers.
  - PDF metadata: Title and Author are both the candidate name.
- **CV upload.** 10 MB limit, `application/pdf` only.
- **Job details.** Fetch the job with `max_description_chars: 50000`.
- **Claude.** Document generation uses a 300 000 ms timeout and retries once on invalid JSON.
- **UI.** Copy is in Spanish and reuses the existing `.btn` / `.btn--primary` classes.
- **No git.** There is no git repo, so the plan has no commit steps. Each task ends with `npm test` green.

## Review Focus

1. **Not configured** (no `dataDir` or no `cv-base.md`): generation returns 409 with a Spanish message naming what is missing, and the UI points to Ajustes. Tested in Task 5.
2. **Hostile or odd slug** (`../evil`, `a/b`, `con:x`): the slug is sanitized and contained inside `dataDir`, and never escapes it. Tested in Task 1.
3. **Model returns prose or invalid JSON**: one retry, then a clear error (502). Tested in Task 5.
4. **Scanned or image-only PDF upload** (no extractable text): the upload is rejected with "No se pudo extraer texto del PDF" and nothing is overwritten. Tested in Task 2.
5. **Non-Latin characters** (`Łódź`, `Müller`, `Ørsted`, `İstanbul`): they render and can be extracted from the generated PDF. Tested in Task 4.

---

### Task 1: Config and safe paths

**Files:**
- Create: `server/docs/config.js`, `server/docs/paths.js`
- Modify: `.gitignore` (add `config.json`)
- Test: `test/docs-config.test.js`

**Interfaces:**
- Produces, in `config.js`:
  - `MODELS = ['haiku','sonnet','opus']`.
  - `class HttpError extends Error { constructor(status: number, message: string) }`. It is reused by every later task.
  - `loadConfig(file: string) => { dataDir: string|null, docModel: string }`. A missing or corrupt file returns `{ dataDir: null, docModel: 'sonnet' }`.
  - `saveConfig(file: string, patch: { dataDir?, docModel? }) => Promise<config>`:
    - Merges the patch into the current config.
    - `dataDir` must be absolute (`path.isAbsolute`), otherwise throw `HttpError(400, 'La carpeta debe ser una ruta absoluta')`.
    - Creates `dataDir` with `mkdir -p`. If the path exists but is not a directory, throw `HttpError(400)`.
    - A `docModel` not in `MODELS` throws `HttpError(400)`.
    - Writes pretty-printed JSON.
- Produces, in `paths.js`:
  - `CV_BASE_DIR = '_cv-base'`.
  - `offerDir(dataDir: string, slug: string) => string`:
    - Replaces every character outside `[A-Za-z0-9._-]` with `_`.
    - Rejects an empty, `.` or `..` result with `HttpError(400)`.
    - Resolves the path and asserts it starts with `resolve(dataDir) + sep`.

- [ ] **Step 1: Write failing tests.** Use a temp dir from `mkdtemp(join(tmpdir(), 'fh-'))`.
  - `loadConfig` on a missing file returns `{ dataDir: null, docModel: 'sonnet' }`.
  - `saveConfig` with the relative path `'data'` rejects with status 400.
  - `saveConfig({ dataDir: <tmp>/nested/dir })` creates the dir, and `loadConfig` returns it.
  - A second call, `saveConfig({ docModel: 'opus' })`, keeps the `dataDir`.
  - `saveConfig({ docModel: 'gpt' })` rejects with 400.
  - `offerDir(root, 'senior-dev-acme_123')` equals `join(root, 'senior-dev-acme_123')`.
  - `offerDir(root, '../evil')` starts with `root + sep`.
  - `offerDir(root, 'a/b')` equals `join(root, 'a_b')`.
  - `offerDir(root, '..')` throws.
- [ ] **Step 2:** Run `npm test`. The new tests FAIL (module not found).
- [ ] **Step 3:** Implement `config.js` and `paths.js`, and add `config.json` to `.gitignore`.
- [ ] **Step 4:** Run `npm test`. All tests PASS.

### Task 2: CV base upload and text extraction

**Files:**
- Create: `server/docs/cv-base.js`
- Modify: `package.json` (add `unpdf`)
- Test: `test/docs-cv-base.test.js`

**Interfaces:**
- Consumes: `CV_BASE_DIR` and `HttpError` (Task 1).
- Produces:
  - `extractPdfText(buffer: Buffer) => Promise<string>`. Call `unpdf`'s `extractText(new Uint8Array(buffer), { mergePages: false })`, join the pages with `\n\n` and trim.
  - `saveCvBase(dataDir: string, buffer: Buffer, { extract = extractPdfText } = {}) => Promise<{ pdfPath, mdPath, chars }>`:
    - Check that the buffer starts with the `%PDF-` header, otherwise throw `HttpError(400, 'El archivo no es un PDF')`.
    - Extract the text before writing anything.
    - If the text has fewer than 50 characters, throw `HttpError(422, 'No se pudo extraer texto del PDF (¿es un escaneo?)')` and write nothing.
    - Write both files to `<dataDir>/_cv-base/`.
  - `readCvBase(dataDir: string) => Promise<string|null>`. Reads `cv-base.md` and returns `null` when the file is missing or blank.

- [ ] **Step 1:** Run `npm install unpdf`.
- [ ] **Step 2: Write failing tests.**
  - A buffer that does not start with `%PDF-` rejects with 400.
  - `saveCvBase(dir, Buffer.from('%PDF-1.4 x'), { extract: async () => '' })` rejects with 422, and `<dir>/_cv-base` does not exist afterwards.
  - With `extract: async () => 'Jane Doe\n' + 'x'.repeat(100)`, both files exist and `readCvBase(dir)` returns that text.
  - `readCvBase` on an empty dir returns `null`.
  - Real extraction is covered by the round-trip test in Task 4.
- [ ] **Step 3:** Run `npm test`. The new tests FAIL.
- [ ] **Step 4:** Implement `cv-base.js`.
- [ ] **Step 5:** Run `npm test`. All tests PASS.

### Task 3: Document schemas and fact-check

**Files:**
- Create: `server/docs/schema.js`, `server/docs/fact-check.js`
- Test: `test/docs-schema.test.js`

**Interfaces:**
- Produces:
  - CV shape:
    ```js
    { language, name, headline, contact: { email, phone, location, links: [] },
      headings: { summary, experience, education, skills, certifications, languages },
      summary, skills: [], experience: [{ title, company, location, start, end, bullets: [] }],
      education: [{ degree, institution, start, end }], certifications: [], languages: [] }
    ```
  - Letter shape: `{ language, name, contact: { email, phone, location, links: [] }, date, recipient, greeting, paragraphs: [], closing, signature }`.
  - `validateCv(obj) => Cv`:
    - Throws `Error` if `name` is not a non-empty string, if `experience` is not an array, or if `headings` is missing.
    - Fills missing arrays with `[]`, missing strings with `''`, and missing `contact.links` with `[]`.
  - `validateLetter(obj) => Letter`. Throws if `name` is empty or if `paragraphs` is not a non-empty array of strings. Fills defaults the same way.
  - `checkCvFacts(cv: Cv, baseText: string) => string[]`:
    - Normalize text: lowercase, NFD with combining marks removed, whitespace collapsed.
    - Every non-empty `experience[].company`, `education[].institution` and `certifications[]` entry must be a substring of the normalized base. Otherwise add `"<valor>" no aparece en tu CV base`.
    - Every year matching `/\b(19|20)\d{2}\b/g` in any `start` or `end` must appear in the base. Otherwise add `Año <yyyy> no aparece en tu CV base`.
    - Return the warnings deduplicated.

- [ ] **Step 1: Write failing tests.**
  - `validateCv({ name: 'A', headings: {}, experience: [] })` returns an object with `skills: []` and `contact.links: []`.
  - `validateCv({})` throws.
  - `validateLetter({ name: 'A', paragraphs: [] })` throws.
  - For `checkCvFacts`, use the base `'Ingeniero en Telefónica 2019 - 2023, Universidad Politécnica de Madrid'`:
    - Company `'Telefonica'` (no accent), start `'2019'` and end `'2023'` return `[]`.
    - Company `'Google'` returns one warning containing `Google`.
    - End `'2024'` returns one warning containing `2024`.
    - End `'Present'` adds no year warning.
- [ ] **Step 2:** Run `npm test`. The new tests FAIL.
- [ ] **Step 3:** Implement both files.
- [ ] **Step 4:** Run `npm test`. All tests PASS.

### Task 4: ATS PDF rendering

**Files:**
- Create: `server/docs/render.js`
- Modify: `package.json` (add `pdfkit` and `dejavu-fonts-ttf`)
- Test: `test/docs-render.test.js`

**Interfaces:**
- Consumes: the `Cv` and `Letter` shapes (Task 3). `extractPdfText` (Task 2) is used in tests only.
- Produces:
  - `renderCvPdf(cv: Cv) => Promise<Buffer>`
  - `renderLetterPdf(letter: Letter) => Promise<Buffer>`

**Implementation notes:**
- Create the document with `new PDFDocument({ size: 'A4', margin: 50, info: { Title: name, Author: name } })`.
- Fonts:
  - Register regular and bold from the `dejavu-fonts-ttf` package.
  - Find the package directory with `createRequire(import.meta.url)` and `dirname(require.resolve('dejavu-fonts-ttf/package.json'))`.
  - Check the actual filenames after install (expected `ttf/DejaVuSans.ttf` and `ttf/DejaVuSans-Bold.ttf`).
- Collect the `data` chunks into a Buffer and resolve on `end`.
- Use `doc.text` only. Do not use `doc.image`, tables, or headers/footers.

**CV layout, top to bottom:**
1. Name, bold, 18 pt.
2. Headline, 11 pt.
3. One plain contact line: email · phone · location · links.
4. Each non-empty section, in order: summary, experience, education, skills, certifications, languages.
   - The section title is `headings.*`, bold 12 pt, followed by a thin rule.
   - Skills are comma-joined.
   - Each experience entry is `title — company` in bold, then `location · start – end`, then the bullets prefixed with `• `.
   - Body text is 10.5 pt.

**Letter layout:** name (bold), contact line, date, recipient, greeting, paragraphs at 11 pt with `paragraphGap: 8`, closing, signature.

- [ ] **Step 1:** Run `npm install pdfkit dejavu-fonts-ttf`, then confirm that both TTF files exist.
- [ ] **Step 2: Write failing tests.**
  - Fixture CV:
    - `name: 'Zoë Müller'`.
    - One experience with company `'Ørsted'` and location `'Łódź'`.
    - One education entry with institution `'Boğaziçi Üniversitesi, İstanbul'`.
    - `headings.experience: 'Professional Experience'`.
  - `renderCvPdf(fixture)` returns a buffer starting with `%PDF-`. `extractPdfText` of that buffer contains `Zoë Müller`, `Ørsted`, `Łódź`, `İstanbul` and `Professional Experience`.
  - For a fixture letter, the text extracted from `renderLetterPdf(fixture)` contains the first 20 characters of every paragraph.
- [ ] **Step 3:** Run `npm test`. The new tests FAIL.
- [ ] **Step 4:** Implement `render.js`.
- [ ] **Step 5:** Run `npm test`. All tests PASS. Also write one fixture PDF to a temp file and open it to check the layout visually: single column, nothing clipped, 1–2 pages.

### Task 5: Prompts and generation orchestrator

**Files:**
- Create: `server/docs/prompts.js`, `server/docs/generate.js`
- Modify: `mcp/src/claude-cli.js:51,73`. Add an optional `timeoutMs = TIMEOUT_MS` to the `runClaude` options and use it for the kill timer. Existing callers stay unchanged.
- Test: `test/docs-generate.test.js`

**Interfaces:**
- Consumes:
  - `loadConfig`, `HttpError`, `offerDir` (Task 1)
  - `readCvBase` (Task 2)
  - `validateCv`, `validateLetter`, `checkCvFacts` (Task 3)
  - `renderCvPdf`, `renderLetterPdf` (Task 4)
  - `parseJsonObject` from `mcp/src/sampling.js`
- Produces:
  - `buildCvPrompt({ cvBase: string, job: object }) => { systemPrompt: string, prompt: string }`
  - `buildLetterPrompt({ cvBase, job, notes: string, today: string /* YYYY-MM-DD */ }) => { systemPrompt, prompt }`
  - `generateDocument(opts) => Promise<{ path: string, file: 'cv.pdf'|'cover-letter.pdf', warnings: string[], model: string }>`. The options are:
    - `kind: 'cv'|'cover-letter'`
    - `slug`
    - `notes = ''`
    - `config`
    - `getJob: (slug) => Promise<job>`
    - `runClaude: ({prompt, systemPrompt, model, timeoutMs}) => Promise<{text, model}>`
    - `today = new Date().toISOString().slice(0,10)`

**Prompt contents:**
- The system prompt states, word for word, every content rule from Global Constraints: base-CV facts only (include the phrase "No inventes"), the language and translation rules, the letter motivation rules, and the word count.
- The system prompt demands **only** a JSON object of the Task 3 shape and includes the shape as an example. The CV prompt asks for `headings` in the target language.
- The user prompt wraps each input in tags:
  - `<cv_base>…</cv_base>`
  - `<job>…</job>`, holding title, company, location, description and enrichment as JSON
  - `<notes>…</notes>`, letter only, with "(sin notas)" when blank
- The letter prompt passes `today` and asks for `date` formatted in the target language.

**generateDocument flow:**
1. If `config.dataDir` is not set, throw `HttpError(409, 'Configura la carpeta de datos en Ajustes')`.
2. Read `cvBase = await readCvBase(dataDir)`. If it is null, throw `HttpError(409, 'Sube tu CV base en Ajustes')`.
3. Fetch `job = await getJob(slug)`.
4. Build the prompt and call `runClaude` with `model: config.docModel, timeoutMs: 300_000`.
5. Run `parseJsonObject`, then validate.
   - On any parse or validate error, retry once with the same prompt plus `"\n\nTu respuesta anterior no era JSON válido. Devuelve SOLO el objeto JSON."`.
   - If the retry also fails, throw `HttpError(502, 'El modelo no devolvió un documento válido')`.
6. For the CV, `warnings = checkCvFacts(cv, cvBase)`. For the letter, `warnings = []`.
7. Render the PDF, run `mkdir -p` on `offerDir(...)`, and write the file.
8. Return the result.

- [ ] **Step 1: Write failing tests.** Each test uses a temp `dataDir`, a fake `getJob` that returns `{ title:'Dev', company:'Acme', description:'...' }`, and a fake `runClaude` that records its calls.
  - With no `dataDir`, the call rejects with 409.
  - With `dataDir` but no CV base, it rejects with 409, and the message contains `CV base`.
  - Happy-path CV (the fake returns a valid CV as fenced JSON, with a company found in the base):
    - `<dataDir>/<slug>/cv.pdf` exists and starts with `%PDF-`.
    - `warnings` is `[]`.
    - The fake was called with `model === config.docModel` and `timeoutMs === 300000`.
  - An invented company gives `warnings.length === 1`, and the file is still written.
  - The fake returns `'lo siento'` and then valid JSON:
    - The call succeeds after two fake calls.
    - The second prompt contains `SOLO el objeto JSON`.
  - The fake always returns `'lo siento'`: the call rejects with 502.
  - Cover letter with `notes: 'Me encanta su producto'`:
    - `cover-letter.pdf` is written.
    - The fake's prompt contains `Me encanta su producto` and the `today` value.
  - The `buildCvPrompt` system prompt contains `No inventes` and the rule against translating company names.
- [ ] **Step 2:** Run `npm test`. The new tests FAIL.
- [ ] **Step 3:** Add `timeoutMs` to `runClaude`, then implement `prompts.js` and `generate.js`.
- [ ] **Step 4:** Run `npm test`. All tests PASS, including the 6 existing ones.

### Task 6: Bridge routes

**Files:**
- Modify: `server/index.js`. Add the imports, then add the routes after line 149, before the agentic-search route.

**Interfaces:**
- Consumes: Tasks 1–5, the existing `callJsonTool` (`server/index.js:73`) and the existing `runClaude` import.
- Produces the HTTP API used by Tasks 7–8:
  - `CONFIG_FILE = process.env.FREEHIRE_CONFIG || join(ROOT, 'config.json')`.
  - `GET /api/config` returns `{ dataDir, docModel, models: MODELS, hasCvBase: boolean, cvBaseMdPath: string|null }`.
  - `PUT /api/config` takes `{ dataDir?, docModel? }` and returns the same shape as `GET /api/config`.
  - `POST /api/cv-base`:
    - Uses `express.raw({ type: 'application/pdf', limit: '10mb' })`.
    - Returns 409 if `dataDir` is not set.
    - Returns `{ mdPath, chars }`.
  - `POST /api/jobs/:slug/cv` and `POST /api/jobs/:slug/cover-letter`:
    - Body: `{ notes? }`.
    - Call `generateDocument` with `getJob: (slug) => callJsonTool('get_job', { slug, max_description_chars: 50000 })` and the real `runClaude`.
    - Return `{ path, file, warnings, model, url: '/api/files/<slug>/<file>' }`.
  - `GET /api/files/:slug/:file`:
    - `file` must be `cv.pdf` or `cover-letter.pdf`, otherwise return 404.
    - Send the file with `res.sendFile(join(offerDir(dataDir, slug), file))`, or return 404 if it does not exist.
  - Every handler maps `HttpError` to its status and anything else to 500, with the body `{ error: message }`.

- [ ] **Step 1:** Implement the routes.
- [ ] **Step 2:** Run `npm test`. All tests PASS. The routes are thin; their logic is covered by Tasks 1–5.
- [ ] **Step 3: Smoke-test with `npm run server`:**
  - `curl -s localhost:8787/api/config` returns `dataDir: null`.
  - A `PUT` with `{"dataDir":"<tmp>/fh-data"}` creates that folder.
  - `curl -s -X POST localhost:8787/api/jobs/x/cv` returns 409 with `Sube tu CV base en Ajustes`.
  - `curl -s localhost:8787/api/files/x/evil.txt` returns 404.

### Task 7: Settings panel in the web app

**Files:**
- Create: `web/src/settings.jsx`
- Modify:
  - `web/src/api.js` (client functions)
  - `web/src/App.jsx:260-297` (header button and panel state)
  - `web/src/styles.css` (panel styles that reuse the drawer look)

**Interfaces:**
- Consumes: the Task 6 HTTP API.
- Produces, in `api.js`:
  - `getConfig()`
  - `saveConfig(patch)` (PUT with a JSON body)
  - `uploadCvBase(file: File)` (POST with `content-type: application/pdf` and the file as the body)
  - `generateDoc(slug, kind: 'cv'|'cover-letter', notes?)` (POST with a JSON body)
  - Each function throws `Error(body.error)` when the response is not ok, following the existing `getJson` pattern.
- Produces `SettingsPanel({ open, onClose, onChange(config) })` in `settings.jsx`, containing:
  - A "Carpeta de datos" text input with a "Guardar" button.
  - A "Modelo para CV y cover letter" `<select>` filled from `config.models`.
  - A "Subir CV base (PDF)" file input with `accept="application/pdf"`, disabled until `dataDir` is set.
  - A status line: "CV base cargado · puedes revisar/corregir el texto en <cvBaseMdPath>", or "Aún no has subido tu CV base".
  - Errors shown with the `.error` class.
- In `App`:
  - Hold `config` in state and load it with `getConfig()` on mount.
  - Add an "⚙ Ajustes" `.btn` to the header, before the status pill.
  - Pass `config` and `openSettings` to `JobDrawer`.

- [ ] **Step 1:** Implement the api functions, `SettingsPanel` and the App wiring.
- [ ] **Step 2:** Run `npm run build`. It completes with no errors.
- [ ] **Step 3: Check by hand with `npm run dev`:**
  - Set the folder and reload the page: the folder is still set, persisted in `config.json`.
  - Change the model and reload: the new model is still selected.
  - Upload a real PDF CV: `_cv-base/cv-base.pdf` and `cv-base.md` appear, and the status line shows the path.
  - Upload an image-only PDF: the "No se pudo extraer texto…" message appears.

### Task 8: Generate buttons in the job drawer

**Files:**
- Modify: `web/src/components.jsx:117-188` (`JobDrawer`, plus a new `DocActions` in the same file) and `web/src/styles.css`.

**Interfaces:**
- Consumes: `generateDoc` (Task 7), plus the `config` and `openSettings` props passed from `App` (Task 7).
- Produces: `DocActions({ slug, config, openSettings })`, rendered right after the "Ver oferta original ↗" link (line 165).

**DocActions behaviour:**
- Two `.btn` buttons, "📄 Generar CV" and "✉ Cover letter".
- An optional `<textarea>` labelled "Notas para la cover letter (por qué me interesa)".
- Each button has its own state `{ status: 'idle'|'busy'|'done'|'error', result?, error? }`:
  - While busy, the button is disabled and reads "Generando…".
  - When done, show the file path, an "Abrir" link to `result.url` (`target="_blank"`), and one "⚠ Revisa: …" line per warning.
  - On error, show the error message.
- If `!config?.dataDir || !config?.hasCvBase`:
  - The buttons stay enabled, but clicking them calls `openSettings()` instead of generating.
  - A muted hint says what is missing.
- All state resets when `slug` changes.

- [ ] **Step 1:** Implement `DocActions` and render it in `JobDrawer`.
- [ ] **Step 2:** Run `npm run build`. It completes with no errors.
- [ ] **Step 3: Manual end-to-end check with `npm run dev`.** Open one offer in English and one in Spanish:
  - Generate the CV and the cover letter, with notes. Both PDFs appear in `<dataDir>/<slug>/`, and "Abrir" shows them.
  - The English offer produces an English CV, company names are left untranslated, and the text can be selected.
  - Regenerating overwrites the files.
  - With no CV base, clicking a button opens Ajustes.
- [ ] **Step 4:** Run `npm test`. All tests PASS.
