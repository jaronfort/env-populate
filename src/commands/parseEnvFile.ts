import fs from 'fs';

import { EnvLine } from './EnvLine';
import { parseEnvLine } from './parseEnvLine';

export function parseEnvFile(filePath: string): EnvLine[] {
	const content = fs.readFileSync(filePath, 'utf-8');
	const lines = content.split(/\r?\n/);
	return lines.map(parseEnvLine);
}
