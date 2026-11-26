/**
 * Normalize the small syntax differences between ripgrep globset and
 * minimatch. Matching itself stays in minimatch. In globset, a single-entry
 * brace group is grouping, rather than minimatch's numeric range syntax.
 */
export function normalizeGlobPattern(pattern: string): string {
	let position = 0;
	const invalid = (detail: string): never => { throw new Error(`Glob: invalid glob pattern: ${detail}`); };
	function sequence(inGroup: boolean): string {
		let output = "";
		while (position < pattern.length) {
			const char = pattern[position];
			if (char === "\\") {
				if (position + 1 >= pattern.length) invalid("dangling escape");
				output += pattern.slice(position, position + 2);
				position += 2;
				continue;
			}
			if (char === "[") {
				const start = position++;
				if (pattern[position] === "!" || pattern[position] === "^") position++;
				if (pattern[position] === "]") position++;
				const contentStart = position;
				while (position < pattern.length && pattern[position] !== "]") {
					if (pattern[position] === "\\") position++;
					position++;
				}
				if (position >= pattern.length) invalid("unclosed character class; missing ']'");
				const content = pattern.slice(contentStart, position);
				for (let index = 1; index + 1 < content.length; index++) {
					if (content[index] === "-" && content[index - 1] !== "\\" && content.codePointAt(index - 1)! > content.codePointAt(index + 1)!) {
						invalid("invalid character class range");
					}
				}
				output += pattern.slice(start, ++position);
				continue;
			}
			if (char === "{") {
				position++;
				const alternatives = [sequence(true)];
				while (pattern[position] === ",") {
					position++;
					alternatives.push(sequence(true));
				}
				if (pattern[position] !== "}") invalid("unclosed alternate group; missing '}'");
				position++;
				output += alternatives.length === 1 ? alternatives[0] : `{${alternatives.join(",")}}`;
				continue;
			}
			if (inGroup && (char === "," || char === "}")) break;
			if (char === "}") invalid("unopened alternate group; missing '{'");
			output += char;
			position++;
		}
		return output;
	}
	return sequence(false);
}
