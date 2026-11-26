import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createAgentSession, createAgentSessionRuntime, DefaultResourceLoader,
	ModelRuntime, SessionManager, SettingsManager,
	type AgentSession, type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";

const extensionPath = fileURLToPath(new URL("../../extensions/claude-native-tools/index.ts", import.meta.url));

export interface FakeRequest {
	model: string;
	tools?: Array<{ function: { name: string; parameters: Record<string, unknown> } }>;
	messages: Array<Record<string, any>>;
}
export interface Call { id: string; name: string; arguments: Record<string, unknown> }
export type Reply = string | Call[];
type Response = Reply | ((request: FakeRequest) => Reply | Promise<Reply>);

export async function waitFor(check: () => unknown, message: string, timeoutMs = 10_000) {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		assert.ok(Date.now() < deadline, message);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

/** A real pi SDK session and loader. Only the provider's HTTP endpoint is fake. */
export async function createHarness(options: {
	tools?: string[]; excludeTools?: string[]; noTools?: "all" | "builtin";
	defaultTools?: string[]; model?: string; flags?: Record<string, string>; hook?: ExtensionFactory;
	api?: "openai-completions" | "anthropic-messages";
} = {}) {
	const root = await mkdtemp(join(tmpdir(), "pi-claude-integration-"));
	const cwd = join(root, "project");
	const agentDir = join(root, "agent");
	await mkdir(cwd, { recursive: true });
	await mkdir(agentDir, { recursive: true });
	const requests: FakeRequest[] = [];
	const replies: Response[] = [];
	const errors: unknown[] = [];
	const events: any[] = [];
	const lifecycle: Array<{ type: string; reason: string }> = [];
	const server = createServer(async (req, res) => {
		try {
			if (options.api === "anthropic-messages") {
				assert.ok(req.url?.startsWith("/v1/messages"));
				assert.equal(req.headers["x-api-key"], "integration-fake-key");
			} else {
				assert.equal(req.url, "/v1/chat/completions");
				assert.equal(req.headers.authorization, "Bearer integration-fake-key");
			}
			let raw = "";
			for await (const chunk of req) raw += chunk;
			const body: FakeRequest = JSON.parse(raw);
			requests.push(body);
			const next = replies.shift() ?? "done";
			const reply = typeof next === "function" ? await next(body) : next;
			if (options.api === "anthropic-messages") {
				res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
				const emit = (type: string, data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data as object })}\n\n`);
				emit("message_start", { message: { id: `fake-${requests.length}`, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
				if (typeof reply === "string") {
					emit("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
					emit("content_block_delta", { index: 0, delta: { type: "text_delta", text: reply } });
					emit("content_block_stop", { index: 0 });
				} else {
					for (const [index, call] of reply.entries()) {
						emit("content_block_start", { index, content_block: { type: "tool_use", id: call.id, name: call.name, input: {} } });
						emit("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(call.arguments) } });
						emit("content_block_stop", { index });
					}
				}
				emit("message_delta", { delta: { stop_reason: typeof reply === "string" ? "end_turn" : "tool_use", stop_sequence: null }, usage: { output_tokens: 1 } });
				emit("message_stop", {});
				res.end();
				return;
			}
			const base = { id: `fake-${requests.length}`, object: "chat.completion.chunk", created: 1, model: body.model };
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
			const delta = typeof reply === "string" ? { role: "assistant", content: reply } : {
				role: "assistant", tool_calls: reply.map((call, index) => ({
					index, id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) },
				})),
			};
			res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
			res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: typeof reply === "string" ? "stop" : "tool_calls" }] })}\n\n`);
			res.end("data: [DONE]\n\n");
		} catch (error) {
			errors.push(error);
			res.writeHead(500).end("Fake provider failed");
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const modelRuntime = await ModelRuntime.create({
		// In-memory credentials and catalog avoid all user auth/config files.
		credentials: { read: async () => undefined, list: async () => [], modify: async () => undefined, delete: async () => {} },
		modelsPath: null, allowModelNetwork: false, refreshOnCreate: false,
	});
	modelRuntime.registerProvider("integration-fake", {
		name: "Integration fake", api: options.api ?? "openai-completions", apiKey: "integration-fake-key",
		baseUrl: `http://127.0.0.1:${address.port}${options.api === "anthropic-messages" ? "" : "/v1"}`,
		models: ["claude-integration", "plain-integration"].map((id) => ({
			type: "chat", id, name: id, reasoning: false, input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 4096,
		})),
	});
	const observer: ExtensionFactory = (pi) => {
		pi.on("session_start", (event) => { lifecycle.push({ type: event.type, reason: event.reason }); });
		pi.on("session_shutdown", (event) => { lifecycle.push({ type: event.type, reason: event.reason }); });
		pi.on("tool_call", (event) => { events.push(structuredClone(event)); });
		pi.on("tool_result", (event) => { events.push(structuredClone(event)); });
	};
	let runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>> | undefined;
	try {
		runtime = await createAgentSessionRuntime(async (input) => {
			const settingsManager = SettingsManager.inMemory({
				compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off",
				...(options.defaultTools ? { defaultTools: options.defaultTools } : {}),
			}, { cwd: input.cwd, agentDir: input.agentDir });
			const resourceLoader = new DefaultResourceLoader({
				cwd: input.cwd, agentDir: input.agentDir, settingsManager,
				noExtensions: true, additionalExtensionPaths: [extensionPath],
				disabledBuiltinExtensions: ["mcp"], noSkills: true, noPromptTemplates: true,
				noThemes: true, noContextFiles: true,
				extensionFactories: [observer, ...(options.hook ? [options.hook] : [])],
			});
			await resourceLoader.reload();
			const loaded = resourceLoader.getExtensions();
			assert.deepEqual(loaded.errors, [], "The actual index.ts must load without errors");
			assert.equal(loaded.extensions.filter((extension) => resolve(extension.path) === resolve(extensionPath)).length, 1);
			for (const [key, value] of Object.entries(options.flags ?? {})) loaded.runtime.flagValues.set(key, value);
			const result = await createAgentSession({
				...input, resourceLoader, modelRuntime, settingsManager,
				model: modelRuntime.getModel("integration-fake", options.model ?? "claude-integration"),
				tools: options.tools, excludeTools: options.excludeTools, noTools: options.noTools,
			});
			await result.session.bindExtensions({ mode: "json", onError: (error) => errors.push(error) });
			result.session.subscribe((event) => events.push(event));
			return { ...result, services: { ...input, modelRuntime, settingsManager, resourceLoader, diagnostics: [] }, diagnostics: [] };
		}, { cwd, agentDir, sessionManager: SessionManager.create(cwd, join(root, "sessions")) });
		return {
			cwd, agentDir, requests, events, lifecycle, errors, runtime,
			get session() { return runtime!.session; },
			enqueue(...responses: Response[]) { replies.push(...responses); },
			async model(id: string) { await runtime!.session.setModel(modelRuntime.getModel("integration-fake", id)!); },
			async close() {
				await runtime!.dispose();
				server.closeAllConnections();
				await new Promise<void>((resolve) => server.close(() => resolve()));
				await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
				assert.deepEqual(errors, [], "Provider and extension must not report hidden failures");
			},
		};
	} catch (error) {
		if (runtime) await runtime.dispose();
		server.closeAllConnections(); server.close();
		await rm(root, { recursive: true, force: true });
		throw error;
	}
}

export function resultFor(session: AgentSession, id: string): any {
	const message = session.messages.find((message: any) => message.role === "toolResult" && message.toolCallId === id);
	assert.ok(message, `Missing tool result ${id}`);
	return message;
}

export function assertPairedHistory(request: FakeRequest) {
	const calls = request.messages.flatMap((message) => message.tool_calls ?? []);
	const results = request.messages.filter((message) => message.role === "tool");
	assert.equal(new Set(calls.map((call) => call.id)).size, calls.length, "Tool call IDs must be unique");
	assert.deepEqual(results.map((result) => result.tool_call_id).sort(), calls.map((call) => call.id).sort());
}

export function nodeCommand(code: string) {
	return `"${process.execPath.replaceAll("\\", "/")}" -e '${code.replaceAll("'", "'\\''")}'`;
}
