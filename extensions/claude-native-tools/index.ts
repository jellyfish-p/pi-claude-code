/**
 * Claude-native tool profile for pi.
 *
 * When the active model id contains `claude`, this extension exposes
 * `Read` / `Write` / `Bash` / `Edit` / `Grep` with Claude Code's native
 * descriptions and input schemas. Their implementations delegate to pi's
 * existing `read` / `write` / `bash` / `edit` / `grep` tools. Background Bash
 * calls additionally expose task controls and a completion notification.
 *
 * Conversation history is translated before every request: pi tool calls
 * become Claude calls for Claude models, and Claude calls become pi calls for
 * all other models. A pi `edit` with `edits[]` expands into multiple Claude
 * `Edit` calls. Multiple Claude `Edit` calls stay separate and are never
 * merged into one pi `edits[]` call.
 */

import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionToolContext,
	ToolLoadout,
	ToolLoadoutChanges,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { BackgroundBashTasks, DEFAULT_BACKGROUND_TIMEOUT, MAX_BACKGROUND_TIMEOUT } from "./background-bash";
import { CLAUDE_TOOL_CATALOG } from "./catalog";
import { buildReplaceAllEdit } from "./replace-all";
import { formatBashResult, formatEditResult, formatGrepResult, formatReadResult, formatWriteResult } from "./results";
import {
	isClaudeModelId,
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

const taskParameters = {
	type: "object",
	properties: { task_id: { type: "string", description: "The task ID returned by a background Bash call." } },
	required: ["task_id"],
	additionalProperties: false,
} as unknown as TSchema;

function modeForModel(modelId: string | undefined): ToolMode {
	return isClaudeModelId(modelId) ? "claude" : "pi";
}

function desiredTools(names: string[], mode: ToolMode, hasBashTasks: boolean): string[] {
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
	} else {
		for (const name of names) {
			if (CLAUDE_TO_PI[name]) continue;
			add(name);
		}
		for (const name of names) {
			if (CLAUDE_TO_PI[name]) add(CLAUDE_TO_PI[name]);
		}
	}
	if (hasBashTasks || seen.has("Bash")) {
		add("TaskOutput");
		add("TaskStop");
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
	const bashTasks = new BackgroundBashTasks((task) => {
		const exitCode = task.exit_code === undefined ? "" : ` with exit code ${task.exit_code}`;
		pi.sendMessage({
			customType: "claude-native-tools:background-bash",
			content: `Background Bash task ${task.task_id} finished${exitCode} (${task.status}). Use TaskOutput with this task ID to read its output if needed.`,
			display: true,
			details: task,
		}, { triggerTurn: true, deliverAs: "followUp" });
	});

	function syncToolProfile(ctx: ExtensionContext, modelId = ctx.model?.id): void {
		const mode = modeForModel(modelId);
		lastMode = mode;

		const active = pi.getActiveTools();
		if (active.length === 0) return;

		const desired = desiredTools(active, mode, bashTasks.hasTasks);
		if (!sameNames(active, desired)) pi.setActiveTools(desired);
	}

	function modeForContext(ctx: ExtensionContext): ToolMode {
		return ctx.model?.id === undefined ? lastMode : modeForModel(ctx.model.id);
	}

	pi.on("session_start", (_event, ctx) => {
		syncToolProfile(ctx);
	});
	pi.on("session_shutdown", () => bashTasks.close());

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
			pi.setActiveTools(desiredTools([...selected], mode, bashTasks.hasTasks));
			return;
		}
		syncToolProfile(ctx);
	});

	pi.on("context", (event, ctx) => {
		const mode = modeForContext(ctx);
		const messages = translateMessages(event.messages as never, mode);
		return { messages: messages as AgentMessage[] };
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
			const result = unwrap(await ctx.executeTool("read", args, { signal, onUpdate }));
			const offset = typeof input.offset === "number" ? Math.max(1, input.offset) : 1;
			return formatReadResult(result, offset, typeof input.limit === "number" ? input.limit : undefined);
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
		executionMode: "sequential",
		annotations: { destructiveHint: true },
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const input = params as Record<string, unknown>;
			if (typeof input.file_path !== "string") {
				return errorResult("Write: file_path must be a string.");
			}
			if (typeof input.content !== "string") {
				return errorResult("Write: content must be a string.");
			}

			const before = await inspectPath(resolveLocalPath(ctx.cwd, input.file_path));
			const result = unwrap(await ctx.executeTool("write", {
				path: input.file_path,
				content: input.content,
			}, { signal, onUpdate }));
			return formatWriteResult(result, input.file_path, before === undefined ? undefined : before !== null);
		},
	});

	pi.registerTool({
		name: "Bash",
		label: "Bash",
		description: `${CLAUDE_TOOL_CATALOG.Bash.description}\n\nA background call returns a task ID immediately. Use TaskOutput to inspect its current output and TaskStop to stop it.`,
		promptSnippet: "Execute a bash command",
		parameters: CLAUDE_TOOL_CATALOG.Bash.input_schema as unknown as TSchema,
		defaultActive: false,
		prepareLoadout: hidePiAliases,
		annotations: { destructiveHint: true, openWorldHint: true },
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const input = params as Record<string, unknown>;
			if (input.run_in_background === true) {
				if (signal?.aborted) return errorResult("Bash: the call was cancelled.");
				if (typeof input.command !== "string") return errorResult("Bash: command must be a string.");
				const timeout = input.timeout ?? DEFAULT_BACKGROUND_TIMEOUT;
				if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0 || timeout > MAX_BACKGROUND_TIMEOUT) {
					return errorResult(`Bash: background timeout must be greater than 0 and at most ${MAX_BACKGROUND_TIMEOUT} ms.`);
				}
				return bashTasks.start(input.command, timeout, ctx.executeTool);
			}

			const args: Record<string, unknown> = { command: input.command };
			if (typeof input.timeout === "number" && input.timeout > 0) {
				// Claude Code expresses Bash timeouts in milliseconds; pi uses seconds.
				args.timeout = input.timeout / 1000;
			}
			return formatBashResult(unwrap(await ctx.executeTool("bash", args, { signal, onUpdate })));
		},
	});

	pi.registerTool({
		name: "TaskOutput",
		label: "TaskOutput",
		description: "Get the current status and captured stdout and stderr of a background Bash task by ID. Returns immediately, including while the task is running.",
		parameters: taskParameters,
		defaultActive: false,
		annotations: { readOnlyHint: true },
		async execute(_toolCallId, params) {
			const id = (params as { task_id: string }).task_id;
			return bashTasks.output(id) ?? errorResult(`TaskOutput: unknown Bash task ID ${id}.`);
		},
	});

	pi.registerTool({
		name: "TaskStop",
		label: "TaskStop",
		description: "Stop a background Bash task by ID. Use TaskOutput to check its final status and read any output it produced.",
		parameters: taskParameters,
		defaultActive: false,
		annotations: { destructiveHint: true },
		async execute(_toolCallId, params) {
			const id = (params as { task_id: string }).task_id;
			return bashTasks.stop(id) ?? errorResult(`TaskStop: unknown Bash task ID ${id}.`);
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

			const path = typeof input.file_path === "string" ? input.file_path : "";
			const replaceAll = input.replace_all === true;
			const editArgs = replaceAll
				? await buildReplaceAllEdit(
					ctx.cwd,
					path,
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

			return formatEditResult(unwrap(await ctx.executeTool("edit", editArgs, { signal, onUpdate })), path, replaceAll);
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
			if (input.output_mode === "count") {
				unsupported.push(`output_mode=${input.output_mode}`);
			}
			if (input["-o"] === true) unsupported.push("-o");
			if (typeof input.type === "string") unsupported.push("type");
			if (typeof input.offset === "number" && input.offset !== 0) unsupported.push("offset");
			if (input.multiline === true) unsupported.push("multiline");
			if (unsupported.length > 0) {
				return errorResult(`Grep: pi's grep tool does not support ${unsupported.join(", ")} yet.`);
			}

			const mode = input.output_mode === "content" ? "content" : "files_with_matches";
			const limit = Math.floor(firstNumber(input.head_limit) ?? 250);
			const outputLimit = limit > 0 ? limit : Number.MAX_SAFE_INTEGER;
			const context = firstNumber(input.context, input["-C"]);
			const asymmetric = Math.max(firstNumber(input["-A"]) ?? 0, firstNumber(input["-B"]) ?? 0);
			const contextLines = mode === "content" ? context ?? asymmetric : 0;
			const args: Record<string, unknown> = { pattern: input.pattern };
			if (typeof input.path === "string") args.path = input.path;
			if (typeof input.glob === "string") args.glob = input.glob;
			if (input["-i"] === true) args.ignoreCase = true;
			if (contextLines > 0) args.context = contextLines;
			args.limit = mode === "content" ? outputLimit : Number.MAX_SAFE_INTEGER;
			const searchPath = typeof input.path === "string" ? resolveLocalPath(ctx.cwd, input.path) : ctx.cwd;
			const target = await inspectPath(searchPath);
			const result = unwrap(await ctx.executeTool("grep", args, { signal, onUpdate }));
			return formatGrepResult(result, {
				mode,
				relativePath: relative(ctx.cwd, searchPath),
				singleFile: target?.isFile() ?? false,
				lineNumbers: input["-n"] !== false,
				context: contextLines > 0,
				limit: outputLimit,
			});
		},
	});
}

function resolveLocalPath(cwd: string, input: string): string {
	const path = input.replace(/^@/, "");
	if (path.startsWith("file://")) {
		try {
			return fileURLToPath(path);
		} catch {
			return resolve(cwd, path);
		}
	}
	if (path === "~") return homedir();
	if (/^~[/\\]/.test(path)) return resolve(homedir(), path.slice(2));
	return resolve(cwd, path);
}

async function inspectPath(path: string) {
	try {
		return await stat(path);
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT" ? null : undefined;
	}
}

function firstNumber(...values: unknown[]): number | undefined {
	for (const value of values) {
		if (typeof value === "number" && Number.isFinite(value)) return value;
	}
	return undefined;
}
