import fs from 'fs';

import { EnvLine } from './EnvLine';

export function writeEnvFile(
	filePath: string,
	lines: EnvLine[],
	extraVars: Record<string, string>,
	override: boolean
): void {
	// We'll handle extraVars in the same manner as lines:
	//   If a key doesn't exist, add it
	//   If it exists & override => update
	//   If it exists & no override => skip
	const linesMap = new Map<string, EnvLine>();
	for (const ln of lines) {
		if (ln.type === 'keyvalue') {
			linesMap.set(ln.key, ln);
		}
	}

	// Now handle extraVars
	for (const [k, v] of Object.entries(extraVars)) {
		if (linesMap.has(k)) {
			if (override) {
				// override the line
				linesMap.set(k, {
					type: 'keyvalue',
					key: k,
					value: v,
					raw: `${k}=${v}`,
				});
			}
			// if no override, do nothing
		} else {
			// key doesn't exist, add it
			linesMap.set(k, {
				type: 'keyvalue',
				key: k,
				value: v,
				raw: `${k}=${v}`,
			});
		}
	}

	// convert Map back to array for output
	const finalLines: EnvLine[] = [];
	for (const ln of lines) {
		if (ln.type !== 'keyvalue') {
			finalLines.push(ln);
		} else {
			// if it's keyvalue, we see if it changed in linesMap
			if (linesMap.has(ln.key)) {
				finalLines.push(linesMap.get(ln.key)!);
				linesMap.delete(ln.key);
			} else {
				// possibly removed key? we haven't implemented "remove" logic, so we skip
			}
		}
	}
	// add leftover lines from linesMap
	for (const ln of linesMap.values()) {
		if (!finalLines.includes(ln)) {
			finalLines.push(ln);
		}
	}

	// Now write
	const output: string[] = [];
	for (const line of finalLines) {
		if (line.type === 'comment' || line.type === 'blank') {
			output.push(line.text);
		} else if (line.type === 'keyvalue') {
			output.push(`${line.key}=${line.value}`);
		}
	}

	fs.writeFileSync(filePath, output.join('\n'), 'utf-8');
}
