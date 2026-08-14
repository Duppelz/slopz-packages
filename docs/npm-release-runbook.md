# npm release runbook

This runbook bootstraps and operates public `next` and stable releases for
`@slopz/sdk` and `@slopz/cli`.

## Safety boundary

`.github/workflows/release-packages.yml` is the only trusted GitHub publisher.
Its build-and-pack job has read-only repository permission and no npm authority.
The final job receives `id-token: write` only inside the branch-restricted
`package-publishing` environment. Routine `next` releases do not require a
second-repository approval; public `main` can change only through required CI.

The `next` release version is deterministic:

```text
<declared version>-next.g<first 12 characters of the package Git tree hash>
```

Rerunning unchanged content therefore targets the same immutable npm version.
The publisher verifies the existing registry integrity and skips it instead of
creating another release. SDK and CLI package trees are planned independently.

A stable release uses the declared package version exactly. It is accepted only
from an owner-triggered workflow dispatch on protected `main`, and only after
the deterministic `next` version for the same package Git tree is visible in
npm. The trusted publisher then packs that same reviewed tree with the stable
version, publishes it under `latest`, verifies registry integrity, and installs
the exact public version in a clean consumer project.

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
  --repo Duppelz/slopz-packages \
  --file release-packages.yml \
  --environment package-publishing \
  --allow-publish

npm trust github @slopz/cli \
  --repo Duppelz/slopz-packages \
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

- GitHub owner: `Duppelz`
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
packages** from an exact reviewed ref, select SDK, CLI, or both, and keep the
channel set to `next`.

The workflow then:

1. publishes only versions that do not already exist;
2. assigns the `next` tag;
3. compares registry integrity with the reviewed tarball;
4. installs exact public package versions into a clean project;
5. imports the SDK and host runtime exports; and
6. executes the installed CLI's `version` and `help` commands.

Trusted publishing can emit provenance because both the npm packages and
`Duppelz/slopz-packages` are public. The private application repository is not
part of npm's trusted-publisher identity and must never hold an npm token.

## Stable publication

After the selected package's deterministic `next` run succeeds and the exact
version installs from npm:

1. confirm the declared stable version in `packages/<id>/package.json` is the
   intended release;
2. open **Release npm packages** on the protected `main` branch;
3. select the package or `all`, choose the `stable` channel, and dispatch as
   repository owner `aj-maz`; and
4. wait for the workflow to prove the matching deterministic `next` version,
   publish through the existing OIDC trusted-publisher identity, assign
   `latest`, and install the exact stable versions.

Stable versions are immutable. If the deterministic `next` version for the
current tree is absent, the workflow fails before npm receives a stable
publish request.
