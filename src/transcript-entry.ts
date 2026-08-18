export const ENTRY_TYPE = "pi-tmux-images.preview";
export const CLEAR_TYPE = "pi-tmux-images.clear";
export interface PreviewEntry {
	path: string;
	hash: string;
	originalMime: "image/png" | "image/jpeg" | "image/webp";
	width: number;
	height: number;
	/** Durable, session-scoped identity; terminal image IDs are never persisted. */
	logicalId: string;
}
export interface ClearEntry {
	marker: true;
}
const MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
export function isPreview(value: unknown): value is PreviewEntry {
	if (!value || typeof value !== "object") return false;
	const x = value as Partial<PreviewEntry>;
	return (
		typeof x.path === "string" &&
		x.path.length > 0 &&
		typeof x.hash === "string" &&
		/^[a-f0-9]{64}$/u.test(x.hash) &&
		typeof x.logicalId === "string" &&
		/^[a-zA-Z0-9_-]{16,128}$/u.test(x.logicalId) &&
		MIME.has(x.originalMime ?? "") &&
		typeof x.width === "number" &&
		Number.isSafeInteger(x.width) &&
		x.width > 0 &&
		x.width <= 100000 &&
		typeof x.height === "number" &&
		Number.isSafeInteger(x.height) &&
		x.height > 0 &&
		x.height <= 100000
	);
}
