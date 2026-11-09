import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { planRelease, publishArtifact, verifyArtifact } from "../tools/release.ts";

test("release tags must match a stable package version", () => {
	assert.deepEqual(planRelease("0.1.0", "v0.1.0"), { version: "0.1.0", tag: "v0.1.0" });
	assert.throws(() => planRelease("0.1.0", "v0.1.1"), /must match/);
	assert.throws(() => planRelease("0.1.0-beta.1"), /Unsupported release version/);
	assert.throws(() => planRelease("01.2.3"), /Unsupported release version/);
});

async function artifactFixture() {
	const directory = await mkdtemp(path.join(os.tmpdir(), "pi-claude-release."));
	const content = Buffer.from("prepared package fixture");
	const manifest = {
		name: "pi-claude-native-tools",
		version: "0.1.0",
		filename: "pi-claude-native-tools-0.1.0.tgz",
		commit: "verified-commit",
		sha256: createHash("sha256").update(content).digest("hex"),
		integrity: `sha512-${createHash("sha512").update(content).digest("base64")}`,
	};
	await writeFile(path.join(directory, manifest.filename), content);
	await writeFile(path.join(directory, "build-manifest.json"), JSON.stringify(manifest));
	return { directory, manifest };
}

test("new versions publish the verified archive with provenance", async () => {
	const { directory, manifest } = await artifactFixture();
	const calls: string[][] = [];
	try {
		const result = publishArtifact(directory, "v0.1.0", "verified-commit", (args, cwd) => {
			assert.equal(cwd, directory);
			calls.push(args);
			return args[0] === "view"
				? { status: 1, stdout: '{"error":{"code":"E404"}}', stderr: "not found" }
				: { status: 0, stdout: "published", stderr: "" };
		});
		assert.equal(result, "published");
		assert.deepEqual(calls[1], [
			"publish",
			`./${manifest.filename}`,
			"--access",
			"public",
			"--tag",
			"latest",
			"--provenance",
			"--registry",
			"https://registry.npmjs.org/",
		]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("retries skip identical published content and reject mismatches", async () => {
	const { directory, manifest } = await artifactFixture();
	try {
		const existing = publishArtifact(directory, "v0.1.0", "verified-commit", (args) => {
			assert.equal(args[0], "view");
			return { status: 0, stdout: JSON.stringify(manifest.integrity), stderr: "" };
		});
		assert.equal(existing, "already-published");
		assert.throws(
			() => publishArtifact(directory, "v0.1.0", "verified-commit", () => ({ status: 0, stdout: '"sha512-different"', stderr: "" })),
			/different content/,
		);
		assert.throws(
			() => publishArtifact(directory, "v0.1.0", "verified-commit", () => ({ status: 1, stdout: '{"error":{"code":"E403"}}', stderr: "registry denied" })),
			/registry lookup failed/,
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("release artifacts must match package, tag, commit and hashes", async () => {
	const { directory, manifest } = await artifactFixture();
	try {
		const artifact = verifyArtifact(directory, "v0.1.0", "verified-commit");
		assert.equal(artifact.name, "pi-claude-native-tools");
		assert.equal(artifact.integrity, manifest.integrity);
		assert.throws(() => verifyArtifact(directory, "v0.1.1", "verified-commit"), /must match/);
		assert.throws(() => verifyArtifact(directory, "v0.1.0", "another-commit"), /commit/);
		await writeFile(path.join(directory, manifest.filename), "changed bytes");
		assert.throws(() => verifyArtifact(directory, "v0.1.0", "verified-commit"), /checksum/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
