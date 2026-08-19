import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PACKAGE = "pi-tmux-images";
const RELEASE_BRANCH = "main";

type CommandResult = { status: number; stdout: string; stderr: string };
type CommandOptions = { cwd?: string; env?: NodeJS.ProcessEnv };
export type CommandRunner = (command: string, args: string[], options?: CommandOptions) => CommandResult;
export type ReleaseOptions = {
	root?: string;
	run?: CommandRunner;
	write?: (line: string) => void;
	/** Test hook for publish-workflow polling; production waits with `sleep`. */
	sleep?: (milliseconds: number) => void;
};

export class ReleaseError extends Error {}

function command(command: string, args: string[], options: CommandOptions = {}): CommandResult {
	const result = spawnSync(command, args, { cwd: options.cwd, env: options.env, encoding: "utf8" });
	if (result.error) throw new ReleaseError(`Unable to run ${command}: ${result.error.message}`);
	return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function required(
	run: CommandRunner,
	cwd: string,
	executable: string,
	args: string[],
	description: string,
): CommandResult {
	const result = run(executable, args, { cwd });
	if (result.status !== 0) {
		const detail = (result.stderr || result.stdout).trim();
		throw new ReleaseError(`${description} failed.${detail ? ` ${detail}` : ""}`);
	}
	return result;
}

function stableVersion(value: string): string {
	if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(value))
		throw new ReleaseError(`Expected a stable semantic version such as 0.1.1, got ${JSON.stringify(value)}.`);
	return value;
}

function compareVersions(a: string, b: string): number {
	const left = stableVersion(a).split(".").map(Number);
	const right = stableVersion(b).split(".").map(Number);
	for (let index = 0; index < left.length; index++) {
		const difference = (left[index] ?? 0) - (right[index] ?? 0);
		if (difference) return Math.sign(difference);
	}
	return 0;
}

function manifest(root: string): { version: string; name: string } {
	try {
		return JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string; name: string };
	} catch {
		throw new ReleaseError("Unable to read package.json.");
	}
}

function assertPackageLock(root: string, expectedVersion: string): void {
	try {
		const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as {
			version?: string;
			packages?: Record<string, { version?: string }>;
		};
		if (lock.version !== expectedVersion || lock.packages?.[""].version !== expectedVersion)
			throw new ReleaseError("package-lock.json does not match package.json; run npm install before releasing.");
	} catch (error) {
		if (error instanceof ReleaseError) throw error;
		throw new ReleaseError("Unable to read package-lock.json.");
	}
}

function assertChangelog(root: string, version: string): void {
	const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
	if (!new RegExp(`^##\\s+v?${version.replaceAll(".", "\\.")}\\s*$`, "mu").test(changelog))
		throw new ReleaseError(`CHANGELOG.md must contain a standalone ## ${version} entry before executing a release.`);
}

function assertTrustedPublishing(root: string): void {
	const workflowPath = join(root, ".github/workflows/publish.yml");
	const workflow = existsSync(workflowPath) ? readFileSync(workflowPath, "utf8") : "";
	if (
		!/types:\s*\[published\]/u.test(workflow) ||
		!/git merge-base --is-ancestor HEAD origin\/main/u.test(workflow) ||
		!/id-token:\s*write/u.test(workflow) ||
		!/npm publish --access public --provenance/u.test(workflow) ||
		/\b(?:NPM_TOKEN|NODE_AUTH_TOKEN|NPM_CONFIG_[A-Z0-9_]*TOKEN)\b|_authToken|npm\s+config\s+set\s+.*(?:_auth|token)|--otp(?:=|\s)/iu.test(
			workflow,
		)
	)
		throw new ReleaseError(
			"publish.yml must use npm trusted publishing with provenance and must not use NPM_TOKEN or OTP credentials.",
		);
}

function parseJson<T>(value: string, description: string): T {
	try {
		return JSON.parse(value) as T;
	} catch {
		throw new ReleaseError(`${description} returned invalid JSON.`);
	}
}

function noTargetOnNpm(run: CommandRunner, root: string, target: string): void {
	const result = run("npm", ["view", `${PACKAGE}@${target}`, "version", "--json"], { cwd: root });
	if (result.status === 0)
		throw new ReleaseError(
			`npm already contains ${PACKAGE}@${target}; choose a new version or use the documented recovery steps.`,
		);
	if (!/\bE404\b|404 Not Found|is not in this registry/iu.test(`${result.stderr}\n${result.stdout}`))
		throw new ReleaseError(`Unable to confirm ${PACKAGE}@${target} is absent from npm; refusing to release.`);
}

function assertPriorCi(run: CommandRunner, root: string, sha: string): void {
	const result = required(
		run,
		root,
		"gh",
		["run", "list", "--commit", sha, "--workflow", "ci.yml", "--limit", "20", "--json", "status,conclusion"],
		"GitHub CI lookup",
	);
	const runs = parseJson<Array<{ status?: string; conclusion?: string }>>(result.stdout, "GitHub CI lookup");
	if (!runs.some((entry) => entry.status === "completed" && entry.conclusion === "success"))
		throw new ReleaseError(`No successful CI run was found for ${sha}; refusing to release.`);
	if (runs.some((entry) => entry.status === "completed" && entry.conclusion !== "success"))
		throw new ReleaseError(`A CI run for ${sha} did not succeed; refusing to release.`);
}

function assertInitialPreflight(run: CommandRunner, root: string, target: string): { sha: string } {
	const status = required(run, root, "git", ["status", "--porcelain"], "Repository status");
	if (status.stdout.trim()) throw new ReleaseError("Release execution requires a clean repository.");
	const branch = required(run, root, "git", ["branch", "--show-current"], "Current branch").stdout.trim();
	if (branch !== RELEASE_BRANCH)
		throw new ReleaseError(`Release execution requires ${RELEASE_BRANCH}, not ${branch || "a detached HEAD"}.`);
	for (const executable of ["git", "gh", "npm"])
		required(run, root, executable, ["--version"], `${executable} availability check`);
	required(run, root, "gh", ["auth", "status"], "GitHub authentication");
	required(run, root, "git", ["fetch", "origin", RELEASE_BRANCH], "Fetch origin/main");
	const sha = required(run, root, "git", ["rev-parse", "HEAD"], "Read HEAD").stdout.trim();
	const remoteSha = required(
		run,
		root,
		"git",
		["rev-parse", `origin/${RELEASE_BRANCH}`],
		"Read origin/main",
	).stdout.trim();
	if (!sha || sha !== remoteSha)
		throw new ReleaseError("HEAD must exactly equal origin/main before release execution.");
	const packageManifest = manifest(root);
	if (packageManifest.name !== PACKAGE) throw new ReleaseError(`Expected package.json name to be ${PACKAGE}.`);
	const current = stableVersion(packageManifest.version);
	if (compareVersions(target, current) <= 0)
		throw new ReleaseError(`Target ${target} must be greater than the current package version ${current}.`);
	assertPackageLock(root, current);
	assertChangelog(root, target);
	assertTrustedPublishing(root);
	const localTag = run("git", ["show-ref", "--verify", "--quiet", `refs/tags/v${target}`], { cwd: root });
	if (localTag.status === 0)
		throw new ReleaseError(`Local tag v${target} already exists; use explicit phase recovery instead.`);
	if (localTag.status !== 1) throw new ReleaseError("Unable to determine whether the local release tag exists.");
	const remoteTag = required(run, root, "git", ["ls-remote", "origin", `refs/tags/v${target}`], "Remote tag lookup");
	if (remoteTag.stdout.trim())
		throw new ReleaseError(`Remote tag v${target} already exists; use explicit phase recovery instead.`);
	noTargetOnNpm(run, root, target);
	const published = required(
		run,
		root,
		"npm",
		["view", PACKAGE, "version", "--json"],
		"npm package ownership check",
	).stdout;
	const publishedVersion = stableVersion(parseJson<string>(published, "npm package ownership check"));
	if (compareVersions(target, publishedVersion) <= 0)
		throw new ReleaseError(`Target ${target} must be greater than npm's published version ${publishedVersion}.`);
	assertPriorCi(run, root, sha);
	return { sha };
}

function verifyRelease(root: string, run: CommandRunner): void {
	required(run, root, "mise", ["run", "verify"], "Local verification");
}

function waitForPublish(run: CommandRunner, root: string, sha: string, sleep: (milliseconds: number) => void): void {
	for (let attempt = 0; attempt < 30; attempt++) {
		const result = required(
			run,
			root,
			"gh",
			[
				"run",
				"list",
				"--workflow",
				"publish.yml",
				"--event",
				"release",
				"--limit",
				"20",
				"--json",
				"databaseId,headSha,status,conclusion",
			],
			"Publish workflow lookup",
		);
		const runs = parseJson<Array<{ databaseId?: number; headSha?: string }>>(result.stdout, "Publish workflow lookup");
		const publishRun = runs.find((entry) => entry.headSha === sha && entry.databaseId);
		if (publishRun?.databaseId) {
			required(run, root, "gh", ["run", "watch", String(publishRun.databaseId), "--exit-status"], "Publish workflow");
			return;
		}
		if (attempt < 29) sleep(2_000);
	}
	throw new ReleaseError(
		"GitHub Release exists but its publish workflow was not visible after 60 seconds; follow phase recovery.",
	);
}

function verifyPublishedPackage(run: CommandRunner, root: string, target: string): void {
	const version = required(
		run,
		root,
		"npm",
		["view", `${PACKAGE}@${target}`, "version", "--json"],
		"Published npm version check",
	);
	if (parseJson<string>(version.stdout, "Published npm version check") !== target)
		throw new ReleaseError(`npm did not report ${PACKAGE}@${target}.`);
	const tags = required(run, root, "npm", ["dist-tag", "ls", PACKAGE], "npm latest tag check").stdout;
	if (!new RegExp(`^latest:\\s*${target}$`, "m").test(tags))
		throw new ReleaseError(`npm latest does not point to ${target}.`);
	const attestations = required(
		run,
		root,
		"npm",
		["view", `${PACKAGE}@${target}`, "dist.attestations", "--json"],
		"npm provenance check",
	).stdout;
	const parsed = parseJson<unknown>(attestations, "npm provenance check");
	if (!parsed || !/provenance/iu.test(JSON.stringify(parsed)))
		throw new ReleaseError("npm did not report provenance attestations for the published package.");
}

function smokeInstall(run: CommandRunner, target: string): void {
	const directory = mkdtempSync(join(tmpdir(), "pi-tmux-images-release-smoke-"));
	try {
		required(run, directory, "npm", ["init", "-y"], "Temporary smoke project setup");
		required(
			run,
			directory,
			"npm",
			[
				"exec",
				"--yes",
				"--package",
				"@earendil-works/pi-coding-agent",
				"--",
				"pi",
				"install",
				`npm:${PACKAGE}@${target}`,
				"--local",
			],
			"Temporary npm Pi install smoke",
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

export function releasePlan(target: string): string[] {
	stableVersion(target);
	return [
		`Release plan for ${target} (dry run; no commands will be run):`,
		"1. Fail closed on clean main, HEAD = origin/main, tools/authentication, trusted-publishing workflow, package/lock, changelog, git tag, npm version, and prior CI checks.",
		"2. Update package.json and package-lock.json with npm version, then run mise run verify.",
		"3. Create the release commit and annotated tag, then push the commit and tag to origin.",
		"4. Create the GitHub Release only if it does not already exist, then watch publish.yml.",
		"5. Verify npm version, latest dist-tag, and provenance attestations; run an isolated temporary npm Pi install smoke.",
		"No OTPs or npm tokens are read, accepted, or stored. First-package bootstrap is intentionally excluded; follow RELEASING.md.",
	];
}

export function executeRelease(target: string, options: ReleaseOptions = {}): void {
	stableVersion(target);
	const root = options.root ?? process.cwd();
	const run = options.run ?? command;
	const sleep =
		options.sleep ??
		((milliseconds: number) =>
			required(command, root, "sleep", [String(milliseconds / 1_000)], "Publish workflow polling wait"));
	assertInitialPreflight(run, root, target);
	required(run, root, "npm", ["version", target, "--no-git-tag-version", "--ignore-scripts"], "Package version update");
	if (manifest(root).version !== target)
		throw new ReleaseError("npm version did not update package.json to the requested target.");
	assertPackageLock(root, target);
	required(run, root, "git", ["diff", "--check"], "Release diff check");
	verifyRelease(root, run);
	required(run, root, "git", ["add", "package.json", "package-lock.json"], "Stage release versions");
	required(run, root, "git", ["commit", "-m", `Release v${target}`], "Release commit");
	const releaseSha = required(run, root, "git", ["rev-parse", "HEAD"], "Read release commit").stdout.trim();
	required(run, root, "git", ["tag", "-a", `v${target}`, "-m", `Release v${target}`], "Create release tag");
	required(run, root, "git", ["push", "origin", RELEASE_BRANCH], "Push release commit");
	required(run, root, "git", ["push", "origin", `v${target}`], "Push release tag");
	const existingRelease = run("gh", ["release", "view", `v${target}`], { cwd: root });
	if (existingRelease.status !== 0) {
		if (
			!/not found|could not be found|release not found/iu.test(`${existingRelease.stderr}\n${existingRelease.stdout}`)
		)
			throw new ReleaseError("Unable to determine whether the GitHub Release exists; refusing to create a duplicate.");
		required(
			run,
			root,
			"gh",
			["release", "create", `v${target}`, "--title", `v${target}`, "--generate-notes"],
			"Create GitHub Release",
		);
	}
	waitForPublish(run, root, releaseSha, sleep);
	verifyPublishedPackage(run, root, target);
	smokeInstall(run, target);
	(options.write ?? console.log)(`Release ${target} completed.`);
}

function usage(): string {
	return "Usage: mise run release -- <stable-semver> [--execute]";
}

export function main(args = process.argv.slice(2)): void {
	const execute = args.includes("--execute");
	const unknown = args.filter((arg) => arg.startsWith("-") && arg !== "--execute");
	const versions = args.filter((arg) => !arg.startsWith("-"));
	if (unknown.length || versions.length !== 1) throw new ReleaseError(usage());
	const target = stableVersion(versions[0] ?? "");
	if (!execute) {
		for (const line of releasePlan(target)) console.log(line);
		return;
	}
	executeRelease(target);
}

if (process.argv[1]?.endsWith("release.ts"))
	try {
		main();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
