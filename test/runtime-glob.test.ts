import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { executeGlob } from "../extensions/claude-native-tools/glob.ts";

async function fixture(run: (dir: string) => Promise<void>) {
	const dir = await mkdtemp(join(tmpdir(), "pi-runtime-glob-"));
	try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

// Reference: local Claude Code 2.1.316 tool results captured on 2026-11-26.
// Its oldest-first ordering and cwd-anchored patterns were verified with
// deliberately reversed creation order and independently assigned mtimes.
test("Glob matches the verified Claude Code ordering, ignore rules, and basename behavior", async () => {
	await fixture(async (dir) => {
		await mkdir(join(dir, "basic", "src"), { recursive: true });
		await mkdir(join(dir, "basic", "ignored"));
		await mkdir(join(dir, "basic", ".git"));
		const files = ["basic/new.ts", "basic/ignored/hidden.ts", "basic/.hidden.ts", "basic/.git/internal.ts", "basic/src/old.ts"];
		for (const [index, path] of files.entries()) {
			await writeFile(join(dir, path), "fixture");
			await utimes(join(dir, path), 100 - index, 100 - index);
		}
		await writeFile(join(dir, "basic", ".gitignore"), "ignored/\n.hidden.ts\n");
		const result = await executeGlob(dir, { path: "basic", pattern: "*.ts" });
		assert.deepEqual(result.structuredContent.filenames, files.toReversed().map((file) => join(...file.split("/"))));
		assert.equal(result.structuredContent.truncated, false);
		assert.deepEqual((await executeGlob(dir, { path: "basic", pattern: "*.TS" })).structuredContent.filenames, []);
	});
});

test("Glob path limits enumeration while slash patterns and returned paths stay relative to session cwd", async () => {
	await fixture(async (dir) => {
		await mkdir(join(dir, "basic", "src"), { recursive: true });
		await mkdir(join(dir, "other", "src"), { recursive: true });
		await writeFile(join(dir, "basic", "src", "nested.ts"), "fixture");
		await writeFile(join(dir, "other", "src", "outside.ts"), "fixture");
		const expected = [join("basic", "src", "nested.ts")];
		for (const pattern of ["basic/src/*.ts", "**/src/*.ts", join(dir, "basic", "src", "*.ts"), "basic/{src,lib}/*.ts"]) {
			assert.deepEqual((await executeGlob(dir, { path: "basic", pattern })).structuredContent.filenames, expected, pattern);
		}
		for (const pattern of ["src/*.ts", "./basic/src/*.ts"]) {
			assert.deepEqual((await executeGlob(dir, { path: "basic", pattern })).structuredContent.filenames, [], pattern);
		}
		for (const path of ["basic", "missing"]) {
			assert.deepEqual((await executeGlob(dir, { path, pattern: join(dir, "other", "src", "*.ts") })).structuredContent.filenames, [join("other", "src", "outside.ts")]);
		}
		assert.deepEqual((await executeGlob(dir, { path: "basic", pattern: `!${join(dir, "basic", "src", "*.ts")}` })).structuredContent.filenames, expected);
	});
});

test("Glob aligns ripgrep glob negation, brace groups, and malformed-pattern errors", async () => {
	await fixture(async (dir) => {
		for (const name of ["old.ts", "new.ts", "note.md", "old1.ts", "old2.ts", "old3.ts", "old{1..3}.ts", "old1..3.ts"]) {
			await writeFile(join(dir, name), "fixture");
		}
		assert.deepEqual((await executeGlob(dir, { pattern: "!*.ts" })).structuredContent.filenames, ["note.md"]);
		assert.deepEqual(new Set((await executeGlob(dir, { pattern: "{old,new}.ts" })).structuredContent.filenames), new Set(["old.ts", "new.ts"]));
		assert.deepEqual((await executeGlob(dir, { pattern: "old{1..3}.ts" })).structuredContent.filenames, ["old1..3.ts"]);
		for (const pattern of ["@(old|new).ts", "+(old|new).ts"]) {
			assert.deepEqual((await executeGlob(dir, { pattern })).structuredContent.filenames, []);
		}
		for (const pattern of ["[", "[]", "[z-a]", "{old,new", "old,new}"]) {
			await assert.rejects(executeGlob(dir, { pattern }), /invalid glob pattern/);
		}
	});
});

test("Glob keeps the oldest 100 matches and reports truncation only when more exist", async () => {
	await fixture(async (dir) => {
		for (let index = 100; index >= 0; index--) {
			const file = join(dir, `${String(index).padStart(3, "0")}.ts`);
			await writeFile(file, "fixture");
			await utimes(file, index + 1, index + 1);
		}
		const result = await executeGlob(dir, { pattern: "*.ts" });
		assert.equal(result.structuredContent.numFiles, 100);
		assert.equal(result.structuredContent.truncated, true);
		assert.equal(result.structuredContent.totalMatches, 101);
		assert.equal(result.structuredContent.countIsComplete, true);
		assert.equal(result.structuredContent.filenames[0], "000.ts");
		assert.equal(result.structuredContent.filenames.at(-1), "099.ts");
		assert.match(result.content[0].text, /Showing 100 of 101 matching files; 1 more/);
		await rm(join(dir, "100.ts"));
		assert.equal((await executeGlob(dir, { pattern: "*.ts" })).structuredContent.truncated, false);
	});
});

test("Glob returns files only and never traverses a directory symlink", async () => {
	await fixture(async (dir) => {
		await mkdir(join(dir, "actual"));
		await writeFile(join(dir, "actual", "file.ts"), "fixture");
		await symlink(join(dir, "actual"), join(dir, "linked"), process.platform === "win32" ? "junction" : "dir");
		assert.deepEqual((await executeGlob(dir, { pattern: "linked/**" })).structuredContent.filenames, []);
		assert.deepEqual((await executeGlob(dir, { pattern: "*" })).structuredContent.filenames, [join("actual", "file.ts")]);
	});
});

test("Glob errors on invalid targets and null bytes, and observes cancellation", async () => {
	await fixture(async (dir) => {
		await writeFile(join(dir, "file.ts"), "fixture");
		await assert.rejects(executeGlob(dir, { path: "file.ts", pattern: "*" }), /not a directory/);
		await assert.rejects(executeGlob(dir, { path: "missing", pattern: "*" }), /ENOENT/);
		assert.equal((await executeGlob(dir, { pattern: join(dir, "missing", "*.ts") })).content[0].text, "No files found");
		assert.equal((await executeGlob(dir, { pattern: join(dir, "file.ts", "*.ts") })).content[0].text, "No files found");
		await assert.rejects(executeGlob(dir, { path: "missing\0", pattern: "*" }), /remove null bytes/);
		await assert.rejects(executeGlob(dir, { pattern: "*\0" }), /remove null bytes/);
		const controller = new AbortController();
		controller.abort();
		await assert.rejects(executeGlob(dir, { pattern: "*" }, controller.signal), /cancelled/);
		const duringIo = new AbortController();
		const running = executeGlob(dir, { pattern: "*" }, duringIo.signal);
		queueMicrotask(() => duringIo.abort());
		await assert.rejects(running, /cancelled/);
		assert.equal((await executeGlob(dir, { pattern: "*.none" })).content[0].text, "No files found");
	});
});
