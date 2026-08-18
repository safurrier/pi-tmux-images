import { spawnSync } from "node:child_process";
import { getCapabilities } from "@earendil-works/pi-tui";

export type RenderMode = "kitty-placeholder" | "image" | "text";
export type Environment = Record<string, string | undefined>;
export type TmuxProbe = (env: Environment) => boolean;

export function isTmux(env: Environment): boolean {
	return Boolean(env.TMUX || env.TERM?.startsWith("tmux"));
}

/** Fail closed: only an explicit tmux `allow-passthrough on` enables Kitty DCS wrapping. */
export const probeTmuxPassthrough: TmuxProbe = () => {
	const result = spawnSync("tmux", ["show-options", "-gv", "allow-passthrough"], {
		encoding: "utf8",
		timeout: 1_000,
	});
	return result.status === 0 && /^(on|yes|true|1)$/iu.test(result.stdout.trim());
};

export function outerKittyCapable(env: Environment): boolean {
	const program = env.TERM_PROGRAM?.toLowerCase();
	const emulator = env.TERMINAL_EMULATOR?.toLowerCase();
	return Boolean(
		env.KITTY_WINDOW_ID ||
			env.GHOSTTY_RESOURCES_DIR ||
			env.WEZTERM_PANE ||
			program === "kitty" ||
			program === "ghostty" ||
			program === "wezterm" ||
			emulator === "ghostty" ||
			emulator === "wezterm",
	);
}

export function renderMode(
	env: Environment = process.env,
	imageProtocol = getCapabilities().images,
	tmuxProbe: TmuxProbe = probeTmuxPassthrough,
): RenderMode {
	let passthrough = false;
	if (isTmux(env) && outerKittyCapable(env)) {
		try {
			passthrough = tmuxProbe(env);
		} catch {
			// Capability probe errors must leave a readable text fallback.
		}
	}
	if (passthrough) return "kitty-placeholder";
	if (!isTmux(env) && imageProtocol) return "image";
	return "text";
}
