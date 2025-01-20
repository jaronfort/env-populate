export function parseKeyValuePairs(input: string): Record<string, string> {
	const result: Record<string, string> = {};
	if (!input.trim()) return result;

	const pairs = input.split(',');
	for (const p of pairs) {
		const [k, v] = p.split('=');
		if (!k || !v) {
			throw new Error(
				`Invalid key-value pair: "${p}". Must be "key=value"`
			);
		}
		result[k.trim()] = v.trim();
	}
	return result;
}
