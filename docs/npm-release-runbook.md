# npm prerelease runbook

This runbook bootstraps and operates public `next` releases for `@slopz/sdk`
and `@slopz/cli`. It does not publish stable versions.

## Safety boundary

`.github/workflows/release-packages.yml` is the only trusted GitHub publisher.
Its build-and-pack job has read-only repository permission and no npm authority.
The final job receives `id-token: write` only inside the branch-restricted
`package-publishing` environment. Routine `next` releases do not require a
second-repository approval; public `main` can change only through required CI.

The release version is deterministic:

```text
<declared version>-next.g<first 12 characters of the package Git tree hash>
```

Rerunning unchanged content therefore targets the same immutable npm version.
The publisher verifies the existing registry integrity and skips it instead of
creating another release. SDK and CLI package trees are planned independently.

## One-time bootstrap

npm requires a package to exist before a trusted publisher can be attached.
The repository owner performs this bootstrap locally with npm account 2FA.

1. Confirm that the `@slopz` npm organization exists and the current npm user
   can publish public packages in it.
2. Authenticate locally:

   ```sh
   npm login
   npm whoami
   ```

3. Build, test, and prepare the two initial tarballs:

   ```sh
   pnpm ci:sdk
   pnpm ci:cli
   node scripts/release/pack-npm-release.mjs --package sdk --version 0.1.0-next.0 --output release/npm-bootstrap
   node scripts/release/pack-npm-release.mjs --package cli --version 0.1.0-next.0 --output release/npm-bootstrap
   ```

4. Inspect `release/npm-bootstrap/*.release.json`, then publish the exact
   prepared tarballs:

   ```sh
   npm publish release/npm-bootstrap/sdk.tgz --tag next --access public
   npm publish release/npm-bootstrap/cli.tgz --tag next --access public
   ```

Package name/version combinations are permanent even if unpublished later.
Do not run these commands until the tarball manifests have been reviewed.

## Trusted publisher configuration

After the bootstrap packages exist and this workflow is merged to the default
branch, use npm CLI 11.15 or newer with account 2FA:

```sh
npm trust github @slopz/sdk \
  --repo 0xSoul/slopz-packages \
  --file release-packages.yml \
  --environment package-publishing \
  --allow-publish

npm trust github @slopz/cli \
  --repo 0xSoul/slopz-packages \
  --file release-packages.yml \
  --environment package-publishing \
  --allow-publish
```

Confirm both bindings with:

```sh
npm trust list @slopz/sdk
npm trust list @slopz/cli
```

The values are case-sensitive and exact:

- GitHub owner: `0xSoul`
- repository: `slopz-packages`
- workflow filename: `release-packages.yml`
- GitHub environment: `package-publishing`
- allowed action: `npm publish`

Once OIDC succeeds, set each npm package's publishing access to require 2FA and
disallow traditional tokens. No npm write token belongs in GitHub secrets.

## Publishing and verification

A package-tree change merged to `main` automatically selects only that package
and publishes it once the `NPM_RELEASES_ENABLED` repository variable is set to
`true`. Before that switch is enabled, an operator can dispatch **Release npm
prereleases** from an exact reviewed ref and select SDK, CLI, or both.

The workflow then:

1. publishes only versions that do not already exist;
2. assigns the `next` tag;
3. compares registry integrity with the reviewed tarball;
4. installs exact public package versions into a clean project;
5. imports the SDK and host runtime exports; and
6. executes the installed CLI's `version` and `help` commands.

Trusted publishing can emit provenance because both the npm packages and
`0xSoul/slopz-packages` are public. The private application repository is not
part of npm's trusted-publisher identity and must never hold an npm token.

Stable npm releases are intentionally not implemented by this prerelease
workflow. When added, they must use a separate production approval boundary;
removing routine approval from `next` must not implicitly authorize stable
publication.
