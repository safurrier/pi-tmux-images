import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), "pi-inline-images-package-"));
let packageFile;
try {
	const tarball = execFileSync("npm", ["pack", "--json"], { cwd: root, encoding: "utf8" });
	const [{ filename }] = JSON.parse(tarball);
	packageFile = join(root, filename);
	execFileSync("npm", ["init", "-y"], { cwd: temp, stdio: "ignore" });
	execFileSync(
		"npm",
		["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--legacy-peer-deps", packageFile],
		{
			cwd: temp,
			stdio: "ignore",
		},
	);
	for (const name of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]) {
		const destination = join(temp, "node_modules", name);
		mkdirSync(join(destination, ".."), { recursive: true });
		symlinkSync(join(root, "node_modules", name), destination, "junction");
	}
	const installed = join(temp, "node_modules", "pi-inline-images");
	const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
	assert.deepEqual(manifest.peerDependencies, {
		"@earendil-works/pi-coding-agent": "^0.84.2",
		"@earendil-works/pi-tui": "^0.84.2",
	});
	assert.ok(lstatSync(installed).isDirectory(), "packed package must be installed");
	const extension = join(installed, "extensions", "index.ts");
	const pi = process.env.PI_BIN ?? join(root, "node_modules", ".bin", "pi");
	const result = spawnSync(
		pi,
		["--offline", "--no-session", "--no-extensions", "--extension", extension, "--print", "/image clear"],
		{
			encoding: "utf8",
			timeout: 15_000,
		},
	);
	assert.equal(result.error, undefined, `Pi must start: ${result.error?.message ?? ""}`);
	assert.equal(result.signal, null, `Pi must not be terminated: ${result.stderr}`);
	assert.equal(result.status, 0, `Pi must load the packed extension and run /image clear: ${result.stderr}`);
	assert.doesNotMatch(`${result.stdout}${result.stderr}`, /Failed to load extension|Cannot find module/u);
	console.log("packed package peer contract installed and Pi loaded its extension via /image clear.");
} finally {
	rmSync(packageFile, { force: true });
	rmSync(temp, { recursive: true, force: true });
}
