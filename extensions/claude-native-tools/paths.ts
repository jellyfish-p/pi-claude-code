import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Resolve the local path forms accepted by pi's filesystem tools. */
export function resolveLocalPath(cwd: string, input: string): string {
	const path = input.replace(/^@/, "");
	if (path.startsWith("file://")) return fileURLToPath(path);
	if (path === "~") return homedir();
	if (/^~[/\\]/.test(path)) return resolve(homedir(), path.slice(2));
	return resolve(cwd, path);
}
