import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("the published tool catalog is reproducible from the checked-in capture", async () => {
	const root = fileURLToPath(new URL("../", import.meta.url));
	const scratch = await mkdtemp(join(tmpdir(), "pi-claude-catalog-"));
	try {
		for (const directory of ["scripts", "docs/data", "extensions/claude-native-tools"]) {
			await mkdir(join(scratch, directory), { recursive: true });
		}
		for (const file of ["scripts/generate-claude-tools.mjs", "docs/data/tools.json"]) {
			await copyFile(join(root, file), join(scratch, file));
		}
		execFileSync(process.execPath, ["scripts/generate-claude-tools.mjs"], { cwd: scratch, timeout: 10_000 });
		const output = "extensions/claude-native-tools/catalog.ts";
		assert.equal((await readFile(join(scratch, output), "utf8")).replaceAll("\r\n", "\n"), (await readFile(join(root, output), "utf8")).replaceAll("\r\n", "\n"), "Run npm run generate:claude-tools and commit the generated catalog");
	} finally { await rm(scratch, { recursive: true, force: true }); }
});
