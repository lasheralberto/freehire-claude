# CV personalizado y cover letter por oferta — Diseño

Fecha: 2026-10-19

## Intención

El usuario quiere, desde el detalle de una oferta en FreeHire, generar con un clic un CV adaptado a esa oferta y una cover letter, ambos en PDF ATS-ready, guardados en disco local organizados por oferta. Hoy adapta el CV a mano; esto lo automatiza partiendo de su CV base.

## Objetivos

1. El usuario indica en la app una **carpeta raíz local** (campo input). Se persiste en un archivo de configuración y se recuerda entre arranques.
2. El usuario **sube su CV base en PDF** desde la app. Se guarda en la carpeta raíz.
3. En el detalle de cada oferta (`JobDrawer`, `web/src/components.jsx`) hay dos botones nuevos: **"Generar CV"** y **"Cover letter"**.
4. Cada botón genera un PDF adaptado a la oferta abierta y lo guarda en `<raíz>/<slug>/`.
5. Ambos PDF son **ATS-ready**.

## No-objetivos (por ahora)

- Seguimiento de candidaturas, historial, estados, listado de documentos generados.
- Editar el CV generado dentro de la app.
- Varios CV base / perfiles.
- Envío automático de candidaturas.
- Plantillas visuales elegibles.

## Anti-objetivos (sería un fracaso aunque funcione)

- **Inventar experiencia, títulos, certificaciones, fechas o skills** que no están en el CV base. Se permite reordenar, resaltar, resumir y reformular con vocabulario de la oferta; nunca añadir hechos.
- PDFs que un ATS no pueda parsear: texto como imagen, multicolumna, tablas para maquetar, iconos/gráficos, cabeceras/pies con datos clave, fuentes no estándar.
- Escribir fuera de la carpeta raíz configurada.

## Contexto existente (relevante para el builder)

- Stack: JS ESM, React 19 + Vite (`web/`), bridge Express 5 (`server/index.js`, puerto 8787) que habla con un servidor MCP (`mcp/`). Sin BD; ofertas en vivo de `https://freehire.me/api/v1`.
- ID de oferta = `slug` (`job.public_slug`). Detalle completo vía `getJob(slug)` / tool `get_job` (incluye `description` en texto plano y `enrichment`).
- LLM: CLI local de Claude Code vía `runClaude()` en `mcp/src/claude-cli.js` (sin API key). `parseJsonObject()` en `mcp/src/sampling.js` extrae JSON de la respuesta.
- Persistencia actual: solo `localStorage` para historial de búsquedas.
- Tests: `node --test` en `test/`.

## Decisiones tomadas por el usuario

- Solo generar los dos PDF por oferta (sin más gestión).
- Todo organizado en carpetas locales bajo un directorio raíz; **carpeta por oferta nombrada con su id** (el `slug`).
- La carpeta raíz la introduce el usuario en un **input** de la app y se **guarda en un archivo de config** para recordarla.
- El CV base existe en **PDF**.
- Idioma del documento generado = idioma de la oferta.
- Confirmó: Claude adapta sin inventar.
- **Cover letter:** campo opcional de notas por oferta ("por qué me interesa") junto al botón. Claude usa esas notas + CV base + datos de la empresa/rol que aparecen en el texto de la oferta. Nada más. Si las notas están vacías, carta sobria centrada en encaje técnico, sin motivaciones inventadas.
- **Modelo:** seleccionable por el usuario con un **selector de modelo en la configuración** (haiku / sonnet / opus), persistido en `config.json`. Default: `sonnet`.
- **Traducción:** si el idioma de la oferta difiere del CV base, se traducen puestos, descripciones, bullets y encabezados. Nombres de empresas, universidades/centros y certificaciones nunca se traducen. Titulaciones oficiales: nombre original + traducción entre paréntesis.

## Diseño

### Estructura en disco

```
<raíz>/
  _cv-base/
    cv-base.pdf      # PDF original subido
    cv-base.md       # texto extraído; fuente de verdad para Claude, editable a mano
  <slug>/
    cv.pdf
    cover-letter.pdf
```

Regenerar sobrescribe. Subir un nuevo CV base sustituye ambos ficheros de `_cv-base/`.

### Configuración

- Archivo `config.json` en la raíz del proyecto freehire (añadir a `.gitignore`), p. ej. `{ "dataDir": "C:\\Users\\...\\freehire-data", "docModel": "sonnet" }`. *(Ubicación: decisión del diseñador.)*
- Endpoints en el bridge:
  - `GET /api/config` → `{ dataDir, docModel, hasCvBase }`.
  - `PUT /api/config` `{ dataDir?, docModel? }` → valida ruta absoluta; crea la carpeta si no existe; valida modelo ∈ {haiku, sonnet, opus}; guarda config.
- UI: botón "Ajustes" / "Mi CV" en la cabecera que abre un panel con: input de carpeta raíz, **selector de modelo** para la generación de documentos, y subida del CV base (Guardar). Indica si ya hay CV base cargado.
- El selector afecta solo a la generación de CV/cover letter; la búsqueda IA existente mantiene su propio selector.

### CV base

- `POST /api/cv-base` (PDF en el cuerpo, `application/pdf`, límite razonable p. ej. 10 MB) → guarda `cv-base.pdf`, extrae texto a `cv-base.md`.
- Extracción de texto: librería JS de extracción de PDF (p. ej. `unpdf` o `pdfjs-dist`). *(Decisión del builder.)*
- La UI avisa de que `cv-base.md` puede revisarse/corregirse a mano y muestra su ruta.

### Generación

- `POST /api/jobs/:slug/cv` y `POST /api/jobs/:slug/cover-letter`.
- Flujo: cargar config (error claro si no hay `dataDir` o no hay CV base) → `getJob(slug)` con descripción completa → `runClaude` con prompt de sistema + CV base + oferta → JSON estructurado → render PDF → escribir en `<raíz>/<slug>/` → responder `{ path }`.
- Sanitizar `slug` para nombre de carpeta (solo `[A-Za-z0-9._-]`) y verificar que la ruta final queda dentro de `dataDir`.
- Modelo: `docModel` de la config. Timeout amplio (la generación es más larga que una búsqueda).
- Descripción de la oferta completa: pedir `max_description_chars` alto (p. ej. 50000) en vez del default de 8000.
- Cover letter: el POST acepta `{ notes?: string }` en el cuerpo.

**Control anti-invención (decisión del diseñador):** tras generar el CV, comprobar en código que cada empresa, centro de formación, certificación y rango de fechas del JSON aparece en `cv-base.md` (comparación normalizada: minúsculas, sin acentos; empresas/centros/certificaciones no se traducen, así que la comparación literal es válida; los títulos traducidos no se comprueban). Si hay discrepancias, el PDF se genera igualmente y la respuesta incluye `warnings[]` que la UI muestra junto al resultado.

**Esquema JSON del CV** (orientativo): `name, headline, contact {email, phone, location, links[]}, summary, skills[], experience[{title, company, location, start, end, bullets[]}], education[{degree, institution, start, end}], certifications[], languages[]`. Secciones vacías se omiten.

**Esquema de la cover letter**: `name, contact, date, recipient (empresa / "Hiring Team"), greeting, paragraphs[] (3–4), closing, signature`. Extensión objetivo ~250–400 palabras, 1 página. *(Decisión del diseñador.)*

**Reglas del prompt (CV)**: solo hechos presentes en el CV base; priorizar experiencia y skills que casan con la oferta; incorporar palabras clave literales de la oferta cuando sean ciertas para el candidato; idioma de la oferta con las reglas de traducción indicadas arriba; CV preferiblemente 1–2 páginas. El JSON incluye los encabezados de sección ya en el idioma de destino.

**Reglas del prompt (cover letter)**: hechos del candidato solo del CV base; motivación solo de las notas del usuario; datos de la empresa/rol solo del texto de la oferta; si no hay notas, no inventar motivación personal.

### Render PDF ATS-ready

- Librería: **pdfkit** (texto real, ligero, sin navegador). *(Decisión del diseñador.)*
- Fuente: TrueType estándar con cobertura Unicode amplia, incrustada y empaquetada en el repo (p. ej. Noto Sans o Liberation Sans, licencia libre) — Helvetica built-in solo cubre WinAnsi y rompería caracteres no latinos. *(Decisión del diseñador.)*
- Una columna, tamaños 10–11 pt cuerpo, encabezados de sección estándar en el idioma de la oferta (p. ej. "Experiencia profesional"/"Professional Experience", "Formación"/"Education", "Habilidades"/"Skills").
- Sin tablas, imágenes, iconos ni cabeceras/pies con datos. Viñetas con carácter simple. Contacto en texto plano al inicio.
- Metadatos del PDF: título y autor = nombre del candidato.

### UI en el detalle de oferta

- Junto a "Ver oferta original ↗" (`components.jsx` ~línea 163): botones "Generar CV" y "Cover letter", con un textarea opcional "Notas para la cover letter (por qué me interesa)".
- Si la respuesta trae `warnings[]`, mostrarlos junto al resultado ("Revisa: X no aparece en tu CV base").
- Estado por botón: generando (deshabilitado + indicador), éxito (ruta del fichero + enlace "Abrir" servido por el bridge, p. ej. `GET /api/files/:slug/:file`), error (mensaje legible).
- Si falta config o CV base, los botones indican qué falta y abren el panel de ajustes.

### Tests

- Unit (`node --test`): sanitización de slug / contención de ruta, lectura/escritura de config (incl. validación de modelo), control anti-invención (casos que pasan y que avisan), render PDF a partir de un JSON fijo (el PDF se genera y contiene el texto esperado), validación del JSON devuelto por el modelo.
- Sin llamadas reales a Claude en tests.

## Lo que queda a criterio del builder

- Librería de extracción de PDF; forma exacta de los endpoints de subida.
- Diseño visual del panel de ajustes (seguir estilos existentes `styles.css`, `.btn`).
- Redacción final de los prompts.
- Reintento si el modelo devuelve JSON inválido (sugerido: 1 reintento).
