import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CLAUDE_TOOL_CATALOG } from "../extensions/claude-native-tools/catalog.ts";
import { buildReplaceAllEdit } from "../extensions/claude-native-tools/replace-all.ts";

test("Read prompt and schema match pi's capabilities", () => {
	const tool = CLAUDE_TOOL_CATALOG.Read;
	const properties = tool.input_schema.properties as Record<string, unknown>;
	assert.equal(properties.pages, undefined);
	assert.equal(properties.allow_large, undefined);
	assert.doesNotMatch(tool.description, /PDF|pages|allow_large/);
	assert.match(tool.description, /Reads images/);
});

test("Write catalog uses Claude Code's native description and schema", () => {
	const tool = CLAUDE_TOOL_CATALOG.Write;
	const properties = tool.input_schema.properties as Record<string, { description?: string }>;
	assert.deepEqual(Object.keys(properties).sort(), ["content", "file_path"]);
	assert.deepEqual([...tool.input_schema.required].sort(), ["content", "file_path"]);
	assert.match(properties.file_path.description ?? "", /absolute/);
	assert.match(tool.description, /Overwriting an existing file you haven't Read will fail/);
});

test("replace_all spans the first through last occurrence", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-replace-all-"));
	try {
		const file = "replace.txt";
		await writeFile(join(dir, file), "a\nx\na\n", "utf8");
		const result = await buildReplaceAllEdit(dir, file, "a", "A");
		assert.deepEqual(result, {
			path: file,
			edits: [{ oldText: "a\nx\na", newText: "A\nx\nA" }],
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("replace_all falls back to a normal edit for one occurrence", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-replace-all-"));
	try {
		const file = "replace.txt";
		await writeFile(join(dir, file), "before\nneedle\nafter\n", "utf8");
		const result = await buildReplaceAllEdit(dir, file, "needle", "NEEDLE");
		assert.deepEqual(result, {
			path: file,
			edits: [{ oldText: "needle", newText: "NEEDLE" }],
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("replace_all falls back when the old string is missing", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-replace-all-"));
	try {
		const file = "replace.txt";
		await writeFile(join(dir, file), "nothing here\n", "utf8");
		const result = await buildReplaceAllEdit(dir, file, "missing", "present");
		assert.deepEqual(result, {
			path: file,
			edits: [{ oldText: "missing", newText: "present" }],
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("replace_all matches a file with a BOM", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-replace-all-"));
	try {
		const file = "bom.txt";
		await writeFile(join(dir, file), "\uFEFFa\na\n", "utf8");
		const result = await buildReplaceAllEdit(dir, file, "a", "A");
		assert.deepEqual(result, {
			path: file,
			edits: [{ oldText: "a\na", newText: "A\nA" }],
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("replace_all normalizes CRLF before matching", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-replace-all-"));
	try {
		const file = "crlf.txt";
		await writeFile(join(dir, file), "a\r\nx\r\na\r\n", "utf8");
		const result = await buildReplaceAllEdit(dir, file, "a", "A");
		assert.deepEqual(result, {
			path: file,
			edits: [{ oldText: "a\nx\na", newText: "A\nx\nA" }],
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
