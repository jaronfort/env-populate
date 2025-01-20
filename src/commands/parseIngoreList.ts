export function parseIgnoreList(input: string): string[] {
	if (!input.trim()) return [];
	return input
		.split(',')
		.map((x) => x.trim())
		.filter((x) => x.length > 0);
}
