# Releasing pi-tmux-images

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
