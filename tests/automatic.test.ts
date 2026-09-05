import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { automaticBlocks, findOrigin, originFor } from "../src/automatic.ts";
import { loadImageBytes, MAX_BASE64_LENGTH, MAX_INPUT_BYTES, validateEncodedImageData } from "../src/loader.ts";
import { PreviewRuntime } from "../src/runtime.ts";

const metadata = (origin: NonNullable<ReturnType<typeof originFor>>, logicalId: string) => ({
	path: "attached image",
	hash: "a".repeat(64),
	originalMime: "image/png" as const,
	width: 1,
	height: 1,
	logicalId,
	origin,
});

test("automatic origins select only their exact regular-message ordinal", async () => {
	const png = await sharp({ create: { width: 2, height: 3, channels: 3, background: "red" } })
		.png()
		.toBuffer();
	const data = png.toString("base64");
	const user = { role: "user", timestamp: 1234, content: [{ type: "image", mimeType: "image/png", data }] };
	const firstOrigin = originFor(user, 0, 0, data) ?? assert.fail("origin");
	const secondOrigin = originFor(user, 1, 0, data) ?? assert.fail("origin");
	assert.deepEqual(firstOrigin, {
		messageOrdinal: 0,
		key: "user",
		blockIndex: 0,
		mimeType: "image/png",
		contentHash: createHash("sha256").update(data).digest("hex"),
	});
	const first = metadata(firstOrigin, "automatic-logical-0001");
	const second = metadata(secondOrigin, "automatic-logical-0002");
	const entries = [
		{ type: "custom", customType: "pi-tmux-images.preview", data: first },
		{ type: "message", message: user },
		{ type: "custom", customType: "pi-tmux-images.preview", data: second },
		{ type: "message", message: { ...user } },
	];
	assert.equal(findOrigin(entries, first)?.data, data);
	assert.equal(findOrigin(entries, second)?.data, data);
	assert.equal(
		findOrigin(
			[
				{ type: "custom", data: second },
				{ type: "message", message: { ...user, content: [] } },
			],
			second,
		),
		undefined,
		"a removed expected source never shifts to a later collision",
	);
	assert.equal(
		findOrigin(
			[
				{ type: "custom", data: first },
				{ type: "message", message: { ...user, content: [{ type: "image", mimeType: "image/jpeg", data }] } },
			],
			first,
		),
		undefined,
		"MIME changes at the expected ordinal are unavailable",
	);
	assert.equal(
		findOrigin(
			[
				{ type: "custom", data: first },
				{ type: "message", message: { ...user, content: [{ type: "image", mimeType: "image/png", data: "cG5n" }] } },
			],
			first,
		),
		undefined,
		"data changes at the expected ordinal are unavailable",
	);
});
test("oversized automatic blocks are rejected before hashing or decoding", () => {
	const oversized = "A".repeat(MAX_BASE64_LENGTH);
	const message = { role: "user", timestamp: 1, content: [{ type: "image", mimeType: "image/png", data: oversized }] };
	assert.deepEqual(automaticBlocks(message, 0), [], "the exact decoded-size guard runs before origin hashing");
	assert.throws(
		() => originFor(message, 0, 0, oversized),
		/encoded input exceeds/,
		"originFor does not hash oversized data",
	);
});
test("base64 decoded-size guard accepts exactly 20MB and rejects one byte over", () => {
	const exact = "A".repeat(Math.ceil(MAX_INPUT_BYTES / 3) * 4 - 1);
	assert.equal(exact.length, MAX_BASE64_LENGTH - 1);
	assert.doesNotThrow(() => validateEncodedImageData(exact));
	assert.throws(() => validateEncodedImageData("A".repeat(MAX_BASE64_LENGTH)), /encoded input exceeds/);
});
test("runtime rehydrates automatic metadata through an origin resolver", async () => {
	const runtime = new PreviewRuntime({
		byteLoader: async () => ({
			path: "attached image",
			hash: "a".repeat(64),
			originalMime: "image/png",
			width: 1,
			height: 1,
			png: Buffer.from("png"),
		}),
		allocateImageId: () => 7,
	});
	const entry = metadata(
		{ messageOrdinal: 0, key: "tool:call", blockIndex: 0, mimeType: "image/png", contentHash: "b".repeat(64) },
		"automatic-logical-0001",
	);
	assert.equal((await runtime.rehydrate([entry], undefined, () => ({ data: "cG5n", mimeType: "image/png" }))).size, 0);
	assert.equal(runtime.get(entry.logicalId)?.path, "attached image");
	assert.match((await runtime.rehydrate([entry])).get(entry.logicalId) ?? "", /missing/);
});
test("in-memory image blocks enforce MIME, size/decode guards, and source hash", async () => {
	const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } })
		.png()
		.toBuffer();
	const image = await loadImageBytes(png.toString("base64"), "image/png");
	assert.equal(image.hash, createHash("sha256").update(png).digest("hex"));
	await assert.rejects(() => loadImageBytes(png.toString("base64"), "image/gif"), /Unsupported/);
	await assert.rejects(() => loadImageBytes("not base64!", "image/png"), /Invalid/);
	await assert.rejects(() => loadImageBytes("A".repeat(MAX_BASE64_LENGTH), "image/png"), /encoded input exceeds/);
});
