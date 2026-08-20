# Releasing pi-tmux-images

## Subsequent stable releases

The repository-owned command plans by default and performs no command execution or mutation:

```sh
mise run release -- 0.1.1
```

After a standalone `## 0.1.1` changelog entry has landed, run the guarded external-effect path only from clean `main` at `origin/main`:

```sh
mise run release -- 0.1.1 --execute
```

The command fails closed unless the target is a greater stable version absent from local and remote tags and npm. It also requires matching package and lock versions, successful prior CI, a passing local `mise run verify`, GitHub authentication, and a `publish.yml` workflow that still uses OpenID Connect (OIDC) provenance publishing without token or one-time password (OTP) credentials.

After those checks pass, the command creates the release version commit and tag, pushes them, and creates the GitHub Release. It polls until the publish workflow is visible, watches the run, verifies npm `latest`, version, and attestations, and performs a temporary npm Pi install smoke.

### Phase recovery

Do not blindly rerun `--execute` after an external-effect failure. It intentionally rejects an existing tag or target version. Identify the completed phase first with `git log`, `git ls-remote --tags origin`, `gh release view v<version>`, and `gh run list --workflow publish.yml`.

Then complete only the missing phase:

- Push an already-created tag.
- Create a missing GitHub Release.
- Watch and verify the existing publish run.

Preserve the matching release commit and tag. Do not recreate or retarget them. Record the recovery outcome in the changelog or PR notes before the next release.

This command never accepts, stores, or uses npm tokens or OTPs. It is not a first-package bootstrap tool. The remaining sections record the one-time bootstrap and initial publication of `pi-tmux-images`. Do not repeat them for subsequent versions.

## Initial publication prerequisites

Before the initial release, the maintainer:

1. Ran `mise run verify` and inspected the real `assets/demo.png` described in `assets/README.md`.
2. Confirmed `package.json` shipped the screenshot, `pi.image` used its final public URL, and the README rendered it.
3. Created `safurrier/pi-tmux-images`, pushed `main`, and confirmed the thin CI workflow passed.

## npm trusted-publishing bootstrap record

The first public release still had to come from GitHub Actions with OIDC provenance. The maintainer bootstrapped npm package ownership with a lower, non-`latest` version and never manually published `0.1.0` before running the workflow.

1. Made a separate disposable checkout of the verified `main` commit, confirmed it was clean with `git diff --exit-code`, and temporarily set only that checkout's package version to `0.0.0-bootstrap.0` with `npm version 0.0.0-bootstrap.0 --no-git-tag-version`. The temporary change was never committed or tagged.
2. Published the bootstrap package with an npm credential and required OTP under the non-default tag:

   ```sh
   npm publish --access public --tag bootstrap --otp=<code>
   npm view pi-tmux-images@bootstrap version
   npm dist-tag ls pi-tmux-images
   ```

   Because this was the first published version, npm temporarily assigned it to both `bootstrap` and `latest`. Publishing `v0.1.0` later moved `latest` to the stable version.
3. Added a GitHub Actions trusted publisher in npm package settings with owner `safurrier`, repository `pi-tmux-images`, workflow `publish.yml`, and no environment.
4. Ran `npm logout`, removed the temporary npm credential, and deleted the disposable checkout. The repository retained no `NPM_TOKEN` secret or token-based publish workflow.

## v0.1.0 publication record

For the initial stable release, the maintainer:

1. Returned to a clean, verified checkout of the intended `main` commit and confirmed `git diff --exit-code`, `npm ci`, and `mise run verify` passed. `package.json` still reported `0.1.0`.
2. Created and pushed an annotated `v0.1.0` tag pointing at that verified commit, then confirmed the pushed tag resolved to the same commit before creating a non-prerelease GitHub Release.
3. Published the GitHub Release. `.github/workflows/publish.yml` verified the tag and package version, then published `0.1.0` through npm trusted publishing with provenance.
4. Verified `npm view pi-tmux-images version` and `npm dist-tag ls pi-tmux-images`, then made npm the primary README installation path.
