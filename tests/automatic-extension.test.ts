import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { registerInlineImages } from "../extensions/index.ts";
import { PreviewRuntime } from "../src/runtime.ts";

const hash = "b".repeat(64);
type Entry = { type: string; customType?: string; data?: unknown; message?: unknown };

function automaticHarness() {
	const handlers = new Map<string, (event: { message: unknown }, ctx: unknown) => Promise<void>>();
	const entries: Entry[] = [];
	let imageId = 11;
	const runtime = new PreviewRuntime({
		env: { TMUX: "yes", TERM_PROGRAM: "kitty" },
		tmuxProbe: () => true,
		imageProtocol: null,
		byteLoader: async () => ({
			path: "attached image",
			hash,
			originalMime: "image/png",
			width: 1,
			height: 1,
			png: Buffer.from("png"),
		}),
		output: { write() {} },
		allocateImageId: () => imageId++,
	});
	registerInlineImages(
		{
			registerEntryRenderer() {},
			registerCommand() {},
			on(event: string, handler: unknown) {
				handlers.set(event, handler as (event: { message: unknown }, ctx: unknown) => Promise<void>);
			},
			appendEntry(customType: string, data: unknown) {
				entries.push({ type: "custom", customType, data });
			},
		} as never,
		runtime,
	);
	const ctx = { cwd: "/tmp", sessionManager: { getBranch: () => entries }, ui: { notify() {} } };
	return { entries, handlers, ctx, runtime };
}

test("message_end adds metadata only and preserves source content", async () => {
	const { entries, handlers, ctx } = automaticHarness();
	const content = [{ type: "image", mimeType: "image/png", data: "cG5n" }];
	const user = { role: "user", timestamp: 8, content };
	const messageEnd = handlers.get("message_end") ?? assert.fail("message_end handler");
	await messageEnd({ message: user }, ctx);
	assert.equal(entries.length, 1);
	assert.equal(entries[0]?.customType, "pi-tmux-images.preview");
	assert.equal(user.content, content, "event content remains untouched for model processing");
	assert.deepEqual(
		(entries[0]?.data as { origin: unknown }).origin &&
			(entries[0]?.data as { origin: { messageOrdinal: number; key: string; blockIndex: number } }).origin,
		{
			messageOrdinal: 0,
			key: "user",
			blockIndex: 0,
			mimeType: "image/png",
			contentHash: createHash("sha256").update("cG5n").digest("hex"),
		},
	);
});

test("distinct colliding message objects reserve distinct ordinals while replay is deduplicated", async () => {
	const { entries, handlers, ctx } = automaticHarness();
	const one = { role: "user", timestamp: 99, content: [{ type: "image", mimeType: "image/png", data: "cG5n" }] };
	const two = { role: "user", timestamp: 99, content: [{ type: "image", mimeType: "image/png", data: "cG5n" }] };
	const messageEnd = handlers.get("message_end") ?? assert.fail("message_end handler");
	await Promise.all([
		messageEnd({ message: one }, ctx),
		messageEnd({ message: one }, ctx),
		messageEnd({ message: two }, ctx),
	]);
	let previews = entries
		.filter((entry) => entry.customType === "pi-tmux-images.preview")
		.map((entry) => entry.data as { origin: { messageOrdinal: number } });
	assert.equal(previews.length, 2, "same-object concurrent replay produces one preview");
	assert.deepEqual(
		previews.map((entry) => entry.origin.messageOrdinal),
		[0, 1],
		"distinct identical objects reserve unique source ordinals",
	);
	entries.push({ type: "message", message: one });
	await messageEnd({ message: two }, ctx);
	assert.equal(
		entries.filter((entry) => entry.customType === "pi-tmux-images.preview").length,
		2,
		"persisted matching source deduplicates replay",
	);
	entries.push({ type: "message", message: two });
	await messageEnd({ message: { ...two, content: [...two.content] } }, ctx);
	previews = entries
		.filter((entry) => entry.customType === "pi-tmux-images.preview")
		.map((entry) => entry.data as { origin: { messageOrdinal: number } });
	assert.deepEqual(
		previews.map((entry) => entry.origin.messageOrdinal),
		[0, 1, 2],
		"sequential timestamp collisions receive new ordinals",
	);
});

test("automatic previews are a no-op outside supported tmux", async () => {
	let appended = 0;
	let messageEnd: ((event: { message: unknown }, ctx: unknown) => Promise<void>) | undefined;
	registerInlineImages(
		{
			registerEntryRenderer() {},
			registerCommand() {},
			on(event: string, handler: unknown) {
				if (event === "message_end") messageEnd = handler as typeof messageEnd;
			},
			appendEntry() {
				appended++;
			},
		} as never,
		new PreviewRuntime({ env: {}, imageProtocol: "kitty", output: { write() {} } }),
	);
	await (messageEnd ?? assert.fail("message_end"))(
		{ message: { role: "user", content: [{ type: "image", mimeType: "image/png", data: "cG5n" }] } },
		{ sessionManager: { getBranch: () => [] } },
	);
	assert.equal(appended, 0);
});
