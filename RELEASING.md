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

The command fail-closes unless the target is a greater stable version, absent from local/remote tags and npm, the package and lock agree, prior CI passed, local `mise run verify` passes, GitHub authentication is available, and `publish.yml` still uses OIDC provenance publishing without token or OTP credentials. It then makes the release version commit/tag, pushes them, creates the GitHub Release, watches the publish workflow, verifies npm `latest`, version, and attestations, and performs a temporary npm Pi install smoke.

### Phase recovery

Do not blindly rerun `--execute` after an external-effect failure: it intentionally rejects an existing tag or target version. Identify the completed phase first with `git log`, `git ls-remote --tags origin`, `gh release view v<version>`, and `gh run list --workflow publish.yml`. Then complete only the missing phase (push an already-created tag, create a missing GitHub Release, or watch/verify the existing publish run). Preserve the matching release commit/tag; do not recreate or retarget them. Record the recovery outcome in the changelog or PR notes before the next release.

This command never accepts, stores, or uses npm tokens or OTPs. It is not a first-package bootstrap tool; use the documented bootstrap process below (or the generic Dots release skill) for new package ownership.

## Before the first release

1. Run `mise run verify` and inspect the real `assets/demo.png` described in `assets/README.md`. Re-capture it if rendering behavior or the fixture changed.
2. Confirm `package.json` ships the screenshot, `pi.image` uses its final public URL, and the README renders it.
3. Create `safurrier/pi-tmux-images`, push `main`, and confirm the thin CI workflow passes.

## npm trusted-publishing bootstrap

The first public release must still be published by GitHub Actions with OIDC provenance. Bootstrap npm package ownership with a lower, non-`latest` version; never manually publish `0.1.0` and then rerun the workflow.

1. Make a separate disposable checkout of the verified `main` commit. Confirm it is clean with `git diff --exit-code`, then temporarily set only that checkout's package version to `0.0.0-bootstrap.0` (for example, `npm version 0.0.0-bootstrap.0 --no-git-tag-version`). Do not commit or tag this temporary change.
2. Publish the bootstrap package with an npm credential and required OTP under the non-default tag, then verify that `latest` was not changed:

   ```sh
   npm publish --access public --tag bootstrap --otp=<code>
   npm view pi-tmux-images@bootstrap version
   npm dist-tag ls pi-tmux-images
   ```

3. In npm package settings, add a GitHub Actions trusted publisher with owner `safurrier`, repository `pi-tmux-images`, workflow `publish.yml`, and no environment unless one is intentionally configured.
4. Immediately run `npm logout`, revoke any temporary npm token in npm, remove any temporary credential from the machine, and delete the disposable checkout. Do not retain an `NPM_TOKEN` secret or token-based publish workflow.

## Publish v0.1.0 with provenance

1. Return to a clean, verified checkout of the intended `main` commit. Confirm `git diff --exit-code`, `npm ci`, and `mise run verify` pass, and confirm `package.json` still says `0.1.0`.
2. Create and push an annotated `v0.1.0` tag pointing at that verified commit. Confirm the pushed tag resolves to the same commit before creating a non-prerelease GitHub Release.
3. Publish the GitHub Release. `.github/workflows/publish.yml` verifies the tag and package version, then publishes `0.1.0` through npm trusted publishing with provenance.
4. Verify `npm view pi-tmux-images version` and `npm dist-tag ls pi-tmux-images`, then make npm the primary README installation path.
