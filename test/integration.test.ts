import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { assertPairedHistory, createHarness, nodeCommand, resultFor, waitFor } from "./helpers/pi-runtime.ts";

test("real pi loads index.ts, changes Claude/plain profiles and pairs replayed history", { timeout: 30_000 }, async () => {
	const h = await createHarness({ defaultTools: ["read", "write", "edit", "bash", "grep", "find"] });
	try {
		const target = join(h.cwd, "example.txt");
		await writeFile(target, "alpha\nbeta\n");
		h.enqueue([{ id: "claude_read", name: "Read", arguments: { file_path: target } }], "read done");
		await h.session.prompt("read the fixture");
		const claude = h.requests[0];
		const declared = claude.tools!.map((tool) => tool.function.name);
		assert.ok(declared.includes("Read"));
		assert.ok(!declared.includes("read"), "prepareLoadout hides the callable alias");
		assert.ok(h.session.getCallableToolNames().includes("read"));
		assert.match(JSON.stringify(resultFor(h.session, "claude_read").content), /alpha/);
		assert.ok(h.events.some((event) => event.type === "tool_call" && event.toolName === "read" && event.parentToolCallId === "claude_read"));

		await h.model("plain-integration");
		h.enqueue([{ id: "plain_edit", name: "edit", arguments: { path: target, edits: [
			{ oldText: "alpha", newText: "ALPHA" }, { oldText: "beta", newText: "BETA" },
		] } }], "edit done");
		const plainIndex = h.requests.length;
		await h.session.prompt("edit the fixture");
		const plain = h.requests[plainIndex];
		assert.ok(plain.tools!.some((tool) => tool.function.name === "read"));
		assert.ok(!plain.tools!.some((tool) => tool.function.name === "Read"));
		assert.equal(plain.messages.flatMap((message) => message.tool_calls ?? []).find((call) => call.id === "claude_read").function.name, "read");
		assertPairedHistory(plain);

		await h.model("claude-integration");
		const replayIndex = h.requests.length;
		await h.session.prompt("inspect replay");
		const replay = h.requests[replayIndex];
		assertPairedHistory(replay);
		const edits = replay.messages.flatMap((message) => message.tool_calls ?? []).filter((call) => call.function.name === "Edit");
		assert.equal(edits.length, 2, "A pi batch edit is replayed as two Claude calls");
		assert.deepEqual(edits.map((call) => JSON.parse(call.function.arguments).new_string), ["ALPHA", "BETA"]);
	} finally { await h.close(); }
});

test("Anthropic messages adapter receives Claude schemas and paired translated history", { timeout: 30_000 }, async () => {
	const h = await createHarness({ defaultTools: ["read"], api: "anthropic-messages" });
	try {
		const file = join(h.cwd, "anthropic.txt");
		await writeFile(file, "anthropic fixture\n");
		h.enqueue([{ id: "anthropic_read", name: "Read", arguments: { file_path: file } }], "read complete");
		await h.session.prompt("read through the Anthropic API adapter");
		const tools = h.requests[0].tools as any[];
		assert.deepEqual(tools.map((tool) => tool.name), ["Read"]);
		assert.ok(tools[0].input_schema.properties.file_path);
		assert.match(JSON.stringify(resultFor(h.session, "anthropic_read").content), /anthropic fixture/);
		for (const model of ["plain-integration", "claude-integration"]) {
			await h.model(model);
			await h.session.prompt("inspect translated Anthropic replay");
			const blocks = h.requests.at(-1)!.messages.flatMap((message) => Array.isArray(message.content) ? message.content : []);
			const calls = blocks.filter((block) => block.type === "tool_use");
			const results = blocks.filter((block) => block.type === "tool_result");
			assert.equal(calls[0].name, model.startsWith("claude") ? "Read" : "read");
			assert.deepEqual(results.map((result) => result.tool_use_id), calls.map((call) => call.id));
		}
	} finally { await h.close(); }
});

test("host-filtered read history retains its executable native name and arguments", { timeout: 30_000 }, async () => {
	const h = await createHarness({ tools: ["read"] });
	try {
		const target = join(h.cwd, "native-history.txt");
		await writeFile(target, "native replay fixture\n");
		h.enqueue([{ id: "native_read", name: "read", arguments: { path: target } }], (request) => {
			assert.deepEqual(request.tools!.map((tool) => tool.function.name), ["read"]);
			const historical = request.messages.flatMap((message) => message.tool_calls ?? []).find((call) => call.id === "native_read");
			assert.equal(historical.function.name, "read");
			assert.deepEqual(JSON.parse(historical.function.arguments), { path: target });
			assertPairedHistory(request);
			// A model copying the observed historical identity must still be able
			// to call the only tool its host allows.
			return [{ id: "native_follow", name: historical.function.name, arguments: JSON.parse(historical.function.arguments) }];
		}, "done");
		await h.session.prompt("read and repeat the executable historical call");
		assert.match(JSON.stringify(resultFor(h.session, "native_follow").content), /native replay fixture/);
		assert.equal(resultFor(h.session, "native_follow").isError ?? false, false);
		assertPairedHistory(h.requests.at(-1)!);
	} finally { await h.close(); }
});

test("mixed host profile translates only available aliases and keeps replay paired across model switches", { timeout: 30_000 }, async () => {
	const h = await createHarness({ tools: ["read", "write", "Write"] });
	try {
		const source = join(h.cwd, "source.txt");
		const output = join(h.cwd, "output.txt");
		await writeFile(source, "mixed profile fixture\n");
		h.enqueue([
			{ id: "mixed_read", name: "read", arguments: { path: source } },
			{ id: "mixed_write", name: "Write", arguments: { file_path: output, content: "written" } },
		], "done");
		await h.session.prompt("use both tools in the mixed profile");
		for (const model of ["claude-integration", "plain-integration", "claude-integration"]) {
			await h.model(model);
			await h.session.prompt("inspect mixed tool replay");
			const request = h.requests.at(-1)!;
			const writeName = model.startsWith("claude") ? "Write" : "write";
			assert.deepEqual(request.tools!.map((tool) => tool.function.name).sort(), ["read", writeName].sort());
			const calls = request.messages.flatMap((message) => message.tool_calls ?? []);
			const read = calls.find((call) => call.id === "mixed_read");
			const write = calls.find((call) => call.id === "mixed_write");
			assert.equal(read.function.name, "read");
			assert.deepEqual(JSON.parse(read.function.arguments), { path: source });
			assert.equal(write.function.name, writeName);
			assert.deepEqual(JSON.parse(write.function.arguments), model.startsWith("claude") ? { file_path: output, content: "written" } : { path: output, content: "written" });
			assertPairedHistory(request);
		}
		assert.equal(await readFile(output, "utf8"), "written");
	} finally { await h.close(); }
});

test("real pi tool allowlists, denylists and no-tools remain capability boundaries", { timeout: 45_000 }, async (t) => {
	for (const scenario of [
		{ label: "read-only host allowlist", options: { tools: ["read"] }, expected: ["read"] },
		{ label: "read pair allowlist", options: { tools: ["read", "Read"] }, expected: ["Read"] },
		{ label: "orphan Read allowlist", options: { tools: ["Read"] }, expected: [] },
		{ label: "exclude bash", options: { defaultTools: ["read", "bash"], excludeTools: ["bash"] }, expected: ["Read"] },
		{ label: "empty allowlist", options: { tools: [] }, expected: [] },
		{ label: "all tools disabled", options: { noTools: "all" as const }, expected: [] },
	]) {
		await t.test(scenario.label, async () => {
			const h = await createHarness(scenario.options);
			try {
				for (const model of ["claude-integration", "plain-integration", "claude-integration"]) {
					await h.model(model);
					await h.session.prompt("inspect declared tools");
					const expected = model.startsWith("claude") ? scenario.expected : scenario.expected.map((name) => name.toLowerCase());
					assert.deepEqual((h.requests.at(-1)!.tools ?? []).map((tool) => tool.function.name).sort(), [...expected].sort());
				}
				if (scenario.label === "read-only host allowlist") {
					const target = join(h.cwd, "native.txt");
					await writeFile(target, "native tool remains executable\n");
					h.enqueue([{ id: "native_read", name: "read", arguments: { path: target } }], "done");
					await h.session.prompt("use the host-allowed native tool");
					assert.match(JSON.stringify(resultFor(h.session, "native_read").content), /native tool remains executable/);
				}
			} finally { await h.close(); }
		});
	}
	await t.test("removing a tool during a session stays removed after model switches", async () => {
		const h = await createHarness({ defaultTools: ["read", "write"] });
		try {
			h.session.setActiveToolsByName(h.session.getActiveToolNames().filter((name) => name !== "Read"));
			await h.model("plain-integration");
			await h.model("claude-integration");
			await h.session.prompt("inspect disabled Read");
			assert.deepEqual(h.requests.at(-1)!.tools!.map((tool) => tool.function.name), ["Write"]);
		} finally { await h.close(); }
	});
});

test("nested real pi calls obey permission hooks and preserve errors, images and truncation", { timeout: 30_000 }, async () => {
	const h = await createHarness({ defaultTools: ["read", "write"], hook: (pi) => {
		pi.on("tool_call", (event) => {
			if (event.toolName === "write" && event.parentToolCallId) return { block: true, reason: "integration permission denied" };
		});
	} });
	try {
		const image = join(h.cwd, "pixel.png");
		await writeFile(image, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR4AQEFAPr/AP8AAP8FAAH/+lyI0QAAAABJRU5ErkJggg==", "base64"));
		const big = join(h.cwd, "large.txt");
		await writeFile(big, Array.from({ length: 2100 }, (_, i) => `line ${i + 1}`).join("\n"));
		h.enqueue([
			{ id: "blocked_write", name: "Write", arguments: { file_path: join(h.cwd, "blocked.txt"), content: "forbidden" } },
			{ id: "missing_read", name: "Read", arguments: { file_path: join(h.cwd, "missing.txt") } },
			{ id: "image_read", name: "Read", arguments: { file_path: image } },
			{ id: "large_read", name: "Read", arguments: { file_path: big } },
		], "done");
		await h.session.prompt("exercise nested tool outcomes");
		const blocked = resultFor(h.session, "blocked_write");
		assert.equal(blocked.isError, true);
		assert.match(JSON.stringify(blocked.content), /integration permission denied/);
		assert.ok(h.events.some((event) => event.type === "tool_call" && event.toolName === "write" && event.parentToolCallId === "blocked_write"));
		await assert.rejects(access(join(h.cwd, "blocked.txt")), { code: "ENOENT" });
		assert.equal(resultFor(h.session, "missing_read").isError, true);
		assert.ok(resultFor(h.session, "image_read").content.some((part: any) => part.type === "image" && part.mimeType === "image/png"), JSON.stringify(resultFor(h.session, "image_read")));
		const large = resultFor(h.session, "large_read");
		assert.match(JSON.stringify(large.content), /2000|truncat|2100/i);
		assert.ok(large.details?.truncation, "Truncation metadata survives the adapter");
		assertPairedHistory(h.requests.at(-1)!);
	} finally { await h.close(); }
});

test("real pi honors profile flags and session commands", { timeout: 30_000 }, async (t) => {
	for (const scenario of [
		{ mode: "off", model: "claude-integration", flags: { "claude-tools": "off" }, expected: "read" },
		{ mode: "force", model: "plain-integration", flags: { "claude-tools": "force" }, expected: "Read" },
		{ mode: "custom pattern", model: "plain-integration", flags: { "claude-tools-model-pattern": "^plain-" }, expected: "Read" },
	]) {
		await t.test(scenario.mode, async () => {
			const h = await createHarness({ defaultTools: ["read"], model: scenario.model, flags: scenario.flags });
			try {
				await h.session.prompt("inspect flag-selected profile");
				assert.deepEqual(h.requests.at(-1)!.tools!.map((tool) => tool.function.name), [scenario.expected]);
				await h.session.prompt("/claude-tools status");
				await h.session.prompt("/claude-tools off");
				await h.session.prompt("inspect command-selected profile");
				assert.deepEqual(h.requests.at(-1)!.tools!.map((tool) => tool.function.name), ["read"]);
			} finally { await h.close(); }
		});
	}
});

test("real Glob uses its own filesystem backend and the outer permission hook", { timeout: 30_000 }, async () => {
	const h = await createHarness({ defaultTools: ["find"], hook: (pi) => {
		pi.on("tool_call", (event) => {
			if (event.toolName === "Glob" && event.input.pattern === "blocked-*") return { block: true, reason: "Glob permission denied before filesystem access" };
		});
	} });
	try {
		await writeFile(join(h.cwd, "example.ts"), "fixture");
		h.enqueue([
			{ id: "glob_ok", name: "Glob", arguments: { pattern: "*.ts", path: h.cwd } },
			{ id: "glob_denied", name: "Glob", arguments: { pattern: "blocked-*", path: join(h.cwd, "missing-directory") } },
		], "done");
		await h.session.prompt("find fixture and exercise permissions");
		assert.match(JSON.stringify(resultFor(h.session, "glob_ok").content), /example\.ts/);
		assert.match(JSON.stringify(resultFor(h.session, "glob_denied").content), /Glob permission denied before filesystem access/);
		assert.equal(resultFor(h.session, "glob_denied").isError, true);
		assert.ok(!h.events.some((event) => event.type === "tool_call" && event.toolName === "find"), "Glob must not delegate to the pi find backend");
		assertPairedHistory(h.requests.at(-1)!);
		await h.model("plain-integration");
		await h.session.prompt("inspect native find and history");
		assert.deepEqual(h.requests.at(-1)!.tools!.map((tool) => tool.function.name), ["find"]);
		assert.ok(h.requests.at(-1)!.messages.flatMap((message) => message.tool_calls ?? []).some((call) => call.id === "glob_ok" && call.function.name === "find"));
		assertPairedHistory(h.requests.at(-1)!);
	} finally { await h.close(); }
});

test("real Bash loadout enforces foreground timeout policy and keeps the larger background budget", { timeout: 30_000 }, async () => {
	const h = await createHarness({ defaultTools: ["bash", "grep"] });
	try {
		h.enqueue([
			{ id: "default_timeout", name: "Bash", arguments: { command: nodeCommand('console.log("foreground")') } },
			{ id: "invalid_timeout", name: "Bash", arguments: { command: nodeCommand('console.log("must not run")'), timeout: 600_001 } },
		], "done");
		await h.session.prompt("inspect foreground policy");
		const nested = h.events.find((event) => event.type === "tool_call" && event.toolName === "bash" && event.parentToolCallId === "default_timeout");
		assert.equal(nested.input.timeout, 120, "Default milliseconds are converted to pi seconds");
		assert.equal(resultFor(h.session, "invalid_timeout").isError, true);
		assert.ok(!h.events.some((event) => event.type === "tool_call" && event.toolName === "bash" && event.parentToolCallId === "invalid_timeout"));
		const grepSchema = h.requests[0].tools!.find((tool) => tool.function.name === "Grep")!.function.parameters as any;
		for (const unsupported of ["type", "offset", "multiline", "-o", "-A", "-B"]) assert.ok(!(unsupported in grepSchema.properties));
		assert.deepEqual(grepSchema.properties.output_mode.enum, ["content", "files_with_matches"]);
		const background = await startTask(h, "large_background_budget", 'console.log("background")', 600_001);
		await waitFor(() => notifications(h).some((message) => message.details.task_id === background), "Long background timeout was rejected");
		await waitFor(() => h.session.isIdle, "Background notification did not settle");
		assert.equal(notifications(h).find((message) => message.details.task_id === background).details.status, "completed");
	} finally { await h.close(); }
});

function notifications(h: Awaited<ReturnType<typeof createHarness>>) {
	return h.session.messages.filter((message: any) => message.role === "custom" && message.customType === "claude-native-tools:background-bash") as any[];
}

async function startTask(h: Awaited<ReturnType<typeof createHarness>>, id: string, code: string, timeout = 10_000) {
	const command = nodeCommand(code);
	h.enqueue([{ id, name: "Bash", arguments: { command, run_in_background: true, timeout } }], "background started");
	await h.session.prompt(`start ${id}`);
	const result = resultFor(h.session, id);
	assert.equal(result.isError ?? false, false, JSON.stringify(result));
	assert.equal(typeof result.details.task_id, "string");
	return result.details.task_id as string;
}

test("real background Bash completes and notifies while idle and while a provider request is busy", { timeout: 30_000 }, async () => {
	const h = await createHarness({ defaultTools: ["bash"] });
	try {
		const taskId = await startTask(h, "background_success", 'setTimeout(() => console.log("completed output"), 500)');
		await waitFor(() => notifications(h).some((message) => message.details.task_id === taskId), "Idle completion notification was not delivered");
		await waitFor(() => h.session.isIdle, "Background followup did not settle");
		assert.equal(notifications(h).find((message) => message.details.task_id === taskId).details.status, "completed");
		h.enqueue([{ id: "task_output", name: "TaskOutput", arguments: { task_id: taskId } }], "inspected");
		await h.session.prompt("read task output");
		assert.match(JSON.stringify(resultFor(h.session, "task_output").content), /completed output/);

		const busyId = await startTask(h, "background_busy", 'setTimeout(() => console.log("busy output"), 800)');
		let release!: () => void;
		let busyRequest = false;
		h.enqueue(async () => { busyRequest = true; await new Promise<void>((resolve) => { release = resolve; }); return "busy response complete"; });
		const pending = h.session.prompt("hold the request while task completes");
		await waitFor(() => busyRequest, "Busy provider request did not start");
		try {
			await waitFor(() => h.events.some((event) => event.type === "tool_execution_end" && event.parentToolCallId === "background_busy"), "Background task did not finish while busy");
		} finally { release(); }
		await pending;
		await waitFor(() => notifications(h).some((message) => message.details.task_id === busyId), "Busy completion was not queued and delivered");
		await waitFor(() => h.session.isIdle, "Queued completion followup did not settle");
		assert.equal(notifications(h).filter((message) => message.details.task_id === busyId).length, 1);
	} finally { await h.close(); }
});

test("real background Bash failure, TaskStop and timeout retain final statuses", { timeout: 30_000 }, async () => {
	const h = await createHarness({ defaultTools: ["bash"] });
	try {
		const failed = await startTask(h, "background_failure", 'console.error("failed output"); process.exit(7)');
		await waitFor(() => notifications(h).some((message) => message.details.task_id === failed), "Failure notification missing");
		await waitFor(() => h.session.isIdle, "Failure followup did not settle");
		assert.equal(notifications(h).find((message) => message.details.task_id === failed).details.status, "failed");
		const stopped = await startTask(h, "background_stop", 'setTimeout(() => console.log("too late"), 20_000)');
		h.enqueue([{ id: "stop_task", name: "TaskStop", arguments: { task_id: stopped } }], "stopped");
		await h.session.prompt("stop background task");
		await waitFor(() => notifications(h).some((message) => message.details.task_id === stopped), "Stop notification missing");
		await waitFor(() => h.session.isIdle, "Stop followup did not settle");
		assert.equal(notifications(h).find((message) => message.details.task_id === stopped).details.status, "stopped");
		const timed = await startTask(h, "background_timeout", 'setTimeout(() => console.log("too late"), 20_000)', 100);
		await waitFor(() => notifications(h).some((message) => message.details.task_id === timed), "Timeout notification missing");
		await waitFor(() => h.session.isIdle, "Timeout followup did not settle");
		assert.equal(notifications(h).find((message) => message.details.task_id === timed).details.status, "timed_out");
	} finally { await h.close(); }
});

test("real reload/new/resume/fork tear down background calls and restore paired history", { timeout: 45_000 }, async () => {
	const h = await createHarness({ defaultTools: ["read", "bash"] });
	try {
		const file = join(h.cwd, "resume.txt");
		await writeFile(file, "resume content\n");
		h.enqueue([{ id: "saved_read", name: "Read", arguments: { file_path: file } }], "saved");
		await h.session.prompt("save history");
		const originalFile = h.session.sessionFile!;
		const firstUser = h.session.getUserMessagesForForking()[0].entryId;
		for (const reason of ["reload", "new", "resume", "fork"] as const) {
			const pidFile = join(h.cwd, `pid-${reason}.txt`);
			const oldId = await startTask(h, `lifecycle_${reason}`, `require("node:fs").writeFileSync(${JSON.stringify(pidFile.replaceAll("\\", "/"))}, String(process.pid)); setTimeout(() => console.log("must be cancelled"), 20_000)`);
			let pid = 0;
			const deadline = Date.now() + 10_000;
			while (!pid) {
				try { pid = Number(await readFile(pidFile, "utf8")); } catch {}
				assert.ok(Date.now() < deadline, `Background child ${reason} did not start`);
				if (!pid) await new Promise((resolve) => setTimeout(resolve, 20));
			}
			if (reason === "reload") await h.session.reload();
			if (reason === "new") assert.equal((await h.runtime.newSession()).cancelled, false);
			if (reason === "resume") assert.equal((await h.runtime.switchSession(originalFile)).cancelled, false);
			if (reason === "fork") assert.equal((await h.runtime.fork(firstUser, { position: "at" })).cancelled, false);
			try {
				await waitFor(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, `${reason} left background child ${pid} running`);
			} finally {
				// A failing lifecycle assertion must not leak its own fixture child.
				try { process.kill(pid, "SIGKILL"); } catch {}
			}
			assert.ok(h.lifecycle.some((event) => event.type === "session_shutdown" && event.reason === reason));
			assert.ok(h.lifecycle.some((event) => event.type === "session_start" && event.reason === reason));
			h.enqueue([{ id: `old_output_${reason}`, name: "TaskOutput", arguments: { task_id: oldId } }], "checked");
			await h.session.prompt(`check stale task after ${reason}`);
			assert.equal(resultFor(h.session, `old_output_${reason}`).isError, true);
			assert.match(JSON.stringify(resultFor(h.session, `old_output_${reason}`).content), /unknown Bash task ID/);
			assert.ok(!notifications(h).some((message) => message.details.task_id === oldId), `${reason} leaked a completion into the new runtime`);
			assertPairedHistory(h.requests.at(-1)!);
			if (reason === "resume") assert.match(JSON.stringify(h.requests.at(-1)!.messages), /resume content/);
		}
	} finally { await h.close(); }
});
