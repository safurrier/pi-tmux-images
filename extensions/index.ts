import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { previewComponent } from "../src/renderer.ts";
import { PreviewRuntime } from "../src/runtime.ts";
import { CLEAR_TYPE, type ClearEntry, ENTRY_TYPE, isPreview, type PreviewEntry } from "../src/transcript-entry.ts";

function activeEntries(ctx: ExtensionContext): PreviewEntry[] {
	const entries = ctx.sessionManager.getBranch();
	let latestClear = -1;
	entries.forEach((entry, index) => {
		if (entry.type === "custom" && entry.customType === CLEAR_TYPE) latestClear = index;
	});
	return entries
		.slice(latestClear + 1)
		.flatMap((entry) =>
			entry.type === "custom" && entry.customType === ENTRY_TYPE && isPreview(entry.data) ? [entry.data] : [],
		)
		.slice(-16);
}
export function registerInlineImages(pi: ExtensionAPI, runtime = new PreviewRuntime()) {
	let stale = new Map<string, string>();
	pi.registerEntryRenderer<PreviewEntry>(ENTRY_TYPE, (entry, _options, theme) => {
		const data = isPreview(entry.data) ? entry.data : undefined;
		return data
			? previewComponent(data, runtime, theme, stale.get(data.logicalId))
			: { render: () => ["[image] Invalid saved preview entry."], invalidate() {} };
	});
	pi.registerEntryRenderer<ClearEntry>(CLEAR_TYPE, () => ({
		render: () => ["[image previews cleared]"],
		invalidate() {},
	}));
	async function rebuild(ctx: ExtensionContext) {
		runtime.clear();
		const entries = activeEntries(ctx);
		stale = await runtime.rehydrate(entries, ctx.cwd);
	}
	pi.on("session_start", async (_event, ctx) => rebuild(ctx));
	pi.on("session_tree", async (_event, ctx) => rebuild(ctx));
	pi.on("session_shutdown", async () => runtime.clear());
	pi.registerCommand("image", {
		description: "Display a local image in the TUI without model context. Use /image clear to remove previews.",
		handler: async (args, ctx) => {
			if (args.trim() === "clear") {
				runtime.clear();
				pi.appendEntry<ClearEntry>(CLEAR_TYPE, { marker: true });
				stale.clear();
				return;
			}
			if (activeEntries(ctx).length >= 16) {
				ctx.ui.notify("Image preview limit reached (16). Use /image clear before adding another image.", "error");
				return;
			}
			try {
				const entry = await runtime.add(args, randomUUID().replaceAll("-", ""), ctx.cwd);
				pi.appendEntry<PreviewEntry>(ENTRY_TYPE, entry);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : "Unable to load image.", "error");
			}
		},
	});
}

export default function inlineImages(pi: ExtensionAPI) {
	registerInlineImages(pi);
}
