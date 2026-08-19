import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { type CommandRunner, executeRelease, ReleaseError, releasePlan } from "../scripts/release.ts";

const target = "0.1.1";

async function fixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "pi-tmux-images-release-test-"));
	await writeFile(join(root, "package.json"), JSON.stringify({ name: "pi-tmux-images", version: "0.1.0" }));
	await writeFile(
		join(root, "package-lock.json"),
		JSON.stringify({ name: "pi-tmux-images", version: "0.1.0", packages: { "": { version: "0.1.0" } } }),
	);
	await writeFile(join(root, "CHANGELOG.md"), "# Changelog\n\n## 0.1.1\n\n- Planned release.\n");
	await mkdir(join(root, ".github/workflows"), { recursive: true });
	await writeFile(
		join(root, ".github/workflows/publish.yml"),
		"on:\n  release:\n    types: [published]\npermissions:\n  id-token: write\nsteps:\n  - run: git merge-base --is-ancestor HEAD origin/main\n  - run: npm publish --access public --provenance\n",
	);
	return root;
}

test("dry-run plan is stable and does not execute commands", () => {
	const plan = releasePlan(target);
	assert.match(plan.join("\n"), /dry run; no commands will be run/u);
	assert.match(plan.join("\n"), /No OTPs or npm tokens/u);
	assert.match(plan.join("\n"), /RELEASING\.md/u);
	assert.throws(() => releasePlan("0.1"), ReleaseError);
});

test("execute path performs guarded phases with fake command execution only", async (t) => {
	const root = await fixture();
	t.after(() => rm(root, { recursive: true, force: true }));
	const calls: string[] = [];
	let committed = false;
	let published = false;
	let publishLookups = 0;
	let sleeps = 0;
	const run: CommandRunner = (executable, args, options) => {
		calls.push([executable, ...args].join(" "));
		const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
		if (executable === "git" && args.join(" ") === "status --porcelain") return ok();
		if (executable === "git" && args.join(" ") === "branch --show-current") return ok("main\n");
		if (executable === "git" && args[0] === "rev-parse") return ok(committed ? "release-sha\n" : "base-sha\n");
		if (executable === "git" && args[0] === "show-ref") return { status: 1, stdout: "", stderr: "" };
		if (executable === "git" && args[0] === "ls-remote") return ok();
		if (executable === "git" && args[0] === "commit") {
			committed = true;
			return ok();
		}
		if (executable === "npm" && args[0] === "version" && args[1] === target) {
			const packagePath = join(options?.cwd ?? root, "package.json");
			const lockPath = join(options?.cwd ?? root, "package-lock.json");
			const manifest = JSON.parse(requireText(packagePath)) as { version: string };
			manifest.version = target;
			const lock = JSON.parse(requireText(lockPath)) as {
				version: string;
				packages: Record<string, { version: string }>;
			};
			lock.version = target;
			lock.packages[""] = { version: target };
			writeText(packagePath, JSON.stringify(manifest));
			writeText(lockPath, JSON.stringify(lock));
			return ok();
		}
		if (executable === "npm" && args[0] === "view" && args[1] === `pi-tmux-images@${target}`) {
			if (args[2] === "dist.attestations")
				return ok('{"provenance":{"predicateType":"https://slsa.dev/provenance/v1"}}');
			return published ? ok(`"${target}"`) : { status: 1, stdout: "", stderr: "npm error code E404" };
		}
		if (executable === "npm" && args[0] === "view" && args[1] === "pi-tmux-images") return ok('"0.1.0"');
		if (executable === "npm" && args[0] === "dist-tag") return ok(`latest: ${target}\n`);
		if (executable === "gh" && args[0] === "run" && args[1] === "list") {
			if (args.includes("ci.yml")) return ok('[{"status":"completed","conclusion":"success"}]');
			return publishLookups++ < 2
				? ok("[]")
				: ok('[{"databaseId":42,"headSha":"release-sha","status":"completed","conclusion":"success"}]');
		}
		if (executable === "gh" && args[0] === "run" && args[1] === "watch") {
			published = true;
			return ok();
		}
		if (executable === "gh" && args.join(" ") === `release view v${target}`)
			return { status: 1, stdout: "", stderr: "not found" };
		return ok();
	};

	executeRelease(target, {
		root,
		run,
		write() {},
		sleep() {
			sleeps++;
		},
	});
	assert.ok(calls.includes("mise run verify"));
	assert.ok(calls.includes(`git tag -a v${target} -m Release v${target}`));
	assert.ok(calls.includes(`gh release create v${target} --title v${target} --generate-notes`));
	assert.ok(
		calls.includes(
			`npm exec --yes --package @earendil-works/pi-coding-agent -- pi install npm:pi-tmux-images@${target} --local`,
		),
	);
	assert.equal(sleeps, 2, "waits for GitHub to expose the release workflow before watching it");
	assert.equal(JSON.parse(await readFile(join(root, "package.json"), "utf8")).version, target);
});

test("execute rejects token-based publish workflows before mutating package versions", async (t) => {
	const root = await fixture();
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(
		join(root, ".github/workflows/publish.yml"),
		"on:\n  release:\n    types: [published]\nenv:\n  NODE_AUTH_TOKEN: token-value\npermissions:\n  id-token: write\nsteps:\n  - run: git merge-base --is-ancestor HEAD origin/main\n  - run: npm publish --access public --provenance\n",
	);
	const calls: string[] = [];
	const run: CommandRunner = (executable, args) => {
		calls.push([executable, ...args].join(" "));
		const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
		if (executable === "git" && args.join(" ") === "branch --show-current") return ok("main\n");
		if (executable === "git" && args[0] === "rev-parse") return ok("base-sha\n");
		if (executable === "git" && args[0] === "show-ref") return { status: 1, stdout: "", stderr: "" };
		return ok();
	};
	assert.throws(() => executeRelease(target, { root, run }), /publish\.yml must use/u);
	assert.equal(
		calls.some((call) => call.startsWith("npm version")),
		false,
	);
});

test("execute fails before mutation when the repository is not clean", async (t) => {
	const root = await fixture();
	t.after(() => rm(root, { recursive: true, force: true }));
	const before = await readFile(join(root, "package.json"), "utf8");
	const run: CommandRunner = (executable, args) =>
		executable === "git" && args.join(" ") === "status --porcelain"
			? { status: 0, stdout: " M README.md\n", stderr: "" }
			: { status: 0, stdout: "", stderr: "" };
	assert.throws(() => executeRelease(target, { root, run }), /clean repository/u);
	assert.equal(await readFile(join(root, "package.json"), "utf8"), before);
});

function requireText(path: string): string {
	return readFileSync(path, "utf8");
}

function writeText(path: string, content: string): void {
	writeFileSync(path, content);
}
