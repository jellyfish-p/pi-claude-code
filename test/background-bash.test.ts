import assert from "node:assert/strict";
import test from "node:test";
import { BackgroundBashTasks } from "../extensions/claude-native-tools/background-bash.ts";

type ExecuteTool = Parameters<BackgroundBashTasks["start"]>[2];
type Completion = Parameters<ConstructorParameters<typeof BackgroundBashTasks>[0]>[0];

function controlledBash() {
	const ready = Promise.withResolvers<NonNullable<Parameters<ExecuteTool>[2]>>();
	const result = Promise.withResolvers<Awaited<ReturnType<ExecuteTool>>>();
	const execute: ExecuteTool = (name, args, options) => {
		assert.equal(name, "bash");
		assert.deepEqual(args, { command: "test command" });
		assert.ok(options);
		ready.resolve(options);
		return result.promise;
	};
	return { execute, ready: ready.promise, resolve: result.resolve };
}

function outcome(output: string, exitCode?: number) {
	return {
		toolCall: { type: "toolCall" as const, id: "call/1", name: "bash", arguments: { command: "test command" } },
		result: {
			content: [{ type: "text" as const, text: output }],
			details: undefined,
			structuredContent: exitCode === undefined ? undefined : { exit_code: exitCode },
		},
		isError: exitCode !== 0,
	};
}

test("returns an ID before Bash settles and exposes live and final output", async (t) => {
	const bash = controlledBash();
	const done = Promise.withResolvers<Completion>();
	const tasks = new BackgroundBashTasks(done.resolve);
	t.after(() => tasks.close());
	const { task_id } = tasks.start("test command", 1000, bash.execute).details;
	const options = await bash.ready;
	options.onUpdate?.({ content: [{ type: "text", text: "first line" }], details: undefined });
	const running = tasks.output(task_id);
	assert.equal(running?.details.status, "running");
	assert.equal(running?.content[1]?.type === "text" && running.content[1].text, "first line");
	assert.equal(tasks.output("unknown"), undefined);
	assert.equal(tasks.stop("unknown"), undefined);

	bash.resolve(outcome("first line\nlast line", 7));
	assert.deepEqual(await done.promise, { task_id, status: "failed", exit_code: 7 });
	const finished = tasks.output(task_id);
	assert.equal(finished?.content[1]?.type === "text" && finished.content[1].text, "first line\nlast line");
	assert.equal(tasks.stop(task_id)?.details.status, "failed");
});

test("stops a task once and reports its output after cancellation", async (t) => {
	const bash = controlledBash();
	const done = Promise.withResolvers<Completion>();
	const tasks = new BackgroundBashTasks(done.resolve);
	t.after(() => tasks.close());
	const { task_id } = tasks.start("test command", 1000, bash.execute).details;
	const { signal } = await bash.ready;
	let aborts = 0;
	signal?.addEventListener("abort", () => aborts++);
	assert.equal(tasks.stop(task_id)?.details.status, "stopping");
	assert.equal(tasks.stop(task_id)?.details.status, "stopping");
	assert.equal(aborts, 1);
	bash.resolve(outcome("partial output\nCommand aborted"));
	assert.equal((await done.promise).status, "stopped");
	assert.equal(tasks.output(task_id)?.details.status, "stopped");
});

test("timeouts abort their own task, and session shutdown suppresses later notifications", async (t) => {
	const timed = controlledBash();
	const running = controlledBash();
	const notifications: Completion[] = [];
	const done = Promise.withResolvers<Completion>();
	const tasks = new BackgroundBashTasks((task) => {
		notifications.push(task);
		done.resolve(task);
	});
	t.after(() => tasks.close());
	const timedId = tasks.start("test command", 10, timed.execute).details.task_id;
	const runningId = tasks.start("test command", 1000, running.execute).details.task_id;
	const timedOptions = await timed.ready;
	const runningOptions = await running.ready;
	timedOptions.signal?.addEventListener("abort", () => timed.resolve(outcome("Command aborted")), { once: true });
	assert.equal((await done.promise).status, "timed_out");
	assert.equal(tasks.output(timedId)?.details.status, "timed_out");
	assert.equal(runningOptions.signal?.aborted, false);

	tasks.close();
	assert.equal(runningOptions.signal?.aborted, true);
	assert.equal(tasks.output(runningId), undefined);
	running.resolve(outcome("Command aborted"));
	await Promise.resolve();
	assert.equal(notifications.length, 1);
});
