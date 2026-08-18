import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

const root = process.cwd();
const pi = process.env.PI_BIN ?? join(root, "node_modules", ".bin", "pi");
const tmux = spawnSync("tmux", ["-V"], { encoding: "utf8" });
assert.equal(tmux.status, 0, "tmux is required for the real raw-terminal e2e smoke");
assert.equal(spawnSync(pi, ["--version"], { encoding: "utf8" }).error, undefined, "Pi executable must be available");
const temp = mkdtempSync(join(tmpdir(), "pi-tmux-images-e2e-"));
const session = `pi-tmux-images-${process.pid}-${Date.now()}`;
const socket = `pi-tmux-images-${process.pid}-${Date.now()}`;
const config = join(temp, "tmux.conf");
const raw = join(temp, "raw-pane.bin");
const fixture = join(temp, "fixture.png");
const extension = join(root, "extensions", "index.ts");
const run = (args) => execFileSync("tmux", ["-L", socket, ...args], { encoding: "utf8" });
const waitFor = (predicate, label) => {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		if (existsSync(raw) && predicate(readFileSync(raw, "utf8"))) return;
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
	}
	throw new Error(
		`Timed out waiting for ${label}; raw pane output: ${existsSync(raw) ? readFileSync(raw, "utf8").slice(-2000) : "<none>"}`,
	);
};
try {
	writeFileSync(config, "set -g allow-passthrough on\n");
	writeFileSync(
		fixture,
		await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } })
			.png()
			.toBuffer(),
	);
	run([
		"-f",
		config,
		"new-session",
		"-d",
		"-x",
		"140",
		"-y",
		"30",
		"-s",
		session,
		"env",
		"PI_OFFLINE=1",
		"GHOSTTY_RESOURCES_DIR=/e2e/ghostty",
		"TERM_PROGRAM=ghostty",
		pi,
		"--no-session",
		"--no-extensions",
		"--no-context-files",
		"--no-skills",
		"--extension",
		extension,
	]);
	run(["pipe-pane", "-o", "-t", session, `cat >> ${raw}`]);
	waitFor((output) => output.length > 0, "Pi readiness");
	// Pi begins painting before its input handler is ready; avoid racing the first command.
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
	run(["send-keys", "-t", session, `/image ${fixture}`, "Enter"]);
	waitFor(
		(output) => /a=t/.test(output) && /U=1/.test(output) && output.includes("􎻮"),
		"Kitty upload, virtual placement, and placeholder",
	);
	const output = readFileSync(raw, "utf8");
	const id = output.match(/a=t,f=100,i=(\d+)/)?.[1];
	assert.ok(id, "upload must contain a runtime-owned Kitty image ID");
	assert.doesNotMatch(output, /a=d,d=A/, "upload must not issue global delete");
	run(["send-keys", "-t", session, "/image clear", "Enter"]);
	waitFor((stream) => stream.includes(`a=d,d=I,i=${id}`), "exact owned-ID cleanup");
	const final = readFileSync(raw, "utf8");
	assert.doesNotMatch(final, /a=d,d=A/, "clear must not issue global delete");
	mkdirSync(join(root, "artifacts", "e2e"), { recursive: true });
	writeFileSync(join(root, "artifacts", "e2e", "raw-ansi-smoke.log"), final);
	console.log(
		`real tmux raw-terminal smoke passed (owned Kitty ID ${id}); byte-level protocol evidence is not pixel proof.`,
	);
} finally {
	spawnSync("tmux", ["-L", socket, "kill-session", "-t", session]);
	rmSync(temp, { recursive: true, force: true });
}
