# Build rules for every agent working in this repo tonight

- Read `docs/SPEC.md`, `shared/types.ts`, `shared/tools.ts`, `web/src/state/store.ts` first. They are the contract. If you must change a shared file, keep it additive and say so in your report.
- Own only your directories (listed in your brief). Other agents are editing other directories at the same time.
- Do NOT run `git commit`, `git add`, or `git push`. The orchestrator commits. Do NOT edit `package.json` unless a dependency is truly required; if you add one, run `npm install <pkg>` and report it.
- Before reporting done: `npm run typecheck` and `npm test` must pass for the whole repo. Web tests use jsdom via a `// @vitest-environment jsdom` first-line docblock.
- Honesty rules: never fabricate product data, availability, or tool results. When the page does not know, the tool says "unknown" and why.
- Voice for any user-facing copy: plain, short, no marketing adjectives. Spaced dashes if any (" — "), never "—" glued. No "leverage", no "seamless".
- Routes: `/` generator · `/p/<host>/<path>` generated product page · `/compare?a=&b=`. API: `GET /api/extract?url=` → `ExtractResult` · `POST /api/ask` → `AskResponse` or 501.
