# Someone’s Houston landing site

This directory contains the public landing-site source, built with Lovable, TanStack Start, React, TypeScript and Tailwind CSS.

Public entry point: [astronix.io](https://astronix.io). The report application is a separate project at [app.astronix.io](https://app.astronix.io), with source in [`frontend/report-web/`](../frontend/report-web/). Follow the [report app setup](../frontend/README.md) for authentication, database evidence and report generation.

Landing-page examples are illustrative; use the report app and its source-linked evidence for actual neighborhood comparisons. Confirm report buttons point to the public app when publishing this site. Updating this README does not change deployed links or marketing copy.

## Development

This package has a committed `bun.lock`. Use Bun to preserve that dependency workflow:

```sh
git clone https://github.com/Akretic/Someone-s-Houston.git
cd Someone-s-Houston/website
bun install --frozen-lockfile
bun run dev
bun run build
```

The project is connected to Lovable. Follow [the local working agreement](AGENTS.md): keep pushed branches usable and do not rewrite published history. See the [documentation index](../docs/README.md) for the backend architecture, data rules and current implementation contracts.
