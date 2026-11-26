import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const names = ["Read", "Write", "Bash", "Edit", "Grep", "Glob"];
const tools = JSON.parse(await readFile(join(root, "docs/data/tools.json"), "utf8"));
const selected = Object.fromEntries(names.map((name) => {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing Claude Code tool: ${name}`);
  return [name, {
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  }];
}));

// pi's read tool has no PDF page selection and no over-limit opt-in. Do not
// advertise those capabilities to the model, and keep the prompt aligned with
// what the adapter can actually execute.
selected.Read.description = `Reads a file from the local filesystem.

- \`file_path\` must be an absolute path.
- Reads up to 2000 lines by default.
- When you already know which part of the file you need, only read that part. This can be important for larger files.
- Results are returned using cat -n format, with line numbers starting at 1
- Reads images (PNG, JPG, …) and presents them visually.
- Reading a directory, a missing file, or an empty file returns an error or system reminder rather than content.
- Do NOT re-read a file you just edited to verify — Edit/Write would have errored if the change failed, and the harness tracks file state for you.`;
delete selected.Read.input_schema.properties.pages;
delete selected.Read.input_schema.properties.allow_large;

// This is a pi-hosted adapter, so only promise the shell and search features
// that its implementations actually provide. Keep the captured source intact.
selected.Bash.description = `Executes a command using pi's configured Bash tool and returns its output.

- Each command uses pi's shell and working-directory behavior. Use the shell syntax appropriate to the host.
- Prefer Read, Glob, Grep, Write, and Edit for filesystem operations they support.
- Foreground timeout is in milliseconds: default 120000, maximum 600000. Values must be greater than zero.
- With run_in_background: true, the command runs across turns and returns a task ID immediately. Background timeout defaults to 600000 ms, with a maximum of 7200000 ms. Use TaskOutput to inspect output and TaskStop to stop the task. Completion sends a notification.
- Commands use pi's existing validation, hooks, and permissions. This adapter does not provide a sandbox override.
- Commit or push only when the user asks.`;
delete selected.Bash.input_schema.properties.dangerouslyDisableSandbox;
Object.assign(selected.Bash.input_schema.properties.timeout, {
  description: "Timeout in milliseconds, greater than zero. Foreground: default 120000, max 600000. Background: default 600000, max 7200000.",
  exclusiveMinimum: 0,
  maximum: 7200000,
});
selected.Bash.input_schema.anyOf = [
  { properties: { run_in_background: { const: true } }, required: ["run_in_background"] },
  { properties: { run_in_background: { const: false }, timeout: { maximum: 600000 } } },
];

selected.Grep.description = `Search file contents through pi's ripgrep tool, with pi's existing validation, hooks, and permissions.

- Supports ripgrep regular expressions, optional path and glob filters, and case-insensitive search with -i.
- output_mode is files_with_matches (paths only, default) or content (matching lines).
- In content mode, context or -C adds the same number of lines before and after each match; -n controls line numbers (default true).
- head_limit limits returned lines or file paths (default 250; 0 removes this adapter's limit).
- Both modes use pi's bounded content search. A large number of matching lines can truncate the underlying search before every matching file is found, including in files_with_matches mode. Truncation notices are preserved; narrow the search when one appears.`;
for (const name of ["-A", "-B", "-o", "type", "offset", "multiline"]) {
  delete selected.Grep.input_schema.properties[name];
}
Object.assign(selected.Grep.input_schema.properties.output_mode, {
  enum: ["content", "files_with_matches"],
  description: "content returns matching lines; files_with_matches returns paths (default). Both can be truncated by pi's underlying content-search budget.",
});
for (const name of ["context", "-C", "head_limit"]) {
  Object.assign(selected.Grep.input_schema.properties[name], { type: "integer", minimum: 0 });
}
selected.Grep.input_schema.properties.head_limit.description = "Maximum returned content lines or file paths (default 250). Set 0 to remove the adapter limit; pi's content-search budget still applies.";

selected.Glob.description += `

- Searches the given directory, or the current working directory when path is omitted.
- Includes hidden and gitignored files. Does not follow directory symlinks.
- Patterns without a slash match file names at any depth. Relative patterns with a slash match paths relative to the session working directory, even when path narrows the search. An absolute pattern chooses its own search directory and overrides path.
- Returns paths relative to the session working directory, sorted by modification time (oldest first, matching the verified Claude Code 2.1.316 behavior), with a maximum of 100 files. A truncation notice means the pattern should be narrowed.
- Uses pi's Glob tool hooks and permissions; it does not execute pi's find tool.`;

const output = `// Generated by scripts/generate-claude-tools.mjs from docs/data/tools.json.\n// Do not edit by hand; rerun the generator when the captured catalog changes.\n\nexport const CLAUDE_TOOL_CATALOG = ${JSON.stringify(selected, null, "\t")} as const;\n`;
await writeFile(join(root, "extensions/claude-native-tools/catalog.ts"), output, "utf8");
console.log("wrote extensions/claude-native-tools/catalog.ts");
