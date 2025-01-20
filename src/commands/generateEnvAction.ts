import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

import { createLogger } from '@/logs/createLogger';
import { getLocalIp } from '@/utils/network';

import { EnvLine } from './EnvLine';
import { fetchFromSupabaseJSON } from './fetchFromSupabaseJSON';
import { FillOptions } from './FillOptions';
import { generateEnvLocalLines } from './generateEnvLocalLines';
import { mergeEnvLocal } from './mergeEnvLocal';
import { normalizePlaceholderName } from './normalizePlaceholderName';
import { parseEnvFile } from './parseEnvFile';
import { parseIgnoreList } from './parseIngoreList';
import { parseKeyValuePairs } from './parseKeyValuePairs';
import { PlaceholdersMap } from './PlaceholderMap';
import { validatePlaceholderKey } from './validatePlaceholderKey';
import { writeEnvFile } from './writeEnvFile';

export function generateEnvAction(dirPath: string, options: FillOptions): void {
	const log = createLogger({
		silent: options.silent,
		verbose: options.verbose,
	});

	// 1) Parse user placeholders from --values
	const userValues = options.values ? parseKeyValuePairs(options.values) : {};
	const userPlaceholders: PlaceholdersMap = {};
	for (const rawKey of Object.keys(userValues)) {
		const normalized = validatePlaceholderKey(rawKey);
		userPlaceholders[normalized] = userValues[rawKey];
	}

	// 2) Extra vars from --vars
	const extraVars = options.vars ? parseKeyValuePairs(options.vars) : {};

	// 3) Build ignore list
	const ignoreList = options.ignore ? parseIgnoreList(options.ignore) : [];

	// 4) Find .env.example files
	const envExampleFiles: string[] = [];
	function scanDir(root: string) {
		log.verbose(`Scanning: ${root}`);
		const entries = fs.readdirSync(root, { withFileTypes: true });
		for (const e of entries) {
			const fullPath = path.join(root, e.name);
			if (e.isDirectory() && ignoreList.includes(e.name)) {
				log.verbose(`Ignoring dir: ${fullPath}`);
				continue;
			}
			if (e.isDirectory()) {
				scanDir(fullPath);
			} else if (e.name === '.env.example') {
				log.verbose(`Found .env.example: ${fullPath}`);
				envExampleFiles.push(fullPath);
			}
		}
	}
	scanDir(dirPath);

	if (envExampleFiles.length === 0) {
		log.normal(chalk.yellow('No .env.example files found in:'), dirPath);
		return;
	}

	// 5) For each .env.example, gather placeholders used
	const usedPlaceholders = new Set<string>();
	const fileLinesMap = new Map<string, EnvLine[]>();

	for (const file of envExampleFiles) {
		const lines = parseEnvFile(file);
		fileLinesMap.set(file, lines);

		for (const ln of lines) {
			if (ln.type !== 'keyvalue') continue;
			const match = ln.value.trim().match(/^<(.*)>$/);
			if (match) {
				usedPlaceholders.add(normalizePlaceholderName(match[1]));
			}
		}
	}

	log.verbose(`All placeholders found: ${[...usedPlaceholders].join(', ')}`);

	// 6) If <host-ip> is used but not provided by user, fill it
	if (usedPlaceholders.has('host-ip') && !('host-ip' in userPlaceholders)) {
		const localIp = getLocalIp();
		if (localIp) {
			userPlaceholders['host-ip'] = localIp;
			log.verbose(`Set <host-ip> => ${localIp}`);
		}
	}

	// 7) For each placeholder used in .env.example but missing from user placeholders,
	//    attempt to fetch from supabase's JSON
	const missing = [...usedPlaceholders].filter(
		(p) => !(p in userPlaceholders)
	);
	const supabaseMap = fetchFromSupabaseJSON(missing, log);

	// 8) Combine placeholders so user overrides supabase
	const finalPlaceholders: PlaceholdersMap = {
		...supabaseMap,
		...userPlaceholders,
	};

	// 9) Decide override logic
	const canOverride = !options.merge && options.override;
	log.verbose(`Merging: ${!!options.merge}, override: ${!!canOverride}`);

	// 10) Process each .env.example
	for (const exampleFile of envExampleFiles) {
		log.normal(chalk.green('Processing:'), exampleFile);

		const envExampleLines = fileLinesMap.get(exampleFile)!;
		const replaced = generateEnvLocalLines(
			envExampleLines,
			finalPlaceholders
		);

		const outputFileName = options.out || '.env.local';
		const outputFilePath = path.join(
			path.dirname(exampleFile),
			outputFileName
		);

		// if file exists & !merge => skip
		if (fs.existsSync(outputFilePath) && !options.merge) {
			log.normal(
				chalk.blue('Skipping because --no-merge is set & file exists:'),
				outputFilePath
			);
			continue;
		}

		if (fs.existsSync(outputFilePath)) {
			// merging scenario
			log.normal(chalk.cyan('Merging into existing:'), outputFilePath);
			const existing = parseEnvFile(outputFilePath);
			const merged = mergeEnvLocal(existing, replaced, !!canOverride);

			if (options.dryRun) {
				log.normal(
					chalk.yellow('[DRY RUN] Would have merged .env.local:'),
					outputFilePath
				);
			} else {
				// Now handle extraVars with the same override logic
				writeEnvFile(outputFilePath, merged, extraVars, !!canOverride);
				log.normal(
					chalk.cyan('Merged .env.local updated:'),
					outputFilePath
				);
			}
		} else {
			// create scenario
			if (options.dryRun) {
				log.normal(
					chalk.yellow(
						'[DRY RUN] Would have created new .env.local:'
					),
					outputFilePath
				);
			} else {
				// if the file doesn't exist, we apply placeholders, then handle extra vars
				const newFileMerged = mergeEnvLocal([], replaced, false); // no existing lines, so override doesn't matter
				writeEnvFile(
					outputFilePath,
					newFileMerged,
					extraVars,
					!!canOverride
				);
				log.normal(
					chalk.cyan('New .env.local created:'),
					outputFilePath
				);
			}
		}
	}
}
