# pi-inline-images

A local Pi package which renders a selected local PNG, JPEG, or WebP in the Pi TUI without adding it to model context.

## First use

```sh
pi install /absolute/path/to/pi-inline-images
# restart Pi, then
/image /tmp/example.png
```

`/image clear` clears this package's active previews. The session stores only path, source hash, original MIME, dimensions, and a durable logical ID; normalized PNG bytes and random terminal image IDs remain process-local. Changed or missing files render a readable notice.

Kitty placeholders are used only under tmux when the outer terminal supports Kitty graphics and tmux has `allow-passthrough on`; GNU Screen and tmux without passthrough show readable text. Other supported terminals use Pi's Image component. Configure tmux with `set -g allow-passthrough on` before starting Pi. Inputs are limited to 20 MB and 32 decoded megapixels. At most 16 previews may be active; clear before adding another.

## Development

Run `mise run check` for static/unit and package-boundary validation. `mise run verify` additionally smoke-tests the packed package by loading it offline and running `/image clear`, then launches Pi in an isolated tmux session (explicitly configured with `allow-passthrough on`) and captures raw pane bytes while exercising `/image` and `/image clear`; it proves Kitty upload, virtual placement, placeholder, and owned-ID cleanup sequences, not pixel rendering. Visual Ghostty+tmux rendering remains a manual acceptance check: start Pi in tmux, run `/image path.png`, resize the pane, then `/image clear`; confirm the image, resize geometry, and disappearance.
