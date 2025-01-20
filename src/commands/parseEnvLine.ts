import { EnvLine } from './EnvLine';

const ENV_LINE_REGEX = /^([\w.-]+)\s*=\s*(.*)$/;

export function parseEnvLine(line: string): EnvLine {
	if (!line.trim()) {
		return { type: 'blank', text: '' };
	}
	if (line.trimStart().startsWith('#')) {
		return { type: 'comment', text: line };
	}
	const match = line.match(ENV_LINE_REGEX);
	if (!match) {
		return { type: 'comment', text: line };
	}
	const key = match[1];
	const value = match[2];
	return {
		type: 'keyvalue',
		key,
		value,
		raw: line,
	};
}
