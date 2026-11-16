import { randomUUID } from "node:crypto";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";

export const DEFAULT_BACKGROUND_TIMEOUT = 600_000;
export const MAX_BACKGROUND_TIMEOUT = 7_200_000;

type ExecuteTool = ExtensionToolContext["executeTool"];
type BashResult = Awaited<ReturnType<ExecuteTool>>["result"];
type TaskStatus = "running" | "stopping" | "completed" | "failed" | "stopped" | "timed_out";

interface TaskDetails {
	task_id: string;
	status: TaskStatus;
	exit_code?: number;
}

interface BashTask {
	id: string;
	status: TaskStatus;
	controller: AbortController;
	timeout: ReturnType<typeof setTimeout>;
	stopReason?: "stopped" | "timed_out";
	content: BashResult["content"];
	exitCode?: number;
}

export class BackgroundBashTasks {
	private tasks = new Map<string, BashTask>();
	private closed = false;
	private notify: (task: TaskDetails) => void;

	constructor(notify: (task: TaskDetails) => void) {
		this.notify = notify;
	}

	get hasTasks(): boolean {
		return this.tasks.size > 0;
	}

	start(command: string, timeoutMs: number, executeTool: ExecuteTool) {
		if (this.closed) throw new Error("The Bash task session is closed.");
		const task: BashTask = {
			id: randomUUID(),
			status: "running",
			controller: new AbortController(),
			timeout: setTimeout(() => this.requestStop(task, "timed_out"), timeoutMs),
			content: [],
		};
		this.tasks.set(task.id, task);
		void this.run(task, command, executeTool);
		return this.result(task);
	}

	output(id: string) {
		const task = this.tasks.get(id);
		if (!task) return undefined;
		const result = this.result(task);
		return { ...result, content: [...result.content, ...task.content] };
	}

	stop(id: string) {
		const task = this.tasks.get(id);
		if (!task) return undefined;
		this.requestStop(task, "stopped");
		return this.result(task);
	}

	close(): void {
		this.closed = true;
		for (const task of this.tasks.values()) this.requestStop(task, "stopped");
		this.tasks.clear();
	}

	private requestStop(task: BashTask, reason: NonNullable<BashTask["stopReason"]>): void {
		if (task.status !== "running") return;
		task.status = "stopping";
		task.stopReason = reason;
		clearTimeout(task.timeout);
		task.controller.abort();
	}

	private async run(task: BashTask, command: string, executeTool: ExecuteTool): Promise<void> {
		let failed = true;
		try {
			// A task remains cancellable by ID after the launching tool call returns.
			const outcome = await executeTool("bash", { command }, {
				signal: task.controller.signal,
				onUpdate: (update) => {
					task.content = update.content;
				},
			});
			task.content = outcome.result.content;
			failed = outcome.isError;
			const data = outcome.result.structuredContent;
			if (data && typeof data === "object" && !Array.isArray(data) && typeof data.exit_code === "number") {
				task.exitCode = data.exit_code;
			}
		} catch (error) {
			task.content = [...task.content, { type: "text", text: error instanceof Error ? error.message : String(error) }];
		} finally {
			clearTimeout(task.timeout);
		}

		if (failed) {
			task.status = task.exitCode === undefined ? task.stopReason ?? "failed" : "failed";
		} else {
			task.status = "completed";
		}
		if (!this.closed) this.notify(this.details(task));
	}

	private details(task: BashTask): TaskDetails {
		return {
			task_id: task.id,
			status: task.status,
			...(task.exitCode === undefined ? {} : { exit_code: task.exitCode }),
		};
	}

	private result(task: BashTask) {
		return {
			content: [{ type: "text" as const, text: `Background Bash task ${task.id}: ${task.status}.` }],
			details: this.details(task),
		};
	}
}
