/**
 * Pure context translation between pi's native tools and Claude Code's native
 * tools. This module intentionally has no pi-runtime imports so it can be
 * unit-tested with plain Node.
 */

export type ToolMode = "pi" | "claude";

export const PI_TO_CLAUDE_TOOL: Readonly<Record<string, string>> = {
	read: "Read",
	write: "Write",
	bash: "Bash",
	edit: "Edit",
	grep: "Grep",
};

export const CLAUDE_TO_PI_TOOL: Readonly<Record<string, string>> = {
	Read: "read",
	Write: "write",
	Bash: "bash",
	Edit: "edit",
	Grep: "grep",
};

type JsonObject = Record<string, unknown>;

export interface ToolCallBlock {
	type: "toolCall";
	id: string;
	name: string;
	arguments?: unknown;
	[key: string]: unknown;
}

interface MessageLike {
	role?: string;
	content?: unknown;
	toolCallId?: string;
	toolName?: string;
	[key: string]: unknown;
}

export interface AssistantTranslation {
	message: MessageLike;
	changed: boolean;
	splitIds: Map<string, string[]>;
}

export function isClaudeModelId(modelId: string | undefined | null): boolean {
	return typeof modelId === "string" && /claude/i.test(modelId);
}

export function mapToolName(name: string, mode: ToolMode): string {
	if (mode === "claude") return PI_TO_CLAUDE_TOOL[name] ?? name;
	return CLAUDE_TO_PI_TOOL[name] ?? name;
}

export function translateToolCallBlock(block: ToolCallBlock, mode: ToolMode): ToolCallBlock[] {
	return mode === "claude" ? toClaudeCalls(block) : toPiCalls(block);
}

/**
 * Translate the complete conversation for the current model. System messages
 * and tool declarations are intentionally left to pi's active-tool state; this
 * function only rewrites assistant tool calls and their results.
 */
export function translateMessages(messages: MessageLike[], mode: ToolMode): MessageLike[] {
	const result: MessageLike[] = [];
	const splitIds = new Map<string, string[]>();

	for (const message of messages) {
		if (message.role === "assistant") {
			const translated = translateAssistantMessage(message, mode);
			result.push(translated.message);
			for (const [oldId, newIds] of translated.splitIds) splitIds.set(oldId, newIds);
			continue;
		}

		if (message.role === "toolResult" && typeof message.toolCallId === "string") {
			const ids = splitIds.get(message.toolCallId) ?? [message.toolCallId];
			const toolName = typeof message.toolName === "string"
				? mapToolName(message.toolName, mode)
				: message.toolName;

			for (const id of ids) {
				if (ids.length === 1 && id === message.toolCallId && toolName === message.toolName) {
					result.push(message);
				} else {
					result.push({
						...message,
						toolCallId: id,
						...(toolName === undefined ? {} : { toolName }),
					});
				}
			}
			continue;
		}

		result.push(message);
	}

	return result;
}

/**
 * Translate a single assistant message. If a pi `edit` call contains multiple
 * edits, it is expanded into multiple Claude `Edit` calls. The inverse
 * direction leaves every Claude `Edit` as a separate pi `edit` call.
 */
export function translateAssistantMessage(message: MessageLike, mode: ToolMode): AssistantTranslation {
	if (message.role !== "assistant" || !Array.isArray(message.content)) {
		return { message, changed: false, splitIds: new Map() };
	}

	const content: unknown[] = [];
	const splitIds = new Map<string, string[]>();
	let changed = false;

	for (const block of message.content) {
		if (!isToolCallBlock(block)) {
			content.push(block);
			continue;
		}

		const translated = translateToolCallBlock(block, mode);
		if (translated.length === 1 && sameToolCall(translated[0], block)) {
			content.push(block);
			continue;
		}

		changed = true;
		content.push(...translated);
		if (translated.length > 1) splitIds.set(block.id, translated.map((call) => call.id));
	}

	return changed
		? { message: { ...message, content }, changed: true, splitIds }
		: { message, changed: false, splitIds };
}

function toClaudeCalls(block: ToolCallBlock): ToolCallBlock[] {
	const name = block.name;
	const args = asObject(block.arguments);

	// Already canonical: leave the call byte-for-byte untouched. This is what
	// makes repeated requests idempotent.
	if (name === "Read" || name === "Write" || name === "Bash" || name === "Grep") return [block];
	if (name === "Edit") {
		return Array.isArray(args.edits) ? toClaudeEditCalls(block, args) : [block];
	}
	if (name === "read") {
		return [withArgs(block, "Read", toClaudeReadArgs(args))];
	}
	if (name === "write") {
		return [withArgs(block, "Write", toClaudeWriteArgs(args))];
	}
	if (name === "bash") {
		return [withArgs(block, "Bash", toClaudeBashArgs(args))];
	}
	if (name === "grep") {
		return [withArgs(block, "Grep", toClaudeGrepArgs(args))];
	}
	if (name === "edit") {
		return toClaudeEditCalls(block, args);
	}

	return [{ ...block, name: mapToolName(name, "claude") }];
}

function toPiCalls(block: ToolCallBlock): ToolCallBlock[] {
	const name = block.name;
	const args = asObject(block.arguments);

	// Already pi-native: do not split a legitimate multi-edit call. In
	// particular, `edits[]` must survive a normal pi-mode request untouched.
	if (name === "read" || name === "write" || name === "bash" || name === "edit" || name === "grep") return [block];
	if (name === "Read") return [withArgs(block, "read", toPiReadArgs(args))];
	if (name === "Write") return [withArgs(block, "write", toPiWriteArgs(args))];
	if (name === "Bash") return [withArgs(block, "bash", toPiBashArgs(args))];
	if (name === "Grep") return [withArgs(block, "grep", toPiGrepArgs(args))];
	if (name === "Edit") return toPiEditCalls(block, args);

	return [{ ...block, name: mapToolName(name, "pi") }];
}

function toClaudeEditCalls(block: ToolCallBlock, args: JsonObject): ToolCallBlock[] {
	const edits = Array.isArray(args.edits) ? args.edits : [];
	if (edits.length === 0) {
		return [withArgs(block, "Edit", toClaudeEditArgs(args))];
	}

	// A pi `edit` call is one operation with N replacements. Claude's native
	// `Edit` is one replacement per call, so emit N calls and let pi execute
	// them independently. Never collapse them back into one pi edit later.
	return edits.map((entry, index) => {
		const edit = asObject(entry);
		return {
			...block,
			id: splitToolCallId(block.id, index, edits.length),
			name: "Edit",
			arguments: {
				file_path: firstString(args.file_path, args.path),
				old_string: firstString(edit.old_string, edit.oldText),
				new_string: firstString(edit.new_string, edit.newText),
			},
		};
	});
}

function toClaudeEditArgs(args: JsonObject): JsonObject {
	return {
		file_path: firstString(args.file_path, args.path),
		old_string: firstString(args.old_string, args.oldText),
		new_string: firstString(args.new_string, args.newText),
		...(typeof args.replace_all === "boolean" ? { replace_all: args.replace_all } : {}),
	};
}

function toPiEditCalls(block: ToolCallBlock, args: JsonObject): ToolCallBlock[] {
	const edits = Array.isArray(args.edits) ? args.edits : [];
	if (edits.length > 0) {
		// Defensive: an `Edit` shaped call that still carries pi's edits[] is
		// split into separate pi calls, not merged.
		return edits.map((entry, index) => {
			const edit = asObject(entry);
			return {
				...block,
				id: edits.length > 1 ? splitToolCallId(block.id, index, edits.length) : block.id,
				name: "edit",
				arguments: {
					path: firstString(args.path, args.file_path),
					edits: [{
						oldText: firstString(edit.oldText, edit.old_string),
						newText: firstString(edit.newText, edit.new_string),
					}],
				},
			};
		});
	}

	return [withArgs(block, "edit", {
		path: firstString(args.path, args.file_path),
		edits: [{
			oldText: firstString(args.oldText, args.old_string),
			newText: firstString(args.newText, args.new_string),
		}],
	})];
}

function toClaudeWriteArgs(args: JsonObject): JsonObject {
	return {
		file_path: firstString(args.file_path, args.path),
		content: args.content,
	};
}

function toPiWriteArgs(args: JsonObject): JsonObject {
	return {
		path: firstString(args.path, args.file_path),
		content: args.content,
	};
}

function toClaudeReadArgs(args: JsonObject): JsonObject {
	return {
		file_path: firstString(args.file_path, args.path),
		...(typeof args.offset === "number" ? { offset: args.offset } : {}),
		...(typeof args.limit === "number" ? { limit: args.limit } : {}),
	};
}

function toPiReadArgs(args: JsonObject): JsonObject {
	return {
		path: firstString(args.path, args.file_path),
		...(typeof args.offset === "number" ? { offset: args.offset } : {}),
		...(typeof args.limit === "number" ? { limit: args.limit } : {}),
	};
}

function toClaudeBashArgs(args: JsonObject): JsonObject {
	const timeout = typeof args.timeout === "number" ? args.timeout * 1000 : undefined;

	return {
		command: args.command,
		...(timeout === undefined ? {} : { timeout }),
		...(typeof args.description === "string" ? { description: args.description } : {}),
		...(typeof args.run_in_background === "boolean" ? { run_in_background: args.run_in_background } : {}),
		...(typeof args.dangerouslyDisableSandbox === "boolean"
			? { dangerouslyDisableSandbox: args.dangerouslyDisableSandbox }
			: {}),
	};
}

function toPiBashArgs(args: JsonObject): JsonObject {
	const timeout = typeof args.timeout === "number" ? args.timeout / 1000 : undefined;

	return {
		command: args.command,
		...(timeout === undefined ? {} : { timeout }),
	};
}

function toClaudeGrepArgs(args: JsonObject): JsonObject {
	const context = firstNumber(args.context, args["-C"], args["-A"], args["-B"]);
	return {
		pattern: args.pattern,
		...(typeof args.path === "string" ? { path: args.path } : {}),
		...(typeof args.glob === "string" ? { glob: args.glob } : {}),
		...(args.ignoreCase === true ? { "-i": true } : {}),
		...(context === undefined ? {} : { context }),
		...(typeof args.limit === "number" ? { head_limit: args.limit } : {}),
	};
}

function toPiGrepArgs(args: JsonObject): JsonObject {
	const context = firstNumber(args.context, args["-C"]);
	const asymmetricContext = Math.max(
		typeof args["-A"] === "number" ? args["-A"] : 0,
		typeof args["-B"] === "number" ? args["-B"] : 0,
	);
	const effectiveContext = context ?? (asymmetricContext > 0 ? asymmetricContext : undefined);

	return {
		pattern: args.pattern,
		...(typeof args.path === "string" ? { path: args.path } : {}),
		...(typeof args.glob === "string" ? { glob: args.glob } : {}),
		...(args["-i"] === true ? { ignoreCase: true } : {}),
		...(effectiveContext === undefined ? {} : { context: effectiveContext }),
		...(typeof args.head_limit === "number" ? { limit: args.head_limit } : {}),
	};
}

function withArgs(block: ToolCallBlock, name: string, args: JsonObject): ToolCallBlock {
	return { ...block, name, arguments: args };
}

function splitToolCallId(id: string, index: number, total: number): string {
	if (total <= 1) return id;
	const suffix = `__edit_${index}`;
	return `${id.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`;
}

function sameToolCall(a: ToolCallBlock, b: ToolCallBlock): boolean {
	return a.id === b.id && a.name === b.name && deepEqual(a.arguments, b.arguments);
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (a === null || b === null || typeof a !== "object") return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		return a.every((value, index) => deepEqual(value, b[index]));
	}
	if (!isObject(a) || !isObject(b)) return false;
	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) return false;
	return aKeys.every((key) => key in b && deepEqual(a[key], b[key]));
}

function isToolCallBlock(value: unknown): value is ToolCallBlock {
	return isObject(value) && value.type === "toolCall" && typeof value.id === "string" && typeof value.name === "string";
}

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(value: unknown): JsonObject {
	return isObject(value) ? value : {};
}

function firstString(...values: unknown[]): string {
	for (const value of values) {
		if (typeof value === "string") return value;
	}
	return "";
}

function firstNumber(...values: unknown[]): number | undefined {
	for (const value of values) {
		if (typeof value === "number" && Number.isFinite(value)) return value;
	}
	return undefined;
}
