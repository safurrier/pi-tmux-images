# Release demo capture

`demo-fixture.png` is a deterministic, original geometric microphone-and-card graphic with no third-party art, video frame, likeness, or lyrics. Regenerate it with:

```sh
npm run generate:demo-fixture
```

It is the input rendered in the checked-in `demo.png`, a real Ghostty + tmux screenshot. Re-capture the static screenshot when rendering behavior or the fixture changes; do not make a GIF.

1. In Ghostty, start a fresh tmux server after adding this to `~/.tmux.conf`:

   ```tmux
   set -g allow-passthrough on
   ```

2. From this checkout, run `pi -e .` inside that tmux pane.
3. Run `/image /absolute/path/to/pi-tmux-images/assets/demo-fixture.png`.
4. Wait for one preview, resize the pane once so placement settles, and keep only the Pi window/pane and the preview in frame. Do not include private prompts, paths, or model output.
5. Capture the static Ghostty window to `assets/demo.png`. Confirm `/image clear` removes the image before closing.
6. Replace `assets/demo.png`, then verify the README image and `pi.image` package-gallery URL still point to it.
