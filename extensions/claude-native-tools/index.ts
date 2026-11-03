/**
 * Claude-native tool profile for pi.
 *
 * When the active model id contains `claude`, this extension exposes
 * `Read` / `Write` / `Bash` / `Edit` / `Grep` with Claude Code's native
 * descriptions and input schemas. Their implementations delegate to pi's
 * existing `read` / `write` / `bash` / `edit` / `grep` tools, so no filesystem
 * or shell path is duplicated.
 *
 * Conversation history is translated before every request: pi tool calls
 * become Claude calls for Claude models, and Claude calls become pi calls for
 * all other models. A pi `edit` with `edits[]` expands into multiple Claude
 * `Edit` calls. Multiple Claude `Edit` calls stay separate and are never
 * merged into one pi `edits[]` call.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionToolContext,
	ToolLoadout,
	ToolLoadoutChanges,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { CLAUDE_TOOL_CATALOG } from "./catalog";
import { buildReplaceAllEdit } from "./replace-all";
import {
	isClaudeModelId,
	translateAssistantMessage,
	translateMessages,
	type ToolMode,
} from "./translate";

const PI_TO_CLAUDE: Readonly<Record<string, string>> = {
	read: "Read",
	write: "Write",
	bash: "Bash",
	edit: "Edit",
	grep: "Grep",
};

const CLAUDE_TO_PI: Readonly<Record<string, string>> = {
	Read: "read",
	Write: "write",
	Bash: "bash",
	Edit: "edit",
	Grep: "grep",
};

function modeForModel(modelId: string | undefined): ToolMode {
	return isClaudeModelId(modelId) ? "claude" : "pi";
}

function desiredTools(names: string[], mode: ToolMode): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	const add = (name: string) => {
		if (seen.has(name)) return;
		seen.add(name);
		result.push(name);
	};

	if (mode === "claude") {
		// Keep the pi tools active but hide their declarations. They must stay
		// callable because the Claude adapters delegate through executeTool().
		for (const name of names) {
			add(name);
			if (PI_TO_CLAUDE[name]) add(PI_TO_CLAUDE[name]);
			if (CLAUDE_TO_PI[name]) add(CLAUDE_TO_PI[name]);
		}
		return result;
	}

	for (const name of names) {
		if (CLAUDE_TO_PI[name]) continue;
		add(name);
	}
	for (const name of names) {
		if (CLAUDE_TO_PI[name]) add(CLAUDE_TO_PI[name]);
	}
	return result;
}

/**
 * Keep pi's original tools callable while hiding their declarations from the
 * model. `hiddenDeclarations` is exactly the pi hook for this: the tool stays
 * active and reachable through `ctx.executeTool()`, but is omitted from the
 * request's tool list and the default prompt's tool list/rules.
 */
function hidePiAliases(loadout: ToolLoadout): ToolLoadoutChanges | undefined {
	const active = new Set(loadout.declared.map((tool) => tool.name));
	const hidden = Object.entries(PI_TO_CLAUDE)
		.filter(([piName, claudeName]) => active.has(piName) && active.has(claudeName))
		.map(([piName]) => piName);
	return hidden.length > 0 ? { hiddenDeclarations: hidden } : undefined;
}

function sameNames(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((name, index) => name === b[index]);
}

function errorResult(message: string) {
	return {
		content: [{ type: "text" as const, text: message }],
		details: undefined,
		isError: true,
	};
}

function unwrap(outcome: Awaited<ReturnType<ExtensionToolContext["executeTool"]>>) {
	const result = outcome.result;
	return outcome.isError && !result.isError ? { ...result, isError: true } : result;
}

export default function claudeNativeTools(pi: ExtensionAPI) {
	let lastMode: ToolMode = "pi";

	function syncToolProfile(ctx: ExtensionContext, modelId = ctx.model?.id): void {
		const mode = modeForModel(modelId);
		lastMode = mode;

		const active = pi.getActiveTools();
		if (active.length === 0) return;

		const desired = desiredTools(active, mode);
		if (!sameNames(active, desired)) pi.setActiveTools(desired);
	}

	function modeForContext(ctx: ExtensionContext): ToolMode {
		return ctx.model?.id === undefined ? lastMode : modeForModel(ctx.model.id);
	}

	pi.on("session_start", (_event, ctx) => {
		syncToolProfile(ctx);
	});

	pi.on("model_select", (event, ctx) => {
		syncToolProfile(ctx, event.model.id);
	});

	pi.on("before_agent_start", (event, ctx) => {
		// `selectedTools` is the active set pi is about to render. It is the
		// most reliable source if the session was created before this extension
		// had a chance to inspect the model.
		const selected = event.systemPromptOptions.selectedTools;
		if (pi.getActiveTools().length === 0 && selected && selected.length > 0) {
			const mode = modeForModel(ctx.model?.id);
			lastMode = mode;
			pi.setActiveTools(desiredTools([...selected], mode));
			return;
		}
		syncToolProfile(ctx);
	});

	pi.on("context", (event, ctx) => {
		const mode = modeForContext(ctx);
		const messages = translateMessages(event.messages as never, mode);
		return { messages: messages as AgentMessage[] };
	});

	pi.on("message_end", async (event, ctx) => {
		if (event.message.role !== "assistant") return;
		// Session JSONL always stores pi's native shape. Claude tool calls are a
		// request-time projection: normalize them back to pi before pi persists
		// the assistant message and dispatches the tools.
		const normalized = await normalizeReplaceAll(event.message, ctx);
		const translated = translateAssistantMessage(normalized.message as never, "pi");
		if (!normalized.changed && !translated.changed) return;
		return { message: translated.message as AgentMessage };
	});

	pi.registerTool({
		name: "Read",
		label: "Read",
		description: CLAUDE_TOOL_CATALOG.Read.description,
		promptSnippet: "Read a file from the local filesystem",
		parameters: CLAUDE_TOOL_CATALOG.Read.input_schema as unknown as TSchema,
		defaultActive: false,
		prepareLoadout: hidePiAliases,
		annotations: { readOnlyHint: true },
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const input = params as Record<string, unknown>;
			if (input.pages !== undefined || input.allow_large === true) {
				return errorResult("Read: pi's read tool does not support pages or allow_large yet.");
			}

			const args: Record<string, unknown> = { path: input.file_path };
			if (typeof input.offset === "number") args.offset = input.offset;
			if (typeof input.limit === "number") args.limit = input.limit;
			return unwrap(await ctx.executeTool("read", args, { signal, onUpdate }));
		},
	});

	pi.registerTool({
		name: "Write",
		label: "Write",
		description: CLAUDE_TOOL_CATALOG.Write.description,
		promptSnippet: "Write content to a file",
		parameters: CLAUDE_TOOL_CATALOG.Write.input_schema as unknown as TSchema,
		defaultActive: false,
		prepareLoadout: hidePiAliases,
		annotations: { destructiveHint: true },
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const input = params as Record<string, unknown>;
			if (typeof input.file_path !== "string") {
				return errorResult("Write: file_path must be a string.");
			}
			if (typeof input.content !== "string") {
				return errorResult("Write: content must be a string.");
			}

			return unwrap(await ctx.executeTool("write", {
				path: input.file_path,
				content: input.content,
			}, { signal, onUpdate }));
		},
	});

	pi.registerTool({
		name: "Bash",
		label: "Bash",
		description: CLAUDE_TOOL_CATALOG.Bash.description,
		promptSnippet: "Execute a bash command",
		parameters: CLAUDE_TOOL_CATALOG.Bash.input_schema as unknown as TSchema,
		defaultActive: false,
		prepareLoadout: hidePiAliases,
		annotations: { destructiveHint: true, openWorldHint: true },
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const input = params as Record<string, unknown>;
			if (input.run_in_background === true) {
				return errorResult("Bash: pi's bash tool does not support run_in_background yet.");
			}

			const args: Record<string, unknown> = { command: input.command };
			if (typeof input.timeout === "number" && input.timeout > 0) {
				// Claude Code expresses Bash timeouts in milliseconds; pi uses seconds.
				args.timeout = input.timeout / 1000;
			}
			return unwrap(await ctx.executeTool("bash", args, { signal, onUpdate }));
		},
	});

	pi.registerTool({
		name: "Edit",
		label: "Edit",
		description: CLAUDE_TOOL_CATALOG.Edit.description,
		promptSnippet: "Perform exact string replacement in a file",
		parameters: CLAUDE_TOOL_CATALOG.Edit.input_schema as unknown as TSchema,
		defaultActive: false,
		prepareLoadout: hidePiAliases,
		executionMode: "sequential",
		annotations: { destructiveHint: true },
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const input = params as Record<string, unknown>;
			if (typeof input.old_string !== "string" || input.old_string.length === 0) {
				return errorResult("Edit: old_string must be a non-empty string.");
			}
			if (typeof input.new_string !== "string") {
				return errorResult("Edit: new_string must be a string.");
			}

			const editArgs = input.replace_all === true
				? await buildReplaceAllEdit(
					ctx.cwd,
					typeof input.file_path === "string" ? input.file_path : "",
					input.old_string,
					input.new_string,
				)
				: {
					path: input.file_path,
					edits: [{
						oldText: input.old_string,
						newText: input.new_string,
					}],
				};

			return unwrap(await ctx.executeTool("edit", editArgs, { signal, onUpdate }));
		},
	});

	pi.registerTool({
		name: "Grep",
		label: "Grep",
		description: CLAUDE_TOOL_CATALOG.Grep.description,
		promptSnippet: "Search file contents with ripgrep",
		parameters: CLAUDE_TOOL_CATALOG.Grep.input_schema as unknown as TSchema,
		defaultActive: false,
		prepareLoadout: hidePiAliases,
		annotations: { readOnlyHint: true },
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const input = params as Record<string, unknown>;
			const unsupported: string[] = [];
			if (typeof input.output_mode === "string" && input.output_mode !== "content") {
				unsupported.push(`output_mode=${input.output_mode}`);
			}
			if (input["-o"] === true) unsupported.push("-o");
			if (typeof input.type === "string") unsupported.push("type");
			if (typeof input.offset === "number" && input.offset !== 0) unsupported.push("offset");
			if (input.multiline === true) unsupported.push("multiline");
			if (unsupported.length > 0) {
				return errorResult(`Grep: pi's grep tool does not support ${unsupported.join(", ")} yet.`);
			}

			const context = firstNumber(input.context, input["-C"]);
			const asymmetric = Math.max(firstNumber(input["-A"]) ?? 0, firstNumber(input["-B"]) ?? 0);
			const args: Record<string, unknown> = { pattern: input.pattern };
			if (typeof input.path === "string") args.path = input.path;
			if (typeof input.glob === "string") args.glob = input.glob;
			if (input["-i"] === true) args.ignoreCase = true;
			if (context !== undefined) args.context = context;
			else if (asymmetric > 0) args.context = asymmetric;
			if (typeof input.head_limit === "number") args.limit = input.head_limit;
			return unwrap(await ctx.executeTool("grep", args, { signal, onUpdate }));
		},
	});
}

async function normalizeReplaceAll(
	message: AgentMessage,
	ctx: ExtensionContext,
): Promise<{ message: AgentMessage; changed: boolean }> {
	if (message.role !== "assistant" || !Array.isArray(message.content)) {
		return { message, changed: false };
	}

	let changed = false;
	const content: unknown[] = [];
	for (const block of message.content) {
		if (!isClaudeReplaceAll(block)) {
			content.push(block);
			continue;
		}

		const input = block.arguments;
		const args = await buildReplaceAllEdit(
			ctx.cwd,
			typeof input.file_path === "string" ? input.file_path : "",
			typeof input.old_string === "string" ? input.old_string : "",
			typeof input.new_string === "string" ? input.new_string : "",
		);
		content.push({ ...block, name: "edit", arguments: args });
		changed = true;
	}

	return changed
		? { message: { ...message, content } as AgentMessage, changed: true }
		: { message, changed: false };
}

function isClaudeReplaceAll(value: unknown): value is {
	type: "toolCall";
	name: "Edit" | "edit";
	arguments: { file_path?: unknown; old_string?: unknown; new_string?: unknown };
} {
	if (typeof value !== "object" || value === null) return false;
	const block = value as Record<string, unknown>;
	if (block.type !== "toolCall" || (block.name !== "Edit" && block.name !== "edit")) return false;
	if (typeof block.arguments !== "object" || block.arguments === null) return false;
	return (block.arguments as Record<string, unknown>).replace_all === true;
}

function firstNumber(...values: unknown[]): number | undefined {
	for (const value of values) {
		if (typeof value === "number" && Number.isFinite(value)) return value;
	}
	return undefined;
}
