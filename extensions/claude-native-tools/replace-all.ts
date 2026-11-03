import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface ReplaceAllEdit {
	path: string;
	edits: Array<{ oldText: string; newText: string }>;
}

/**
 * Rewrite a Claude `Edit` with `replace_all: true` as a pi `edit` call.
 *
 * pi's edit requires every oldText to be unique and both old and new text to
 * be non-empty, so a direct "replace every occurrence" call cannot be
 * expressed as N copies of the same oldText. Instead, we return one edit whose
 * oldText spans the first through the last occurrence and whose newText has
 * every occurrence replaced. That keeps the persisted tool call in pi's native
 * `edit` shape.
 *
 * If the file cannot be read or oldString is not present, return the original
 * single replacement. pi's own edit will then report the real error.
 */
export async function buildReplaceAllEdit(
	cwd: string,
	filePath: string,
	oldString: string,
	newString: string,
): Promise<ReplaceAllEdit> {
	const fallback: ReplaceAllEdit = {
		path: filePath,
		edits: [{ oldText: oldString, newText: newString }],
	};

	if (oldString.length === 0) return fallback;

	let content: string;
	try {
		content = await readFile(resolve(cwd, filePath), "utf8");
	} catch {
		return fallback;
	}

	// pi strips a leading BOM and normalizes line endings to LF before matching.
	// Do the same so replace_all works on CRLF files and at byte 0.
	if (content.startsWith("\uFEFF")) content = content.slice(1);
	content = normalizeToLF(content);
	const oldText = normalizeToLF(oldString);
	const newText = normalizeToLF(newString);

	const first = content.indexOf(oldText);
	if (first === -1) return fallback;

	const last = content.lastIndexOf(oldText);
	const span = content.slice(first, last + oldText.length);
	const replacement = span.split(oldText).join(newText);
	return {
		path: filePath,
		edits: [{ oldText: span, newText: replacement }],
	};
}

function normalizeToLF(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
