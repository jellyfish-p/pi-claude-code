import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
	formatBashResult,
	formatEditResult,
	formatGrepResult,
	formatReadResult,
	formatWriteResult,
} from "../extensions/claude-native-tools/results.ts";

function result(text: string, details?: Parameters<typeof formatReadResult>[0]["details"]) {
	return { content: [{ type: "text" as const, text }], details };
}

function textOf(output: Parameters<typeof formatReadResult>[0]) {
	const [block] = output.content;
	assert.equal(block?.type, "text");
	return block.text;
}

test("Read numbers the original lines and respects the requested offset", () => {
	assert.equal(textOf(formatReadResult(result("alpha\nbeta\n"), 1)), "1\talpha\n2\tbeta\n3\t");
	assert.equal(textOf(formatReadResult(result("beta\n\n[2 more lines in file. Use offset=3 to continue.]"), 2, 1)), "2\tbeta");
	assert.equal(textOf(formatReadResult(result(""), 3)), "3\t");
	assert.match(textOf(formatReadResult(result(""), 1)), /file exists but the contents are empty/);
});

test("Read keeps image blocks, errors, and truncation notices", () => {
	const image = { ...result("Read image file [image/png]"), content: [{ type: "image" as const, mimeType: "image/png", data: "abcd" }] };
	assert.equal(formatReadResult(image, 1), image);
	const error = { ...result("File not found"), isError: true };
	assert.equal(formatReadResult(error, 1), error);
	const notice = "[Showing lines 1-2 of 3. Use offset=3 to continue.]";
	const truncated = result(`a\nb\n\n${notice}`, { truncation: { firstLineExceedsLimit: false } });
	assert.equal(textOf(formatReadResult(truncated, 1)), `1\ta\n2\tb\n\n${notice}`);
});

test("Write distinguishes creating and overwriting, and Edit reports replace_all", () => {
	const confirmation = "(file state is current in your context — no need to Read it back)";
	const success = result("pi success");
	assert.equal(textOf(formatWriteResult(success, "sample.txt", false)), `File created successfully at: sample.txt ${confirmation}`);
	assert.equal(textOf(formatWriteResult(success, "sample.txt", true)), `The file sample.txt has been updated successfully. ${confirmation}`);
	assert.equal(textOf(formatEditResult(success, "sample.txt", true)), `The file sample.txt has been updated. All occurrences were successfully replaced. ${confirmation}`);
	assert.equal(textOf(formatEditResult(success, "sample.txt", false)), `The file sample.txt has been updated successfully. ${confirmation}`);
	const failure = { ...result("Permission denied"), isError: true };
	assert.equal(formatWriteResult(failure, "sample.txt", false), failure);
	assert.equal(formatEditResult(failure, "sample.txt", true), failure);
});

test("foreground Bash puts the exit code before captured output", () => {
	const data = { exit_code: 7, output: "stdout\nstderr\n" };
	const failure = { ...result("stdout\nstderr\n\n\nCommand exited with code 7"), isError: true, structuredContent: data };
	const formatted = formatBashResult(failure);
	assert.equal(textOf(formatted), "Exit code 7\nstdout\nstderr");
	assert.equal(formatted.isError, true);
	assert.equal(formatted.structuredContent, data);
	const quiet = { ...failure, ...result("(no output)\n\nCommand exited with code 7") };
	assert.equal(textOf(formatBashResult({ ...quiet, structuredContent: { ...data, output: "" } })), "Exit code 7");
	assert.equal(textOf(formatBashResult({ ...quiet, structuredContent: { ...data, output: "(no output)" } })), "Exit code 7\n(no output)");
	assert.equal(textOf(formatBashResult(result("stdout\n"))), "stdout");
});

const grepOptions = {
	singleFile: false,
	lineNumbers: true,
	context: false,
	relativePath: "examples",
	limit: 250,
};

test("Grep lists matching files once and paginates by file", () => {
	const output = result("sample.txt:1: omega\nsample.txt:3: omega\nother.txt:1: omega");
	const mode = "files_with_matches";
	const sample = join("examples", "sample.txt");
	const other = join("examples", "other.txt");
	assert.equal(textOf(formatGrepResult(output, { ...grepOptions, mode })), `Found 2 files\n${sample}\n${other}`);
	assert.equal(textOf(formatGrepResult(output, { ...grepOptions, mode, limit: 1 })), `Found 1 file limit: 1\n${sample}`);
	assert.equal(textOf(formatGrepResult(result("No matches found"), { ...grepOptions, mode })), "No files found");
});

test("Grep formats single-file content and paginated output", () => {
	const output = result("sample.txt:1: omega\nsample.txt-2- beta\nsample.txt:3: omega");
	const options = { ...grepOptions, mode: "content" as const, relativePath: join("examples", "sample.txt"), singleFile: true, context: true };
	assert.equal(textOf(formatGrepResult(output, options)), "1:omega\n2-beta\n3:omega");
	assert.equal(textOf(formatGrepResult(output, { ...options, lineNumbers: false })), "omega\nbeta\nomega");
	const limited = result("sample.txt:1: omega\n\n[1 matches limit reached. Use limit=2 for more, or refine pattern. 50KB limit reached]", { matchLimitReached: 1 });
	assert.equal(textOf(formatGrepResult(limited, { ...options, limit: 1 })), "1:omega\n\n[Showing results with pagination = limit: 1]\n\n[50KB limit reached]");
});
