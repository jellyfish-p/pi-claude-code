/**
 * Claude-native tool profile for pi.
 *
 * Auto mode matches Claude model IDs; flags and a command also allow off or
 * force. Read/Write/Bash/Edit/Grep delegate to pi's existing tools. Glob has
 * an independent filesystem backend for Claude Code's search semantics.
 * Descriptions and schemas advertise only implemented adapter capabilities.
 * Background Bash adds task controls and a completion notification.
 *
 * Conversation history is translated before every request: pi tool calls
 * become Claude calls for Claude models, and Claude calls become pi calls for
 * all other models. A pi `edit` with `edits[]` expands into multiple Claude
 * `Edit` calls. Multiple Claude `Edit` calls stay separate and are never
 * merged into one pi `edits[]` call.
 */

import { stat } from "node:fs/promises";
import { relative } from "node:path";
import { VERSION } from "@earendil-works/pi-coding-agent";
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
import { executeGlob } from "./glob.ts";
import { resolveLocalPath } from "./paths.ts";
import { PI_TO_CLAUDE, profileConfiguration, profileMode, toolProjection, ToolProfile, type ProfileSetting } from "./profile.ts";
import { buildReplaceAllEdit } from "./replace-all";
import { formatBashResult, formatEditResult, formatGrepResult, formatReadResult, formatWriteResult } from "./results";
import {
	translateMessages,
	type ToolMode,
} from "./translate";

export const DEFAULT_FOREGROUND_TIMEOUT = 120_000;
export const MAX_FOREGROUND_TIMEOUT = 600_000;

const taskParameters = {
	type: "object",
	properties: { task_id: { type: "string", description: "The task ID returned by a background Bash call." } },
	required: ["task_id"],
	additionalProperties: false,
} as unknown as TSchema;

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
	let settingOverride: ProfileSetting | undefined;
	let profile = new ToolProfile();
	let hostRestrictedAliases: string[] = [];
	pi.registerFlag("claude-tools", { type: "string", default: "auto", description: "Claude tool profile: auto, off, or force." });
	pi.registerFlag("claude-tools-model-pattern", { type: "string", description: "Case-insensitive model ID regular expression for auto mode (default: claude)." });
	const configuration = () => profileConfiguration(settingOverride ?? pi.getFlag("claude-tools"), pi.getFlag("claude-tools-model-pattern"));
	const modeForModel = (modelId: string | undefined) => {
		const config = configuration();
		return profileMode(config.setting, modelId, config.matcher);
	};
	const createBashTasks = () => new BackgroundBashTasks((task) => {
		const exitCode = task.exit_code === undefined ? "" : ` with exit code ${task.exit_code}`;
		pi.sendMessage({
			customType: "claude-native-tools:background-bash",
			content: `Background Bash task ${task.task_id} finished${exitCode} (${task.status}). Use TaskOutput with this task ID to read its output if needed.`,
			display: true,
			details: task,
		}, { triggerTurn: true, deliverAs: "followUp" });
	});
	let bashTasks = createBashTasks();

	function syncToolProfile(ctx: ExtensionContext, modelId = ctx.model?.id): void {
		const mode = modeForModel(modelId);
		lastMode = mode;

		const active = pi.getActiveTools();
		const desired = profile.sync(active, mode, bashTasks.hasTasks);
		if (!sameNames(active, desired)) pi.setActiveTools(desired);
		const applied = pi.getActiveTools();
		const restricted = Object.entries(PI_TO_CLAUDE)
			.filter(([native, alias]) => desired.includes(alias) && (!applied.includes(native) || !applied.includes(alias)))
			.map(([, alias]) => alias);
		hostRestrictedAliases = [...new Set([...hostRestrictedAliases, ...restricted])];
		// A strict pi --tools allowlist may admit the alias but exclude the
		// backend. Never advertise an adapter that cannot execute its work.
		const orphaned = new Set(Object.entries(PI_TO_CLAUDE)
			.filter(([native, alias]) => applied.includes(alias) && !applied.includes(native))
			.map(([, alias]) => alias));
		const runnable = applied.filter((name) => !orphaned.has(name)
			&& (name !== "TaskOutput" && name !== "TaskStop" || bashTasks.hasTasks || applied.includes("bash")));
		if (!sameNames(applied, runnable)) pi.setActiveTools(runnable);
		profile.accept(pi.getActiveTools());
	}

	function modeForContext(ctx: ExtensionContext): ToolMode {
		return ctx.model?.id === undefined ? lastMode : modeForModel(ctx.model.id);
	}

	pi.on("session_start", (_event, ctx) => {
		profile = new ToolProfile();
		hostRestrictedAliases = [];
		bashTasks.close();
		bashTasks = createBashTasks();
		syncToolProfile(ctx);
	});
	pi.on("session_shutdown", () => bashTasks.close());

	pi.on("model_select", (event, ctx) => {
		syncToolProfile(ctx, event.model.id);
	});

	pi.on("before_agent_start", (_event, ctx) => {
		syncToolProfile(ctx);
	});

	pi.registerCommand("claude-tools", {
		description: "Show Claude tool diagnostics, or set auto/off/force for this loaded session.",
		async handler(args, ctx) {
			const action = args.trim() || "status";
			if (action !== "status" && action !== "auto" && action !== "off" && action !== "force") {
				ctx.ui.notify("Usage: /claude-tools [status|auto|off|force]", "error");
				return;
			}
			if (action !== "status") {
				await ctx.waitForIdle();
				settingOverride = action;
				syncToolProfile(ctx);
			}
			const config = configuration();
			const active = pi.getActiveTools();
			const projection = toolProjection(modeForContext(ctx), active);
			const registered = pi.getAllTools().map((tool) => tool.name);
			const duplicates = registered.filter((name, index) => registered.indexOf(name) !== index);
			const missing = [...Object.values(PI_TO_CLAUDE), "TaskOutput", "TaskStop"].filter((name) => !registered.includes(name));
			const filteredAliases = [...new Set([...hostRestrictedAliases, ...Object.entries(PI_TO_CLAUDE).filter(([native, alias]) => modeForContext(ctx) === "claude" && active.includes(native) && !active.includes(alias)).map(([, alias]) => alias)])];
			const declared = active.filter((name) => !(name in PI_TO_CLAUDE && active.includes(PI_TO_CLAUDE[name as keyof typeof PI_TO_CLAUDE])));
			ctx.ui.notify([
				`pi ${VERSION}; Claude tool profile: ${config.setting}; selected: ${modeForContext(ctx)}; effective: ${projection.effective}.`,
				`Active/callable: ${active.join(", ") || "(none)"}`,
				`Declared by this profile: ${declared.join(", ") || "(none)"}`,
				`History projection: Claude aliases ${[...projection.claudeAliases].join(", ") || "(none)"}; native tools ${projection.nativeTools.join(", ") || "(none)"}.`,
				`Host-restricted aliases: ${filteredAliases.join(", ") || "(none)"}. pi tool allowlists can keep the native tool active while filtering its alias.`,
				`Conflicts: ${duplicates.length > 0 ? `duplicate names ${[...new Set(duplicates)].join(", ")}` : missing.length > 0 ? `missing adapter tools ${missing.join(", ")}` : "none visible in pi's configured tools; loader errors remain authoritative"}.`,
				"Unsupported: Grep count/type/offset/multiline/-o/-A/-B; Read PDF pages/allow_large; Bash sandbox override. Grep file lists share pi's content truncation budget. TaskOutput/TaskStop are adapter task controls. Glob does not follow directory symlinks.",
				...config.issues,
			].join("\n"), config.issues.length || duplicates.length || missing.length ? "warning" : "info");
		},
	});

	pi.on("context", (event, ctx) => {
		const mode = modeForContext(ctx);
		const projection = toolProjection(mode, pi.getActiveTools());
		const messages = translateMessages(event.messages as never, mode, projection.claudeAliases);
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
			if (input.dangerouslyDisableSandbox !== undefined) return errorResult("Bash: sandbox override is not supported by this adapter.");
			if (typeof input.command !== "string") return errorResult("Bash: command must be a string.");
			if (input.run_in_background === true) {
				if (signal?.aborted) return errorResult("Bash: the call was cancelled.");
				const timeout = input.timeout ?? DEFAULT_BACKGROUND_TIMEOUT;
				if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0 || timeout > MAX_BACKGROUND_TIMEOUT) {
					return errorResult(`Bash: background timeout must be greater than 0 and at most ${MAX_BACKGROUND_TIMEOUT} ms.`);
				}
				return bashTasks.start(input.command, timeout, ctx.executeTool);
			}

			const timeout = input.timeout ?? DEFAULT_FOREGROUND_TIMEOUT;
			if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0 || timeout > MAX_FOREGROUND_TIMEOUT) {
				return errorResult(`Bash: foreground timeout must be greater than 0 and at most ${MAX_FOREGROUND_TIMEOUT} ms.`);
			}
			// Claude Code expresses Bash timeouts in milliseconds; pi uses seconds.
			const args = { command: input.command, timeout: timeout / 1000 };
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
			if (input["-A"] !== undefined) unsupported.push("-A");
			if (input["-B"] !== undefined) unsupported.push("-B");
			if (unsupported.length > 0) {
				return errorResult(`Grep: pi's grep tool does not support ${unsupported.join(", ")} yet.`);
			}

			const mode = input.output_mode === "content" ? "content" : "files_with_matches";
			const limit = Math.floor(firstNumber(input.head_limit) ?? 250);
			const outputLimit = limit > 0 ? limit : Number.MAX_SAFE_INTEGER;
			const context = firstNumber(input.context, input["-C"]);
			const contextLines = mode === "content" ? context ?? 0 : 0;
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

	pi.registerTool({
		name: "Glob",
		label: "Glob",
		description: CLAUDE_TOOL_CATALOG.Glob.description,
		promptSnippet: "Find files by glob pattern, including hidden and gitignored files",
		parameters: CLAUDE_TOOL_CATALOG.Glob.input_schema as unknown as TSchema,
		defaultActive: false,
		prepareLoadout: hidePiAliases,
		annotations: { readOnlyHint: true },
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			return executeGlob(ctx.cwd, params as Record<string, unknown>, signal);
		},
	});
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
