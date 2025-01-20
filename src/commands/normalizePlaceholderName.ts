/** Convert a raw placeholder string to a normalized, lowercase version, underscores→dashes. */
export function normalizePlaceholderName(raw: string): string {
	return raw.trim().toLowerCase().replace(/_/g, '-');
}
