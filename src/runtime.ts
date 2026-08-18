import { allocateImageId, getCapabilities, getCellDimensions } from "@earendil-works/pi-tui";
import { type Environment, isTmux, type RenderMode, renderMode, type TmuxProbe } from "./capabilities.ts";
import { deleteImage, deletePlacement, grid, placement, type Sink, upload } from "./kitty-placeholder.ts";
import { type FileOps, type LoadedImage, loadImage } from "./loader.ts";
import type { PreviewEntry } from "./transcript-entry.ts";

export interface RuntimeDeps {
	env?: Environment;
	output?: Sink;
	loader?: typeof loadImage;
	fs?: FileOps;
	/** Test/runtime override for Pi's detected image protocol. */
	imageProtocol?: "kitty" | "iterm2" | null;
	allocateImageId?: () => number;
	/** Test override for the bounded tmux passthrough capability probe. */
	tmuxProbe?: TmuxProbe;
}
export function geometry(
	width: number,
	height: number,
	maxColumns = 80,
	maxRows = 24,
	cell = getCellDimensions(),
): { columns: number; rows: number } {
	const scale = Math.min((maxColumns * cell.widthPx) / width, (maxRows * cell.heightPx) / height, 1);
	return {
		columns: Math.max(1, Math.ceil((width * scale) / cell.widthPx)),
		rows: Math.max(1, Math.ceil((height * scale) / cell.heightPx)),
	};
}
export class PreviewRuntime {
	private readonly env: Environment;
	private readonly output: Sink;
	private readonly loader: typeof loadImage;
	private readonly fs?: FileOps;
	private readonly allocate: () => number;
	private readonly protocol: "kitty" | "iterm2" | null;
	private readonly renderMode: RenderMode;
	private readonly images = new Map<string, LoadedImage>();
	private readonly terminalIds = new Map<string, number>();
	private readonly uploaded = new Map<number, string>();
	/** Current terminal placement geometry, keyed by runtime-owned image ID. */
	private readonly placements = new Map<number, string>();
	constructor(deps: RuntimeDeps = {}) {
		this.env = deps.env ?? process.env;
		this.output = deps.output ?? { write: (s) => process.stdout.write(s) };
		this.loader = deps.loader ?? loadImage;
		this.fs = deps.fs;
		this.allocate = deps.allocateImageId ?? allocateImageId;
		this.protocol = deps.imageProtocol === undefined ? getCapabilities().images : deps.imageProtocol;
		// Probe once per runtime rather than during every component render.
		this.renderMode = renderMode(this.env, this.protocol, deps.tmuxProbe);
	}
	mode(): RenderMode {
		return this.renderMode;
	}
	private id(logicalId: string): number {
		const existing = this.terminalIds.get(logicalId);
		if (existing) return existing;
		let id = this.allocate() >>> 0;
		while (!id || [...this.terminalIds.values()].includes(id)) id = this.allocate() >>> 0;
		this.terminalIds.set(logicalId, id);
		return id;
	}
	terminalId(logicalId: string): number | undefined {
		return this.terminalIds.get(logicalId);
	}
	async add(path: string, logicalId: string, cwd?: string): Promise<PreviewEntry> {
		const image = await this.loader(path, { cwd, fs: this.fs });
		this.images.set(logicalId, image);
		this.id(logicalId);
		return {
			path: image.path,
			hash: image.hash,
			originalMime: image.originalMime,
			width: image.width,
			height: image.height,
			logicalId,
		};
	}
	get(id: string): LoadedImage | undefined {
		return this.images.get(id);
	}
	async rehydrate(entries: PreviewEntry[], cwd?: string): Promise<Map<string, string>> {
		this.images.clear();
		const state = new Map<string, string>();
		for (const entry of entries)
			try {
				const image = await this.loader(entry.path, { cwd, fs: this.fs });
				if (image.hash !== entry.hash) state.set(entry.logicalId, "Image changed since this preview was saved.");
				else {
					this.images.set(entry.logicalId, image);
					this.id(entry.logicalId);
				}
			} catch {
				state.set(entry.logicalId, "Image is missing or no longer readable.");
			}
		return state;
	}
	emitPlaceholder(logicalId: string, availableWidth: number): string[] {
		const image = this.images.get(logicalId);
		if (!image) return [];
		const size = geometry(image.width, image.height, Math.max(1, Math.min(80, availableWidth - 2)));
		const id = this.id(logicalId),
			png = image.png.toString("base64"),
			tmuxMode = isTmux(this.env);
		if (this.uploaded.get(id) !== png) {
			for (const sequence of upload(png, id, tmuxMode)) this.output.write(sequence);
			this.uploaded.set(id, png);
		}
		const placementGeometry = `${size.columns}:${size.rows}`;
		const previousGeometry = this.placements.get(id);
		if (previousGeometry !== placementGeometry) {
			// A new a=p command does not replace an existing virtual placement.
			// Remove the old placement first so resize redraws cannot overlap or band.
			if (previousGeometry !== undefined) this.output.write(deletePlacement(id, tmuxMode));
			this.output.write(placement(id, size.columns, size.rows, tmuxMode));
			this.placements.set(id, placementGeometry);
		}
		return grid(size.columns, size.rows, id);
	}
	clear(): void {
		const kitty = this.mode() === "kitty-placeholder" || (this.mode() === "image" && this.protocol === "kitty");
		if (kitty) for (const id of this.terminalIds.values()) this.output.write(deleteImage(id, isTmux(this.env)));
		this.images.clear();
		this.terminalIds.clear();
		this.uploaded.clear();
		this.placements.clear();
	}
	activeIds(): number[] {
		return [...this.terminalIds.values()];
	}
}
