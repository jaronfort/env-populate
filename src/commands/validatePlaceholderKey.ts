import { normalizePlaceholderName } from './normalizePlaceholderName';

/** Regex for valid placeholders: <SOME_PLACEHOLDER> (alphanumeric, underscore, dash) */
const PLACEHOLDER_REGEX = /^[a-zA-Z0-9_-]+$/;

export function validatePlaceholderKey(rawKey: string): string {
	const normalized = normalizePlaceholderName(rawKey);
	if (!PLACEHOLDER_REGEX.test(normalized)) {
		throw new Error(
			`Invalid placeholder name "${rawKey}". Must match ${PLACEHOLDER_REGEX}`
		);
	}
	return normalized;
}
