import assert from "node:assert/strict";
import test from "node:test";
import { CLAUDE_TOOL_CATALOG } from "../extensions/claude-native-tools/catalog.ts";

test("Grep advertises only the implemented pi subset and symmetric context", () => {
	const tool = CLAUDE_TOOL_CATALOG.Grep;
	assert.deepEqual(Object.keys(tool.input_schema.properties).sort(), ["pattern", "path", "glob", "output_mode", "-C", "context", "-n", "-i", "head_limit"].sort());
	assert.deepEqual(tool.input_schema.properties.output_mode.enum, ["content", "files_with_matches"]);
	assert.match(tool.description, /same number of lines before and after/);
	assert.match(tool.description, /truncate.*before every matching file is found/);
	assert.doesNotMatch(tool.description, /multiline|`type`|"count"|-A\/-B/);
	for (const name of ["context", "-C", "head_limit"] as const) {
		assert.equal(tool.input_schema.properties[name].type, "integer");
		assert.equal(tool.input_schema.properties[name].minimum, 0);
	}
});

test("Bash schema distinguishes foreground and background timeout limits without host-specific promises", () => {
	const tool = CLAUDE_TOOL_CATALOG.Bash;
	assert.deepEqual(Object.keys(tool.input_schema.properties).sort(), ["command", "timeout", "description", "run_in_background"].sort());
	assert.equal(tool.input_schema.properties.timeout.exclusiveMinimum, 0);
	assert.equal(tool.input_schema.properties.timeout.maximum, 7_200_000);
	assert.deepEqual(tool.input_schema.anyOf, [
		{ properties: { run_in_background: { const: true } }, required: ["run_in_background"] },
		{ properties: { run_in_background: { const: false }, timeout: { maximum: 600000 } } },
	]);
	assert.match(tool.description, /default 120000, maximum 600000/);
	assert.doesNotMatch(tool.description, /Git Bash|Monitor|cd.*carries|Foreground `sleep` is blocked/);
});

test("Glob keeps the captured parameter contract and documents its independently implemented behavior", () => {
	const tool = CLAUDE_TOOL_CATALOG.Glob;
	assert.deepEqual(Object.keys(tool.input_schema.properties).sort(), ["path", "pattern"]);
	assert.deepEqual(tool.input_schema.required, ["pattern"]);
	assert.match(tool.description, /hidden and gitignored/);
	assert.match(tool.description, /100/);
	assert.match(tool.description, /oldest first/);
	assert.match(tool.description, /does not execute pi's find tool/);
});
