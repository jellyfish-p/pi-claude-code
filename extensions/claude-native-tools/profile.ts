import type { ToolMode } from "./translate.ts";

export type ProfileSetting = "auto" | "off" | "force";
export const PI_TO_CLAUDE = {
	read: "Read", write: "Write", bash: "Bash", edit: "Edit", grep: "Grep", find: "Glob",
} as const;
export const CLAUDE_TO_PI: Readonly<Record<string, string>> = Object.fromEntries(
	Object.entries(PI_TO_CLAUDE).map(([pi, claude]) => [claude, pi]),
);

export function profileConfiguration(mode: unknown, pattern: unknown) {
	const issues: string[] = [];
	const setting: ProfileSetting = mode === undefined || mode === "auto" ? "auto"
		: mode === "off" || mode === "force" ? mode : "off";
	if (mode !== undefined && mode !== "auto" && mode !== "off" && mode !== "force") {
		issues.push("Invalid --claude-tools mode; using off. Expected auto, off, or force.");
	}
	let matcher: RegExp | undefined;
	try {
		matcher = new RegExp(typeof pattern === "string" ? pattern : "claude", "i");
	} catch {
		issues.push("Invalid --claude-tools-model-pattern; automatic activation is disabled.");
	}
	return { setting, matcher, issues };
}

export function profileMode(setting: ProfileSetting, modelId: string | undefined, matcher?: RegExp): ToolMode {
	return setting === "force" || (setting === "auto" && modelId !== undefined && matcher?.test(modelId)) ? "claude" : "pi";
}

/** Use the host's applied tools for both replay projection and diagnostics. */
export function toolProjection(mode: ToolMode, active: readonly string[]) {
	const available = new Set(active);
	const claudeAliases = new Set<string>();
	const nativeTools: string[] = [];
	for (const [native, alias] of Object.entries(PI_TO_CLAUDE)) {
		if (mode === "claude" && available.has(alias) && available.has(native)) claudeAliases.add(alias);
		else if (available.has(native)) nativeTools.push(native);
	}
	const effective = claudeAliases.size === 0 ? "pi" : nativeTools.length > 0 ? "partial" : "claude";
	return { claudeAliases, nativeTools, effective };
}

/** Track user removals separately from aliases this extension adds itself. */
export class ToolProfile {
	private previous: Set<string> | undefined;
	private enabled = new Set<string>();
	private disabledTasks = new Set<string>();

	/** pi can filter requested aliases through a CLI tool allowlist. */
	accept(active: string[]): void {
		this.previous = new Set(active);
		for (const [native, alias] of Object.entries(PI_TO_CLAUDE)) {
			if (!this.previous.has(native) && !this.previous.has(alias)) this.enabled.delete(native);
		}
	}

	sync(active: string[], mode: ToolMode, hasTasks: boolean): string[] {
		const current = new Set(active);
		for (const [native, alias] of Object.entries(PI_TO_CLAUDE)) {
			if (this.previous === undefined) {
				if (current.has(native) || current.has(alias)) this.enabled.add(native);
				continue;
			}
			const removed = [native, alias].some((name) => this.previous!.has(name) && !current.has(name));
			const added = [native, alias].some((name) => !this.previous!.has(name) && current.has(name));
			if (removed) this.enabled.delete(native);
			else if (added) this.enabled.add(native);
		}
		for (const name of ["TaskOutput", "TaskStop"]) {
			if (this.previous?.has(name) && !current.has(name)) this.disabledTasks.add(name);
			if (!this.previous?.has(name) && current.has(name)) this.disabledTasks.delete(name);
		}
		const desired = new Set<string>();
		for (const name of active) {
			const native = CLAUDE_TO_PI[name] ?? (name in PI_TO_CLAUDE ? name : undefined);
			if (native !== undefined) {
				if (!this.enabled.has(native)) continue;
				desired.add(native);
				if (mode === "claude") desired.add(PI_TO_CLAUDE[native as keyof typeof PI_TO_CLAUDE]);
			} else if (name !== "TaskOutput" && name !== "TaskStop") {
				desired.add(name);
			}
		}
		if (hasTasks || (mode === "claude" && this.enabled.has("bash"))) {
			for (const name of ["TaskOutput", "TaskStop"]) {
				if (!this.disabledTasks.has(name)) desired.add(name);
			}
		}
		const result = [...desired];
		this.previous = new Set(result);
		return result;
	}
}
