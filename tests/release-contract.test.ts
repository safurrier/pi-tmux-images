import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("public metadata and extension discovery use the canonical package name", () => {
	const manifest = JSON.parse(read("package.json"));
	assert.equal(manifest.name, "pi-tmux-images");
	assert.equal(manifest.author, "Alex Furrier");
	assert.equal(manifest.engines.node, ">=22.19.0");
	assert.deepEqual(manifest.pi.extensions, ["./extensions/index.ts"]);
	assert.equal(manifest.pi.image, "https://raw.githubusercontent.com/safurrier/pi-tmux-images/main/assets/demo.png");
	assert.deepEqual(manifest.peerDependencies, {
		"@earendil-works/pi-coding-agent": "*",
		"@earendil-works/pi-tui": "*",
	});
	assert.equal(manifest.devDependencies["@earendil-works/pi-coding-agent"], "0.84.2");
	assert.equal(manifest.devDependencies["@earendil-works/pi-tui"], "0.84.2");
	assert.equal(manifest.repository.url, "git+https://github.com/safurrier/pi-tmux-images.git");
	assert.equal(manifest.homepage, "https://github.com/safurrier/pi-tmux-images#readme");
	assert.equal(manifest.bugs.url, "https://github.com/safurrier/pi-tmux-images/issues");
	for (const keyword of ["tmux", "ghostty", "kitty", "wezterm"]) assert.ok(manifest.keywords.includes(keyword));
	for (const file of [
		"assets/demo.png",
		"assets/demo-fixture.png",
		"assets/README.md",
		"scripts/generate-demo-fixture.mjs",
	])
		assert.ok(manifest.files.includes(file), `package files must include ${file}`);
	assert.ok(existsSync(join(root, "extensions/index.ts")));
	assert.ok(existsSync(join(root, "assets/demo.png")));
	assert.ok(existsSync(join(root, "assets/demo-fixture.png")));
});

test("fixture regeneration is byte-for-byte deterministic", () => {
	const fixture = join(root, "assets/demo-fixture.png");
	const original = readFileSync(fixture);
	execFileSync(process.execPath, ["scripts/generate-demo-fixture.mjs"], { cwd: root });
	const regenerated = readFileSync(fixture);
	assert.equal(
		createHash("sha256").update(regenerated).digest("hex"),
		createHash("sha256").update(original).digest("hex"),
	);
});

test("README keeps its install and first-command journey canonical", () => {
	const readme = read("README.md");
	for (const command of [
		"pi install git:github.com/safurrier/pi-tmux-images@main",
		"pi install npm:pi-tmux-images",
		"pi -e .",
		"/image /absolute/path/to/image.png",
		"/image clear",
		"set -g allow-passthrough on",
		"mise run check",
		"mise run verify",
	])
		assert.ok(readme.includes(command), `README must include ${command}`);
	assert.match(readme, /Pi 0\.84\.2 on Node >=22\.19\.0/u);
	assert.match(readme, /terminal logs/u);
	assert.match(readme, /!\[Ghostty and tmux rendering[^\]]*\]\(assets\/demo\.png\)/u);
});

test("release workflow only publishes stable releases with pinned inputs", () => {
	const workflow = read(".github/workflows/publish.yml");
	assert.match(workflow, /github\.event\.release\.prerelease == false/u);
	for (const pin of [
		"actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
		"actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
		"npm@12.0.2",
	])
		assert.ok(workflow.includes(pin), `publish workflow must pin ${pin}`);
	assert.match(read(".github/workflows/ci.yml"), /jdx\/mise-action@c37c93293d6b742fc901e1406b8f764f6fb19dac/u);
	assert.match(read(".mise/tasks/setup"), /npm ci/u);
	assert.match(read("RELEASING.md"), /0\.0\.0-bootstrap\.0/u);
	assert.match(read("RELEASING.md"), /npm logout/u);
});

test("Harness target, profile, and system map join on the canonical name", () => {
	const harness = read(".harness/harness.toml");
	const profile = read(".harness/profiles/pi-tmux-images-root.toml");
	const system = read(".harness/system.toml");
	assert.match(harness, /default_profile = "pi-tmux-images-root"/u);
	assert.match(harness, /name = "pi-tmux-images"/u);
	assert.match(harness, /path = "\.\."/u);
	assert.match(harness, /profile = "pi-tmux-images-root"/u);
	assert.match(profile, /\.github\/\*\*/u);
	assert.match(profile, /RELEASING\.md/u);
	assert.match(system, /id = "release-package"/u);
	assert.match(system, /assets\/\*\*/u);
});

test("tracked project text has no accidental old-name references", () => {
	const allowed = new Set([".git", "node_modules", ".harness-local"]);
	const walk = (directory: string): string[] =>
		readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
			if (allowed.has(entry.name)) return [];
			const path = join(directory, entry.name);
			return entry.isDirectory() ? walk(path) : [path];
		});
	const stale = walk(root).filter((path) => {
		if (/\.(png|tgz)$/u.test(path)) return false;
		try {
			return readFileSync(path, "utf8").includes(["pi", "inline", "images"].join("-"));
		} catch {
			return false;
		}
	});
	assert.deepEqual(stale, []);
});
