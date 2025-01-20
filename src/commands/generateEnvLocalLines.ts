import { EnvLine } from './EnvLine';
import { normalizePlaceholderName } from './normalizePlaceholderName';
import { PlaceholdersMap } from './PlaceholderMap';

export function generateEnvLocalLines(
	envExampleLines: EnvLine[],
	placeholderMap: PlaceholdersMap
): EnvLine[] {
	return envExampleLines.map((line) => {
		if (line.type !== 'keyvalue') return line;

		const rawValue = line.value.trim();
		const placeholderMatch = rawValue.match(/^<(.*)>$/);
		if (!placeholderMatch) return line;

		const placeholderName = normalizePlaceholderName(placeholderMatch[1]);
		const replacement = placeholderMap[placeholderName];
		if (replacement !== undefined && replacement !== null) {
			return {
				...line,
				value: replacement,
				raw: `${line.key}=${replacement}`,
			};
		}
		return line;
	});
}
