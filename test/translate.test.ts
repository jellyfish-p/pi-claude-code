import assert from "node:assert/strict";
import test from "node:test";
import {
	isClaudeModelId,
	translateAssistantMessage,
	translateMessages,
	translateToolCallBlock,
	type ToolCallBlock,
} from "../extensions/claude-native-tools/translate.ts";

function call(name: string, arguments_: Record<string, unknown>, id = "call-1"): ToolCallBlock {
	return { type: "toolCall", id, name, arguments: arguments_ };
}

function calls(message: ReturnType<typeof translateAssistantMessage>): ToolCallBlock[] {
	return ((message.message.content as unknown[]) ?? []).filter(
		(value): value is ToolCallBlock =>
			typeof value === "object" && value !== null &&
			(value as ToolCallBlock).type === "toolCall",
	);
}

test("detects claude model ids", () => {
	assert.equal(isClaudeModelId("claude-sonnet-5"), true);
	assert.equal(isClaudeModelId("us.anthropic.claude-opus-5"), true);
	assert.equal(isClaudeModelId("CLAUDE-SONNET"), true);
	assert.equal(isClaudeModelId("glm-5"), false);
	assert.equal(isClaudeModelId(undefined), false);
});

test("translates pi read to Claude Read", () => {
	const [translated] = translateToolCallBlock(call("read", { path: "/tmp/a", offset: 2, limit: 10 }), "claude");
	assert.deepEqual(translated, call("Read", { file_path: "/tmp/a", offset: 2, limit: 10 }));
});

test("translates Claude Read back to pi read", () => {
	const [translated] = translateToolCallBlock(call("Read", { file_path: "/tmp/a", offset: 2, limit: 10 }), "pi");
	assert.deepEqual(translated, call("read", { path: "/tmp/a", offset: 2, limit: 10 }));
});

test("translates pi write to Claude Write and back", () => {
	const [claude] = translateToolCallBlock(
		call("write", { path: "/tmp/a", content: "hello\nworld" }),
		"claude",
	);
	assert.deepEqual(claude, call("Write", { file_path: "/tmp/a", content: "hello\nworld" }));

	const [piCall] = translateToolCallBlock(claude, "pi");
	assert.deepEqual(piCall, call("write", { path: "/tmp/a", content: "hello\nworld" }));
});

test("keeps a pi write intact in pi mode", () => {
	const original = call("write", { path: "relative/a.txt", content: "x" });
	const translated = translateAssistantMessage({ role: "assistant", content: [original] }, "pi");
	assert.equal(translated.changed, false);
	assert.deepEqual(calls(translated), [original]);
});

test("normalizes Claude Write to base pi write", () => {
	const original = call("Write", { file_path: "/tmp/a", content: "x" });
	const translated = translateAssistantMessage({ role: "assistant", content: [original] }, "pi");
	assert.equal(translated.changed, true);
	assert.deepEqual(calls(translated), [call("write", { path: "/tmp/a", content: "x" })]);
});

test("translates bash timeout units in both directions", () => {
	const [claude] = translateToolCallBlock(call("bash", { command: "ls", timeout: 30 }), "claude");
	assert.deepEqual(claude, call("Bash", { command: "ls", timeout: 30000 }));

	const [piCall] = translateToolCallBlock(call("Bash", { command: "ls", timeout: 30000 }), "pi");
	assert.deepEqual(piCall, call("bash", { command: "ls", timeout: 30 }));
});

test("translates pi grep to Claude Grep and back", () => {
	const [claude] = translateToolCallBlock(
		call("grep", { pattern: "foo", path: "src", glob: "*.ts", ignoreCase: true, context: 2, limit: 5 }),
		"claude",
	);
	assert.deepEqual(claude, call("Grep", {
		pattern: "foo",
		path: "src",
		glob: "*.ts",
		"-i": true,
		context: 2,
		head_limit: 5,
	}));

	const [piCall] = translateToolCallBlock(claude, "pi");
	assert.deepEqual(piCall, call("grep", {
		pattern: "foo",
		path: "src",
		glob: "*.ts",
		ignoreCase: true,
		context: 2,
		limit: 5,
	}));
});

test("expands one pi edit with edits[] into multiple Claude Edit calls", () => {
	const translated = translateAssistantMessage({
		role: "assistant",
		content: [call("edit", {
			path: "/tmp/a",
			edits: [
				{ oldText: "a", newText: "b" },
				{ oldText: "c", newText: "d" },
			],
		})],
	}, "claude");

	const edited = calls(translated);
	assert.equal(edited.length, 2);
	assert.deepEqual(edited.map((block) => block.name), ["Edit", "Edit"]);
	assert.deepEqual(edited.map((block) => block.id), ["call-1__edit_0", "call-1__edit_1"]);
	assert.deepEqual(edited.map((block) => block.arguments), [
		{ file_path: "/tmp/a", old_string: "a", new_string: "b" },
		{ file_path: "/tmp/a", old_string: "c", new_string: "d" },
	]);
});

test("duplicates the tool result for each split Claude Edit call", () => {
	const messages = translateMessages([
		{
			role: "assistant",
			content: [call("edit", {
				path: "/tmp/a",
				edits: [
					{ oldText: "a", newText: "b" },
					{ oldText: "c", newText: "d" },
				],
			})],
		},
		{
			role: "toolResult",
			toolCallId: "call-1",
			toolName: "edit",
			content: [{ type: "text", text: "ok" }],
			isError: false,
		},
	], "claude");

	const results = messages.filter((message) => message.role === "toolResult");
	assert.equal(results.length, 2);
	assert.deepEqual(results.map((message) => message.toolCallId), ["call-1__edit_0", "call-1__edit_1"]);
	assert.deepEqual(results.map((message) => message.toolName), ["Edit", "Edit"]);
});

test("keeps a normal pi edit with edits[] intact in pi mode", () => {
	const original = call("edit", {
		path: "/tmp/a",
		edits: [
			{ oldText: "a", newText: "b" },
			{ oldText: "c", newText: "d" },
		],
	});
	const translated = translateAssistantMessage({ role: "assistant", content: [original] }, "pi");
	assert.equal(translated.changed, false);
	assert.deepEqual(calls(translated), [original]);
});

test("keeps multiple Claude Edit calls as separate pi edits", () => {
	const translated = translateAssistantMessage({
		role: "assistant",
		content: [
			call("Edit", { file_path: "/tmp/a", old_string: "a", new_string: "b" }, "edit-a"),
			call("Edit", { file_path: "/tmp/a", old_string: "c", new_string: "d" }, "edit-b"),
		],
	}, "pi");

	const edited = calls(translated);
	assert.equal(edited.length, 2);
	assert.deepEqual(edited.map((block) => block.name), ["edit", "edit"]);
	assert.deepEqual(edited.map((block) => block.id), ["edit-a", "edit-b"]);
	assert.deepEqual(edited.map((block) => block.arguments), [
		{ path: "/tmp/a", edits: [{ oldText: "a", newText: "b" }] },
		{ path: "/tmp/a", edits: [{ oldText: "c", newText: "d" }] },
	]);
});

test("does not merge multiple Claude Edit calls into one edits[] call", () => {
	const translated = translateAssistantMessage({
		role: "assistant",
		content: [
			call("Edit", { file_path: "/tmp/a", old_string: "a", new_string: "b" }, "edit-a"),
			call("Edit", { file_path: "/tmp/a", old_string: "c", new_string: "d" }, "edit-b"),
		],
	}, "pi");

	const edited = calls(translated);
	assert.equal(edited.length, 2);
	for (const block of edited) {
		assert.equal((block.arguments as { edits: unknown[] }).edits.length, 1);
	}
});

test("leaves unrelated tools untouched", () => {
	const original = call("manage_todo_list", { items: [] });
	const [claude] = translateToolCallBlock(original, "claude");
	const [piCall] = translateToolCallBlock(original, "pi");
	assert.deepEqual(claude, original);
	assert.deepEqual(piCall, original);
});

test("is idempotent for already-native calls", () => {
	const original = call("Read", { file_path: "/tmp/a", limit: 1 });
	const [translated] = translateToolCallBlock(original, "claude");
	assert.deepEqual(translated, original);

	const result = translateAssistantMessage({ role: "assistant", content: [original] }, "claude");
	assert.equal(result.changed, false);
});
