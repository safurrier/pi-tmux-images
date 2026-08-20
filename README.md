# pi-tmux-images

`pi-tmux-images` renders local images in Pi's terminal user interface (TUI) when Pi disables its normal image rendering inside tmux. The preview stays in the terminal UI. The extension never attaches an image or its bytes to model context.

![Ghostty and tmux rendering the pi-tmux-images demo fixture](assets/demo.png)

The screenshot is a real Ghostty + tmux render of the checked-in `assets/demo-fixture.jpg` using Kitty Unicode placeholders.

## Quick start

Install from npm:

```sh
pi install npm:pi-tmux-images
pi
```

To install the verified GitHub `main` branch instead:

```sh
pi install git:github.com/safurrier/pi-tmux-images@main
pi
```

From a local checkout:

```sh
cd /path/to/pi-tmux-images
pi -e .
```

Before starting Pi inside tmux, enable passthrough in `~/.tmux.conf` and start a new tmux server/session:

```tmux
set -g allow-passthrough on
```

Then add and clear a preview:

```text
/image /absolute/path/to/image.png
/image clear
```

## Rendering and compatibility

| Environment | Result |
| --- | --- |
| Ghostty in tmux with `allow-passthrough on` | Kitty upload plus Unicode placeholders, so tmux owns placement. |
| Kitty outside tmux | Pi's image component. |
| Other image-capable terminals outside tmux, including WezTerm when Pi exposes an image protocol | Pi's image component. |
| tmux without passthrough, GNU Screen, or no image protocol | The extension shows a readable text notice and sends no image. |

The extension accepts PNG, JPEG, and WebP inputs and normalizes each image to PNG for terminal transport. It limits each preview to 20 MB of source data and 32 decoded megapixels. A session keeps at most 16 active previews. The validated baseline is Pi 0.84.2 on Node >=22.19.0. Bundled Pi core peers intentionally use `*` so compatible later Pi releases are not artificially excluded.

## Privacy and session behavior

`/image` creates a Pi custom transcript entry, not a chat message. The model and saved session context receive neither the source file nor normalized PNG bytes. Session data contains the path, source hash, original media type, dimensions, and a durable logical ID. The extension transmits normalized PNG bytes through tmux and the terminal to render a preview, so they may appear in terminal logs. Process memory owns the cached bytes and terminal image IDs. If a saved source changes or disappears, Pi shows a readable notice instead of reusing it.

## Limits and troubleshooting

- If tmux shows text instead of an image, add `set -g allow-passthrough on`, then restart tmux and Pi. The setting must apply to the server running Pi.
- `/image clear` removes this package's active previews and deletes only terminal IDs allocated by this runtime.
- On pane resize, the extension replaces its Kitty virtual placement for the new cell geometry. Resize once after adding an image to confirm placement follows the pane. Clear it if a terminal has retained stale pixels.
- GNU Screen is intentionally a text fallback. The extension never tunnels Kitty graphics through it.
- Use an absolute path when the working directory is not obvious. Unsupported, unreadable, oversized, or invalid images report an error in Pi.

## How it works

In the supported tmux path, the extension uploads a normalized image through Kitty graphics, creates a virtual placement, and renders Kitty Unicode placeholder cells in Pi's custom entry. This gives tmux the text grid it needs to move and clear the preview safely. Outside tmux, it uses Pi's native image component when available.

## License and security

This project is licensed under [MIT](LICENSE). Pi packages run with the permissions of the user process, so install packages only from sources you trust. The model/session isolation above does not prevent terminals, tmux, or terminal logging from receiving preview bytes.

## Development

```sh
mise run setup
mise run check
mise run verify
```

`mise run check` runs formatting, linting, TypeScript, unit/release-contract tests, and an `npm pack --dry-run` boundary check. `mise run verify` also installs the packed tarball in an isolated temporary project and runs the isolated tmux raw-terminal smoke. The smoke proves upload, virtual placement, placeholder, and owned-ID cleanup sequences. It does not prove pixels. For the required visual Ghostty + tmux capture, follow [assets/README.md](assets/README.md).

### Future releases

Plan a stable release without changing files or contacting external services:

```sh
mise run release -- 0.1.1
```

Only run the external-effect path after the target changelog entry is already on a clean, current `main`:

```sh
mise run release -- 0.1.1 --execute
```

The guarded command refuses unsafe repository state, duplicate tags or versions, missing successful CI, and an untrusted publish workflow. It updates only package versions before validating, committing, tagging, and pushing. It then creates the GitHub Release, waits for OpenID Connect (OIDC) publishing, and verifies npm plus a temporary Pi install. It never accepts or stores an npm token or one-time password (OTP). First-package bootstrap is deliberately excluded. See [RELEASING.md](RELEASING.md).
