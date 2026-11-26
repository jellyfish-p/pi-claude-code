import { readdir, stat } from "node:fs/promises";
import { isAbsolute, join, parse, relative } from "node:path";
import { Minimatch, unescape } from "minimatch";
import { normalizeGlobPattern } from "./glob-pattern.ts";
import { resolveLocalPath } from "./paths.ts";

export const GLOB_LIMIT = 100;

interface Match {
	path: string;
	mtime: number;
}

function checkCancelled(signal?: AbortSignal): void {
	if (signal?.aborted) throw new Error("Glob: operation cancelled.");
}

function modificationOrder(a: Match, b: Match): number {
	return a.mtime - b.mtime || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function globResult(cwd: string, matches: Match[], totalMatches: number) {
	const filenames = matches.map((match) => relative(cwd, match.path) || match.path);
	const truncated = totalMatches > GLOB_LIMIT;
	let text = filenames.length === 0 ? "No files found" : filenames.join("\n");
	if (truncated) text += `\n(Showing ${GLOB_LIMIT} of ${totalMatches} matching files; ${totalMatches - GLOB_LIMIT} more are not listed. Narrow the pattern or path to see the rest.)`;
	const data = { filenames, numFiles: filenames.length, truncated, totalMatches, countIsComplete: true };
	return { content: [{ type: "text" as const, text }], details: data, structuredContent: data };
}

/**
 * Glob has its own backend: pi find's ignore rules, ordering, and limit are
 * different. The outer registered Glob call still passes through pi's tool
 * hooks before this code inspects any path, including missing directories.
 */
export async function executeGlob(cwd: string, input: Record<string, unknown>, signal?: AbortSignal) {
	if (typeof input.pattern !== "string") throw new Error("Glob: pattern must be a string.");
	if (input.path !== undefined && typeof input.path !== "string") throw new Error("Glob: path must be a string.");
	if (input.pattern.includes("\0") || (typeof input.path === "string" && input.path.includes("\0"))) {
		throw new Error("Glob: remove null bytes from pattern and path.");
	}
	checkCancelled(signal);
	let searchRoot = resolveLocalPath(cwd, typeof input.path === "string" ? input.path : ".");
	const sourcePattern = process.platform === "win32" ? input.pattern.replaceAll("\\", "/") : input.pattern;
	const negated = sourcePattern.startsWith("!");
	const pattern = normalizeGlobPattern(negated ? sourcePattern.slice(1) : sourcePattern);
	const absolutePattern = !negated && isAbsolute(pattern);
	if (absolutePattern) {
		// Absolute patterns choose their own scope, ignoring path. Extract the
		// literal directory prefix so /project/src/**/*.ts never scans a drive.
		const root = parse(pattern).root;
		const segments = pattern.slice(root.length).split("/");
		searchRoot = root;
		while (segments.length > 1 && !new Minimatch(segments[0], { magicalBraces: true, nonegate: true, nocomment: true, noext: true }).hasMagic()) {
			searchRoot = join(searchRoot, unescape(segments.shift()!));
		}
	}
	const matchBase = !pattern.includes("/");
	checkCancelled(signal);
	let rootInfo: Awaited<ReturnType<typeof stat>>;
	try {
		rootInfo = await stat(searchRoot);
	} catch (error) {
		checkCancelled(signal);
		// A missing directory derived from an absolute pattern means that
		// pattern has no matches. A missing explicit path remains an error.
		if (absolutePattern && ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) {
			return globResult(cwd, [], 0);
		}
		throw error;
	}
	checkCancelled(signal);
	if (!rootInfo.isDirectory()) {
		if (absolutePattern) return globResult(cwd, [], 0);
		throw new Error(`Glob: path is not a directory: ${searchRoot}`);
	}
	const matcher = new Minimatch(pattern, {
		dot: true,
		nocase: false,
		nonegate: true,
		nocomment: true,
		noext: true,
		matchBase,
	});
	const pending = [""];
	const matches: Match[] = [];
	let totalMatches = 0;
	while (pending.length > 0) {
		checkCancelled(signal);
		const directory = pending.pop()!;
		const entries = await readdir(join(searchRoot, directory), { withFileTypes: true });
		checkCancelled(signal);
		for (const entry of entries) {
			checkCancelled(signal);
			const candidate = directory ? `${directory}/${entry.name}` : entry.name;
			const path = join(searchRoot, candidate);
			const matchPath = (absolutePattern ? path : relative(cwd, path)).replaceAll("\\", "/");
			if (entry.isDirectory()) {
				// Minmatch's partial match keeps only directories that can still
				// complete the pattern; basename patterns can match at any depth.
				if (negated || matchBase || matcher.match(matchPath, true)) pending.push(candidate);
				continue;
			}
			if ((!entry.isFile() && !entry.isSymbolicLink()) || matcher.match(matchPath) === negated) continue;
			let info;
			try {
				info = await stat(path);
			} catch (error) {
				// Files can disappear during a search, including broken symlinks.
				if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
				throw error;
			}
			checkCancelled(signal);
			if (!info.isFile()) continue;
			totalMatches++;
			matches.push({ path, mtime: info.mtimeMs });
			matches.sort(modificationOrder);
			if (matches.length > GLOB_LIMIT) matches.pop();
		}
	}
	checkCancelled(signal);
	return globResult(cwd, matches, totalMatches);
}
