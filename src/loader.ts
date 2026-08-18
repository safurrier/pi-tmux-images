import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, normalize, resolve } from "node:path";
import sharp from "sharp";

export const MAX_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_PIXELS = 32 * 1024 * 1024;
export type OriginalMime = "image/png" | "image/jpeg" | "image/webp";
export interface LoadedImage {
	path: string;
	hash: string;
	originalMime: OriginalMime;
	width: number;
	height: number;
	png: Buffer;
}
export interface FileOps {
	stat(path: string): Promise<{ size: number; isFile?: () => boolean }>;
	readFile(path: string): Promise<Buffer>;
}
const files: FileOps = { stat, readFile };

export function normalizePath(raw: string, cwd = process.cwd(), home = homedir()): string {
	const trimmed = raw.trim().replace(/^@/u, "");
	if (!trimmed) throw new Error("Image path is required. Usage: /image <path>");
	const expanded = trimmed === "~" || trimmed.startsWith("~/") ? `${home}${trimmed.slice(1)}` : trimmed;
	return normalize(isAbsolute(expanded) ? expanded : resolve(cwd, expanded));
}
function mime(format?: string): OriginalMime {
	if (format === "png") return "image/png";
	if (format === "jpeg") return "image/jpeg";
	if (format === "webp") return "image/webp";
	throw new Error("Unsupported image format. Use PNG, JPEG, or WebP.");
}
export async function loadImage(
	rawPath: string,
	options: { cwd?: string; home?: string; fs?: FileOps } = {},
): Promise<LoadedImage> {
	const path = normalizePath(rawPath, options.cwd, options.home);
	const fs = options.fs ?? files;
	let size: number;
	try {
		const info = await fs.stat(path);
		if (info.isFile && !info.isFile()) throw new Error("not a regular file");
		size = info.size;
	} catch {
		throw new Error(`Cannot read image: ${path}`);
	}
	if (size > MAX_INPUT_BYTES)
		throw new Error(`Image is too large: ${Math.ceil(size / 1024 / 1024)} MB (limit: 20 MB).`);
	let bytes: Buffer;
	try {
		bytes = await fs.readFile(path);
	} catch {
		throw new Error(`Cannot read image: ${path}`);
	}
	if (bytes.length > MAX_INPUT_BYTES)
		throw new Error(`Image is too large: ${Math.ceil(bytes.length / 1024 / 1024)} MB (limit: 20 MB).`);
	try {
		const metadata = await sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "error" }).metadata();
		const width = metadata.width ?? 0,
			height = metadata.height ?? 0;
		if (!width || !height) throw new Error("Image has no dimensions.");
		if (width * height > MAX_PIXELS)
			throw new Error(`Image is too large when decoded: ${width}×${height} exceeds 32 MP.`);
		const png = await sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "error" }).rotate().png().toBuffer();
		const rotated = await sharp(png).metadata();
		return {
			path,
			hash: createHash("sha256").update(bytes).digest("hex"),
			originalMime: mime(metadata.format),
			width: rotated.width ?? width,
			height: rotated.height ?? height,
			png,
		};
	} catch (error) {
		if (error instanceof Error && /Unsupported|too large|no dimensions/u.test(error.message)) throw error;
		throw new Error(`Invalid image content: ${path}`);
	}
}
