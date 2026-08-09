# @slopz/sdk

Browser SDK for games embedded on Slopz. It supports Universal Profile player
context, community leaderboards, and safe scheduled banner delivery through a
private channel to the Slopz parent.

The game SDK does not connect to the Slopz API or receive a platform session.
Slopz injects its parent origin into the iframe URL, establishes the
nonce-bound `MessageChannel`, and brokers SDK requests.

Authenticated players and leaderboard entries include a cached public LSP3
profile when one is available. Platform code using `SlopzApiClient` can enrich
other public addresses, such as coin trade history, in batches of up to 50:

```ts
const profiles = await api.resolveUniversalProfiles(addresses)
```

The returned array preserves address order and uses `null` for addresses that
are not Universal Profiles. The backend refreshes each cached result after 24
hours.

## Render a banner

Add a container owned by the game:

```html
<div id="slopz-banner"></div>
```

Then let the SDK populate it:

```ts
import { createSlopzGame } from '@slopz/sdk'

const slopz = createSlopzGame({
  gameId: 'game_123',
  clientId: 'slopz_pk_123',
})

const banner = await slopz.mountAd({
  slotKey: 'banner',
  container: '#slopz-banner',
})

// Optional when the game's screen changes.
await banner.refresh()

// On teardown.
banner.destroy()
slopz.dispose()
```

The stable `banner` key is implemented by the game and declared in the
repository's `slopz.slots.json`. An authenticated developer or developer agent
runs `slopz slots sync`; runtime game code cannot mutate the platform inventory.
Placement metadata and rental policy are separate sections of that manifest,
so changing a price does not require changing the game bundle.

When the game is embedded by Slopz, the host injects the canonical game and
client IDs into the runtime URL. Games that only run through Slopz can use
`createSlopzGame()` without hardcoding either identifier. Standalone localhost
builds remain playable, but hosted identity, leaderboard, and ad calls are
unavailable until the build is opened through its Slopz draft page.

The SDK inserts only an HTTPS link and an image. It sets
`target="_blank"` and `rel="noopener noreferrer sponsored"`, never executes
advertiser markup, and refreshes the scheduled creative every 30 seconds.
Games remain responsible for sizing and styling the container and the emitted
`.slopz-sdk-ad-link` and `.slopz-sdk-ad-image` elements.

For custom rendering, call `await slopz.getAd('banner')`. This returns the
currently scheduled creative or `null`; it does not report impressions,
clicks, conversions, or player targeting data.

Three.js, Phaser, Unity WebGL, and other engine-style integrations can subscribe
without creating DOM:

```ts
const watch = await slopz.watchAd({
  slotKey: 'banner',
  onChange: (ad) => updateBillboardTexture(ad?.imageUrl ?? fallbackTexture),
})
```

## Package validation

Run the complete SDK gate from the repository root:

```bash
pnpm ci:sdk
```

The gate builds the SDK, runs unit and host-protocol fixtures, creates the real
npm tarball, enforces its file allowlist, installs it into a temporary standalone
game, verifies the public runtime exports, and compiles that game against the
installed package.

Changes under `packages/sdk` are released from the private `staging` branch
through the allowlisted public package mirror. SDK changes rebuild downstream
web consumers, while the unrelated CLI package remains skipped.
