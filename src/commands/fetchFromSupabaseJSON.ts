import { spawnSync } from 'child_process';

import { createLogger } from './createLogger';
import { PlaceholdersMap } from './PlaceholderMap';

/**
 * If a placeholder <something> is missing from user placeholders,
 * we check Supabase JSON for a field "SOMETHING" (uppercased).
 */
export function fetchFromSupabaseJSON(
	placeholderNames: string[], // all placeholders that are missing
	log: ReturnType<typeof createLogger>
): PlaceholdersMap {
	const placeholders: PlaceholdersMap = {};

	if (placeholderNames.length === 0) {
		return placeholders;
	}

	log.verbose(
		`Invoking \`supabase status -o json\` to fetch placeholders: ${placeholderNames.join(', ')}`
	);

	const result = spawnSync('supabase', ['status', '-o', 'json'], {
		encoding: 'utf-8',
	});

	if (result.error) {
		log.warn(
			'Could not run `supabase status -o json`. Some placeholders may remain unpopulated.'
		);
		return placeholders;
	}
	if (result.status !== 0) {
		log.warn(
			'Non-zero exit code from `supabase status -o json`. Some placeholders may remain unpopulated.'
		);
		return placeholders;
	}

	let jsonData: any;
	try {
		jsonData = JSON.parse(result.stdout);
	} catch {
		log.warn('Failed to parse JSON from `supabase status -o json`.');
		return placeholders;
	}

	placeholders['supabase-url'] = jsonData.API_URL;
	placeholders['supabase-anon-key'] = jsonData.ANON_KEY;
	placeholders['supabase-service-role-key'] = jsonData.SERVICE_ROLE_KEY;
	placeholders['supabase-graphql-url'] = jsonData.GRAPHQL_URL;
	placeholders['supabase-db-url'] = jsonData.DB_URL;

	return placeholders;
}
