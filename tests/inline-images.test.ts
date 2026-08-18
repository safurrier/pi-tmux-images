import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setCapabilities, setCellDimensions } from "@earendil-works/pi-tui";
import sharp from "sharp";
import { registerInlineImages } from "../extensions/index.ts";
import { renderMode } from "../src/capabilities.ts";
import { cell, grid, placeholderWidth, placement, tmux, upload } from "../src/kitty-placeholder.ts";
import { loadImage, MAX_INPUT_BYTES, normalizePath } from "../src/loader.ts";
import { geometry, PreviewRuntime } from "../src/runtime.ts";
import { isPreview, type PreviewEntry } from "../src/transcript-entry.ts";

const hash = "a".repeat(64);
test("Kitty uploads use chunks, placement, tmux escaping, and exact placeholder protocol values", () => {
	const commands = upload("a".repeat(9000), 7, true);
	assert.equal(commands.length, 3);
	assert.match(commands[0] ?? "", /m=1/);
	assert.match(commands[2] ?? "", /m=0/);
	assert.match(placement(7, 2, 3, true), /U=1,c=2,r=3/);
	assert.equal(tmux("\x1b_Gx\x1b\\"), "\x1bPtmux;\x1b\x1b_Gx\x1b\x1b\\\x1b\\");
	assert.equal(cell(2, 1, 0x12030405), "\x1b[38;2;3;4;5m\x1b[58;2;3;4;5m􎻮\u030d\u030e\u0364\x1b[39;59m");
	assert.equal(placeholderWidth(cell(0, 0, 7)), 1);
	assert.equal(grid(3, 2, 7).length, 2);
});
test("geometry honors available cells and capability matrix is conservative", () => {
	assert.deepEqual(geometry(1600, 800, 80, 24, { widthPx: 8, heightPx: 16 }), { columns: 80, rows: 20 });
	setCellDimensions({ widthPx: 8, heightPx: 16 });
	assert.equal(
		renderMode({ TMUX: "x", TERM_PROGRAM: "ghostty" }, null, () => true),
		"kitty-placeholder",
	);
	assert.equal(renderMode({ TERM_PROGRAM: "kitty" }, "kitty"), "image");
	assert.equal(renderMode({}, null), "text");
	assert.equal(
		renderMode({ TMUX: "x", TERM_PROGRAM: "ghostty" }, null, () => false),
		"text",
	);
	assert.equal(
		renderMode({ TMUX: "x", TERM_PROGRAM: "ghostty" }, null, () => {
			throw new Error("tmux failed");
		}),
		"text",
	);
	assert.equal(
		renderMode({ TERM: "screen", TERM_PROGRAM: "ghostty" }, null, () => true),
		"text",
	);
	setCapabilities({ images: null, trueColor: true, hyperlinks: false });
});
test("loader normalizes real PNG, JPEG, and WebP fixtures and honors JPEG orientation", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "pi-inline-images-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const fixtures = [
		[
			"image.png",
			"image/png",
			await sharp({ create: { width: 2, height: 3, channels: 3, background: "red" } })
				.png()
				.toBuffer(),
			2,
			3,
		],
		[
			"image.jpg",
			"image/jpeg",
			await sharp({ create: { width: 2, height: 3, channels: 3, background: "green" } })
				.jpeg()
				.withMetadata({ orientation: 6 })
				.toBuffer(),
			3,
			2,
		],
		[
			"image.webp",
			"image/webp",
			await sharp({ create: { width: 2, height: 3, channels: 3, background: "blue" } })
				.webp()
				.toBuffer(),
			2,
			3,
		],
	] as const;
	for (const [name, originalMime, bytes, width, height] of fixtures) {
		const path = join(dir, name);
		await writeFile(path, bytes);
		const image = await loadImage(path);
		assert.equal(image.originalMime, originalMime);
		assert.equal(image.width, width);
		assert.equal(image.height, height);
		assert.equal(image.hash, createHash("sha256").update(bytes).digest("hex"));
		assert.equal((await sharp(image.png).metadata()).format, "png");
	}
});
test("loader rejects non-regular files and rechecks read size after stat race", async () => {
	assert.equal(normalizePath("@~/a", "/work", "/home/me"), "/home/me/a");
	await assert.rejects(
		() =>
			loadImage("x", {
				fs: { stat: async () => ({ size: 1 }), readFile: async () => Buffer.alloc(MAX_INPUT_BYTES + 1) },
			}),
		/too large/,
	);
	await assert.rejects(
		() => loadImage("x", { fs: { stat: async () => ({ size: 2 }), readFile: async () => Buffer.from("no") } }),
		/Invalid image content/,
	);
	await assert.rejects(
		() =>
			loadImage("x", {
				fs: { stat: async () => ({ size: 2, isFile: () => false }), readFile: async () => Buffer.from("no") },
			}),
		/Cannot read image/,
	);
});
test("runtime owns random terminal IDs, cleans only its IDs, and deduplicates redraw uploads", async () => {
	const writes: string[] = [];
	let next = 100;
	const loader = async (path: string) => ({
		path,
		hash,
		originalMime: "image/png" as const,
		width: 1600,
		height: 800,
		png: Buffer.from("png"),
	});
	const runtime = new PreviewRuntime({
		env: { TMUX: "yes", TERM_PROGRAM: "kitty" },
		tmuxProbe: () => true,
		output: { write: (s) => writes.push(s) },
		loader: loader as never,
		allocateImageId: () => next++,
	});
	await runtime.add("a", "logical-id-0000001");
	await runtime.add("b", "logical-id-0000002");
	assert.deepEqual(runtime.activeIds(), [100, 101]);
	runtime.emitPlaceholder("logical-id-0000001", 20);
	const once = writes.length;
	runtime.emitPlaceholder("logical-id-0000001", 20);
	assert.equal(writes.length, once, "ordinary redraw sends no bytes");
	runtime.emitPlaceholder("logical-id-0000001", 10);
	assert.equal(writes.length, once + 2, "resize deletes the old placement before creating the new one");
	runtime.emitPlaceholder("logical-id-0000001", 20);
	assert.equal(writes.length, once + 4, "A→B→A replaces both stale placements");
	runtime.emitPlaceholder("logical-id-0000001", 20);
	assert.equal(writes.length, once + 4, "A→A emits no duplicate placement");
	assert.equal(writes.filter((s) => /a=p/.test(s)).length, 3, "A→B→A emits three placements");
	assert.equal(writes.filter((s) => /a=d,d=i,/.test(s)).length, 2, "geometry changes delete two old placements");
	runtime.clear();
	assert.equal(writes.filter((s) => /a=d,d=I/.test(s)).length, 2);
	assert.match(writes.at(-2) ?? "", /i=100/);
	assert.match(writes.at(-1) ?? "", /i=101/);
});
test("outside-tmux protocol resolution cleans only Kitty IDs", async () => {
	const loader = async (path: string) => ({
		path,
		hash,
		originalMime: "image/png" as const,
		width: 2,
		height: 2,
		png: Buffer.from("png"),
	});
	for (const protocol of ["kitty", "iterm2", null] as const) {
		const writes: string[] = [];
		const runtime = new PreviewRuntime({
			env: {},
			imageProtocol: protocol,
			output: { write: (s) => writes.push(s) },
			loader: loader as never,
			allocateImageId: () => 77,
		});
		await runtime.add("a", "logical-id-0000004");
		runtime.clear();
		assert.equal(writes.filter((s) => /a=d,d=I,i=77/.test(s)).length, protocol === "kitty" ? 1 : 0);
	}
	setCapabilities({ images: "kitty", trueColor: true, hyperlinks: false });
	const inferred = new PreviewRuntime({
		env: {},
		output: { write() {} },
		loader: loader as never,
		allocateImageId: () => 78,
	});
	assert.equal(inferred.mode(), "image");
	setCapabilities({ images: null, trueColor: true, hyperlinks: false });
});
test("rehydration uses logical identity and malformed/legacy entries are rejected", async () => {
	const loader = async (path: string) => ({
		path,
		hash,
		originalMime: "image/png" as const,
		width: 2,
		height: 2,
		png: Buffer.from("png"),
	});
	const runtime = new PreviewRuntime({ loader: loader as never, allocateImageId: () => 55 });
	const status = await runtime.rehydrate([
		{ path: "a", hash, originalMime: "image/png", width: 2, height: 2, logicalId: "logical-id-0000003" },
	]);
	assert.equal(status.size, 0);
	assert.equal(runtime.terminalId("logical-id-0000003"), 55);
	assert.equal(
		isPreview({ path: "a", hash, originalMime: "image/png", width: Infinity, height: 2, logicalId: "x" }),
		false,
	);
	assert.equal(isPreview({ path: "a", hash, previewId: 1 }), false);
});
test("extension lifecycle is TUI-only, safely handles malformed entries, limits entries, and clears owned IDs on rebuild", async () => {
	type StoredEntry = { type: "custom"; customType: string; data: PreviewEntry | { marker: true } };
	type FakeContext = {
		cwd: string;
		sessionManager: { getBranch(): StoredEntry[] };
		ui: { notify(message: string): void };
	};
	type Handler = (_event: unknown, context: FakeContext) => Promise<void>;
	type Renderer = (entry: { data: unknown }) => { render(): string[]; invalidate(): void };
	type Command = { handler(args: string, context: FakeContext): Promise<void> };
	const entries: StoredEntry[] = [];
	const handlers = new Map<string, Handler>();
	const renderers = new Map<string, Renderer>();
	const commands = new Map<string, Command>();
	const notifications: string[] = [];
	const writes: string[] = [];
	let next = 500;
	const loader = async (path: string) => ({
		path,
		hash,
		originalMime: "image/png" as const,
		width: 2,
		height: 2,
		png: Buffer.from("png"),
	});
	const runtime = new PreviewRuntime({
		env: { TMUX: "x", TERM_PROGRAM: "ghostty" },
		tmuxProbe: () => true,
		imageProtocol: null,
		output: { write: (s) => writes.push(s) },
		loader: loader as never,
		allocateImageId: () => next++,
	});
	const pi = {
		registerEntryRenderer: (type: string, renderer: unknown) => renderers.set(type, renderer as Renderer),
		on: (event: string, handler: unknown) => handlers.set(event, handler as Handler),
		registerCommand: (name: string, command: unknown) => commands.set(name, command as Command),
		appendEntry: (customType: string, data: unknown) =>
			entries.push({ type: "custom", customType, data: data as PreviewEntry | { marker: true } }),
	};
	const ctx = {
		cwd: "/tmp",
		sessionManager: { getBranch: () => entries },
		ui: { notify: (message: string) => notifications.push(message) },
	};
	registerInlineImages(pi as never, runtime);
	const image = commands.get("image");
	assert.ok(image);
	await image.handler("a", ctx);
	assert.equal(entries.length, 1);
	const added = entries[0]?.data as PreviewEntry;
	assert.equal(runtime.terminalId(added.logicalId), 500);
	runtime.emitPlaceholder(added.logicalId, 20);
	const tree = handlers.get("session_tree");
	assert.ok(tree);
	await tree({}, ctx);
	assert.match(writes.join(""), /a=d,d=I,i=500/);
	const renderer = renderers.get("pi-inline-images.preview");
	assert.ok(renderer);
	assert.equal(renderer({ data: { nope: true } }).render()[0], "[image] Invalid saved preview entry.");
	await image.handler("clear", ctx);
	const clear = entries.at(-1);
	assert.ok(clear);
	assert.equal(clear.customType, "pi-inline-images.clear");
	entries.length = 0;
	for (let i = 0; i < 16; i++)
		entries.push({
			type: "custom",
			customType: "pi-inline-images.preview",
			data: {
				path: `p${i}`,
				hash,
				originalMime: "image/png",
				width: 1,
				height: 1,
				logicalId: `logical-id-${String(i).padStart(7, "0")}`,
			},
		});
	const count = entries.length;
	await image.handler("overflow", ctx);
	assert.equal(entries.length, count, "17th preview does not append a duplicate entry");
	assert.match(notifications.at(-1) ?? "", /limit reached/);
	assert.equal("sendMessage" in pi, false);
	assert.equal("sendUserMessage" in pi, false);
});
