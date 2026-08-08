# Slopz public packages

This repository contains the public source and release boundary for:

- [`@slopz/sdk`](packages/sdk) — the browser SDK used by standalone Slopz games;
- [`@slopz/cli`](packages/cli) — developer tooling for Slopz configuration.

Slopz.fun is a game discovery, play, distribution, and community platform for
AI slop games. The private application repository exports an explicit source
allowlist here through reviewable pull requests. This repository has its own
CI, npm trusted-publisher workflow, and provenance boundary.

## Development

Node.js 24 and the pinned pnpm version are required.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm ci:all
```

Package publication is intentionally unavailable from local development and
is documented in [`docs/npm-release-runbook.md`](docs/npm-release-runbook.md).

## License

The exported SDK and CLI source are available under the [MIT License](LICENSE).
