import { join } from "node:path";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";

type ToolResult = Awaited<ReturnType<ExtensionToolContext["executeTool"]>>["result"];

const FILE_STATE = "(file state is current in your context — no need to Read it back)";

function singleText(result: ToolResult): string | undefined {
	const [block] = result.content;
	return result.content.length === 1 && block?.type === "text" ? block.text : undefined;
}

function withText(result: ToolResult, text: string): ToolResult {
	return { ...result, content: [{ type: "text", text }] };
}

export function formatReadResult(result: ToolResult, offset: number, limit?: number): ToolResult {
	const text = singleText(result);
	if (result.isError || text === undefined || /^Read image file \[image\//.test(text)) return result;
	if (text === "" && offset === 1) {
		return withText(result, "<system-reminder>Warning: the file exists but the contents are empty.</system-reminder>");
	}
	const details = result.details as { truncation?: { firstLineExceedsLimit?: boolean } } | undefined;
	if (details?.truncation?.firstLineExceedsLimit) return result;
	const truncation = details?.truncation ? text.match(/\n\n\[Showing lines \d+-\d+ of \d+(?: \([^\n]* limit\))?\. Use offset=\d+ to continue\.\]$/) : undefined;
	const continuation = limit === undefined ? undefined : text.match(/\n\n\[\d+ more lines in file\. Use offset=(\d+) to continue\.\]$/);
	const limitNotice = continuation && Number(continuation[1]) === offset + (limit ?? 0)
		&& text.slice(0, continuation.index).split("\n").length === limit ? continuation : undefined;
	const lines = text.slice(0, truncation?.index ?? limitNotice?.index ?? text.length).split("\n");
	const numbered = lines.map((line, index) => `${offset + index}\t${line}`).join("\n");
	return withText(result, numbered + (truncation?.[0] ?? ""));
}

export function formatWriteResult(result: ToolResult, path: string, existed: boolean | undefined): ToolResult {
	if (result.isError || existed === undefined) return result;
	const summary = existed ? `The file ${path} has been updated successfully.` : `File created successfully at: ${path}`;
	return withText(result, `${summary} ${FILE_STATE}`);
}

export function formatEditResult(result: ToolResult, path: string, replaceAll: boolean): ToolResult {
	if (result.isError) return result;
	const summary = replaceAll ? "updated. All occurrences were successfully replaced." : "updated successfully.";
	return withText(result, `The file ${path} has been ${summary} ${FILE_STATE}`);
}

export function formatBashResult(result: ToolResult): ToolResult {
	const text = singleText(result);
	if (text === undefined) return result;
	const data = result.structuredContent;
	if (result.isError) {
		if (!data || typeof data !== "object" || Array.isArray(data)) return result;
		const exitCode = data.exit_code;
		if (typeof exitCode !== "number" || exitCode === 0) return result;
		const suffix = `\n\nCommand exited with code ${exitCode}`;
		if (!text.endsWith(suffix)) return result;
		const output = text.slice(0, -suffix.length).trimEnd();
		const empty = data.output === "" && output === "(no output)";
		return withText(result, `Exit code ${exitCode}${empty || output === "" ? "" : `\n${output}`}`);
	}
	return withText(result, text.trimEnd());
}

interface GrepFormat {
	mode: "content" | "files_with_matches";
	relativePath: string;
	singleFile: boolean;
	lineNumbers: boolean;
	context: boolean;
	limit: number;
}

export function formatGrepResult(result: ToolResult, options: GrepFormat): ToolResult {
	const text = singleText(result);
	if (result.isError || text === undefined) return result;
	const filesOnly = options.mode === "files_with_matches";
	if (text === "No matches found") return filesOnly ? withText(result, "No files found") : result;
	const notice = text.match(/\n\n\[([^\n]*)\]$/);
	const rows = text.slice(0, notice?.index ?? text.length).split("\n");
	const files = new Set<string>();
	const content: string[] = [];
	let lastFile: string | undefined;
	let lastLine = 0;
	for (const row of rows) {
		const record = row.match(/^(.+?)([:-])(\d+)\2 ([\s\S]*)$/);
		if (!record) return result;
		const [, file, separator, line, match] = record;
		const displayPath = options.singleFile ? options.relativePath : join(options.relativePath, file);
		if (filesOnly) {
			if (separator === ":") files.add(displayPath);
			continue;
		}
		if (options.context && lastFile !== undefined && (file !== lastFile || Number(line) !== lastLine + 1)) {
			content.push("--");
		}
		const pathPrefix = options.singleFile ? "" : `${displayPath}${separator}`;
		const linePrefix = options.lineNumbers ? `${line}${separator}` : "";
		content.push(`${pathPrefix}${linePrefix}${match}`);
		lastFile = file;
		lastLine = Number(line);
	}

	const details = result.details as { matchLimitReached?: number } | undefined;
	const entries = filesOnly ? [...files] : content;
	const visible = entries.slice(0, options.limit);
	const paginated = entries.length > options.limit || details?.matchLimitReached !== undefined;
	if (filesOnly) {
		const count = visible.length;
		const noun = count === 1 ? "file" : "files";
		visible.unshift(`Found ${count} ${noun}${paginated ? ` limit: ${options.limit}` : ""}`);
	} else if (paginated) {
		visible.push("", `[Showing results with pagination = limit: ${options.limit}]`);
	}
	const remainingNotice = notice?.[1].replace(/^\d+ matches limit reached\. Use limit=\d+ for more, or refine pattern(?:\. )?/, "");
	if (remainingNotice) visible.push("", `[${remainingNotice}]`);
	return withText(result, visible.join("\n"));
}
