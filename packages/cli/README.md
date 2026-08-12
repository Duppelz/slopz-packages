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

Production is the built-in default, so normal users can authenticate without
configuring an endpoint:

```sh
slopz login
slopz whoami --json
```

The official `production` and `staging` endpoints are built in. Select staging
per command or make it the local default:

```sh
slopz login --env staging
slopz env default staging
slopz env list --json
```

Use `slopz env set` only for local development or a custom deployment. Tokens
and linked project identities remain isolated by environment.

## Create a project

Keep the complete publication draft in `slopz.game.json`:

```json
{
  "version": 1,
  "game": {
    "title": "Bin Night",
    "pitch": "Wheel the bin out before the truck arrives.",
    "description": "A tiny midnight timing game about bins and bad decisions.",
    "engineTags": ["canvas"],
    "genreTags": ["idle", "browser"],
    "links": []
  },
  "runtime": {
    "entryUrl": "https://game.example",
    "launchMode": "embedded"
  },
  "coin": {
    "economyDeployment": "lukso-mainnet-staging",
    "name": "Bin Night Coin",
    "symbol": "BIN",
    "description": "The game coin for Bin Night. It can lose value.",
    "graduationLyx": "3",
    "curveFeeBps": 200,
    "iconSameAsGame": true,
    "linksSameAsGame": true,
    "links": []
  },
  "media": {
    "gameIcon": "media/icon.webp",
    "cover": "media/cover.webp",
    "screenshots": ["media/gameplay.webp"]
  }
}
```

Validate every field and local media file without logging in, then create the
project and apply the complete draft:

```sh
slopz project draft validate
slopz project create --manifest --sync-slots
```

The command reserves the game ID, SDK client ID, slug, and canonical Slopz
page, writes them to `.slopz/project.json`, connects the developer-hosted build,
uploads private draft media, stores the complete listing and coin configuration,
and optionally syncs `slopz.slots.json`. Media must be WebP: icons are square and
at most 800 px, covers are 16:9 and at most 1800 px wide, screenshots are 16:9
and at most 1920 px wide, and every file is at most 8 MiB.

Reapply a changed manifest to an existing linked draft with:

```sh
slopz project draft apply
```

The CLI never publishes or requests wallet authority. The owner reviews the
stored page and performs the final Universal Profile publication transaction in
the Slopz app. The legacy `--title`, `--pitch`, and `--game-url` create flags
remain available for intentionally creating only a project shell.

`login` uses an authorization-code flow with PKCE and a loopback callback. The
game never sees the resulting CLI token. The token is stored in
`~/.slopz/config.json` with owner-only file permissions and can be revoked with
`slopz logout`.

## Link an existing project

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
          { "key": "four-hours", "duration": "4h", "price": "5000000" }
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

## Release behavior

Changes under `packages/cli` are released from the private `staging` branch
through the allowlisted public package mirror. CLI-only changes do not rebuild
or republish the unrelated SDK and web consumers, and they do not redeploy the
Convex backend, web application, or documentation site.
