# freehire · buscador agéntico de ofertas

Servidor **MCP** sobre la API pública de [freehire](https://github.com/strelov1/freehire) (3M+ ofertas IT
sacadas directamente de los ATS de las empresas) y un **panel React** con un buscador IA. El LLM se obtiene
por **sampling contra tu Claude Code local**: no hay API key, ni de Anthropic ni de freehire.

```
Navegador ──HTTP/SSE──▶ bridge (server/) ──MCP stdio──▶ freehire MCP (mcp/)
                          ▲                                   │  GET freehire.me/api/v1/...
                          └──── sampling/createMessage ◀──────┘
                          │
                          └──▶ claude -p   (tu sesión de Claude Code)
```

## Arranque

Necesitas Node ≥ 20 y Claude Code instalado y logueado (`claude` en el PATH).

```bash
npm install
npm run dev        # bridge en :8787 + Vite en :5173  → abre http://localhost:5173
# o en "producción":
npm run build && npm start   # todo en http://localhost:8787
npm test
```

## Cómo funciona el buscador agéntico (`agentic_search`)

1. **Plan**: sampling → el modelo traduce la petición (en cualquier idioma) a 2-3 búsquedas con los filtros
   reales de freehire (`skills`, `seniority`, `work_mode`, `countries`, `salary_min`…), de la más concreta a la
   más amplia. Los deseos blandos ("idealmente", "si es posible") no se convierten en filtros.
2. **Búsqueda**: ejecuta cada intento contra `/jobs/search`. Si uno da 0 resultados por palabras clave, lo repite
   sin ellas (autocorrección barata, sin LLM).
3. **Re-plan**: si hay muy pocos candidatos, segunda ronda de sampling con los totales observados.
4. **Ranking**: sampling final que puntúa 0-100 y explica cada oferta en el idioma de la petición.

Cada paso se emite como notificación MCP (logging + progress); el panel lo muestra en vivo en
"Razonamiento del agente". Una búsqueda típica con Haiku tarda 12-20 s (2-3 llamadas de ~5 s).

## Usar el MCP desde Claude Code / Claude Desktop

`.mcp.json` ya registra el servidor para este proyecto. Para otro sitio:

```bash
claude mcp add freehire -- node C:/ruta/a/freehire/mcp/src/index.js
```

Tools: `agentic_search`, `search_jobs`, `job_facets`, `get_job`, `similar_jobs`, `search_companies`,
`get_company`, más el recurso `freehire://vocabulary` con todos los filtros.

**Ojo con el sampling dentro de Claude Code:** Claude Code (probado en 2.1.282) no anuncia la capacidad
`sampling` como cliente MCP. Por eso, si el cliente no la soporta, `agentic_search` llama él mismo a
`claude -p` local: sigue siendo tu Claude Code y sigue sin haber API key. En el panel web siempre es sampling
MCP de verdad, porque el bridge es el cliente.

## Configuración (variables de entorno)

| Variable | Defecto | Para qué |
| --- | --- | --- |
| `PORT` / `HOST` | `8787` / `127.0.0.1` | Bridge. Solo escucha en localhost y solo acepta peticiones del propio panel (gasta tu cuota de Claude). |
| `FREEHIRE_CLAUDE_MODEL` | `haiku` | Modelo por defecto (`haiku`, `sonnet`, `opus`). El panel permite cambiarlo por búsqueda. |
| `FREEHIRE_CLAUDE_THINKING_TOKENS` | `0` | Thinking extendido; desactivado porque duplica la latencia sin mejorar estas tareas. |
| `FREEHIRE_CLAUDE_TIMEOUT_MS` | `120000` | Tiempo máximo por llamada a `claude`. |
| `FREEHIRE_SAMPLING_FALLBACK` | activo | `off` hace que `agentic_search` falle si el cliente no soporta sampling. |
| `CLAUDE_BIN` | autodetectado | Ruta al ejecutable de `claude` (en Windows se resuelve el `.exe` detrás del shim `.cmd`). |
| `FREEHIRE_API_URL` | `https://freehire.me/api/v1` | Por si montas tu propia instancia de freehire. |
| `FREEHIRE_API_KEY` | — | Opcional; los endpoints de búsqueda son públicos. |

Las llamadas a `claude` van aisladas: `--tools ""`, `--strict-mcp-config` (no carga MCPs, así no hay recursión),
`--safe-mode` (sin hooks, plugins ni CLAUDE.md) y `--no-session-persistence`.

## Estructura

```
mcp/src/
  index.js          entrada stdio
  server.js         tools y recurso MCP
  agentic.js        bucle plan → buscar → re-plan → ranking
  sampling.js       sampling MCP con fallback a claude -p
  claude-cli.js     ejecuta el Claude Code local (lo comparten el MCP y el bridge)
  freehire-api.js   cliente de la API pública + compactJob
  vocab.js          vocabulario de filtros (de docs/API.md de freehire)
server/index.js     bridge Express: cliente MCP con sampling + API/SSE para el panel
web/                panel React (Vite)
test/               tests unitarios (node --test)
```
