# Slopz CLI

The Slopz CLI is the authenticated developer and agent control plane. Browser
game code may render a slot, but it never receives a developer credential and
cannot persist platform configuration for a public player.

## Build and run

```sh
pnpm --filter @slopz/cli build
node packages/cli/dist/index.js help
# From the monorepo root, agents can use:
pnpm slopz -- help
```

The package installs a `slopz` executable. Its `slopz version` output is read
from the installed package metadata, so the binary and published tarball cannot
silently report different versions.

Configure an environment, then authenticate through the browser:

```sh
slopz env set local \
  --api-url https://your-convex-site.convex.site \
  --app-url http://localhost:5173 \
  --default
slopz login
slopz whoami --json
```

`login` uses an authorization-code flow with PKCE and a loopback callback. The
game never sees the resulting CLI token. The token is stored in
`~/.slopz/config.json` with owner-only file permissions and can be revoked with
`slopz logout`.

## Link a project

From a game repository, link the local directory to a game owned by the
authenticated developer:

```sh
slopz project set game_abc12345
slopz project show --json
```

The public project identifiers are saved in `.slopz/project.json`. Ownership is
checked by the backend; changing this file cannot grant access to another
developer's game.

## Slot manifest

`slopz.slots.json` deliberately separates the placement implemented by the
game from its rental policy:

```json
{
  "version": 1,
  "slots": [
    {
      "key": "billboard",
      "placement": {
        "label": "downstream billboard",
        "description": "pop-up billboard hazards inside the downstream run",
        "width": 720,
        "height": 500,
        "maxFileSize": 1048576,
        "allowAnimated": false,
        "contentRules": "Static game-safe promotion only."
      },
      "rental": {
        "approval": "manual",
        "offers": [
          { "key": "week", "duration": "7d", "price": "20" }
        ]
      }
    }
  ]
}
```

Validate locally, inspect the planned API payload, and then sync it:

```sh
slopz slots validate
slopz slots sync --dry-run --json
slopz slots sync
slopz slots list --json
```

Adding a slot or changing placement metadata is done by editing the manifest in
the game repository. Changing a price or duration only changes the `rental`
section; it does not require changing runtime game code. Sync replaces the
configured slot set for that game, so agents should always read and edit the
complete manifest rather than submitting a partial slot.

Automatic approval is intentionally unavailable to ordinary CLI sessions.
Existing and active booking semantics remain backend-owned and must not be
inferred from a manifest edit.

All read-oriented commands support `--json` so coding agents can consume stable
machine-readable output without scraping terminal prose.
