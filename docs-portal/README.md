# docs-portal — leontief.tech docs site

Docusaurus site in the "Awake Ledger" Leontief theme, with Mermaid architecture
diagrams. **Live at [docs.leontief.tech](https://docs.leontief.tech) and
[docs.leontief.finance](https://docs.leontief.finance).**

Content pages `docs/*.mdx` are the public presentation; the canonical,
version-volatile integration facts live in the repo's `INTEGRATIONS/*.md`
(dated + cited, per CLAUDE.md).

## Develop

```bash
npm install
npm start          # local dev server
npm run build      # static build → build/
```

## Deploy

The site is a **static (no-build) Vercel project** `leontief-docs` on team
`29projectslab`. Deploy the prebuilt output:

```bash
npm run build
cd build && vercel --prod --token=$VERCEL_TOKEN   # project is linked to leontief-docs
```

Domains `docs.leontief.tech` / `docs.leontief.finance` are attached to the project
(Vercel-managed DNS). TLS auto-provisions.
