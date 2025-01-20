#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

// If you want to embed package.json in your bundle, you could do:
// import packageJson from '../package.json';
// For now we'll just read from disk:
const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const VERSION = packageJson.version || '0.0.0';

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

type EnvLine =
	| { type: 'comment'; text: string }
	| { type: 'blank'; text: '' }
	| { type: 'keyvalue'; key: string; value: string; raw: string };

interface PlaceholdersMap {
	[placeholderName: string]: string;
}

/**
 * Extended options to include new flags:1
 * - dryRun?: boolean
 * - override?: boolean
 */
interface Options {
	output?: string;
	merge?: boolean;
	// placeholders from --values
	values?: string;
	// additional vars from --vars
	vars?: string;
	// new flags
	dryRun?: boolean;
	override?: boolean;
}

// ----------------------------------------------------------------
// Constants & Regex
// ----------------------------------------------------------------

/** Built-in Supabase placeholders recognized by our tool. */
const BUILT_IN_PLACEHOLDER_KEYS = [
	'supabase-url',
	'supabase-anon-key',
	'supabase-db-url',
	'supabase-api-url',
	'supabase-graphql-url',
	'supabase-service-role-key',
];

/** Regex for lines in .env: KEY=VALUE or comment/blank */
const ENV_LINE_REGEX = /^([\w.-]+)\s*=\s*(.*)$/;

/** Regex for valid placeholders: <SOME_PLACEHOLDER> (alphanumeric, underscore, dash) */
const PLACEHOLDER_REGEX = /^[a-zA-Z0-9_-]+$/;

/** Convert a raw placeholder string to a normalized, lowercase version, underscores→dashes. */
function normalizePlaceholderName(raw: string): string {
	return raw.trim().toLowerCase().replace(/_/g, '-');
}

// ----------------------------------------------------------------
// Mapping from Supabase JSON -> placeholders
// ----------------------------------------------------------------

/**
 * Example JSON from `supabase status -o json` might look like:
 * {
 *   "API_URL": "...",
 *   "ANON_KEY": "...",
 *   "DB_URL": "...",
 *   "GRAPHQL_URL": "...",
 *   "SERVICE_ROLE_KEY": "...",
 *   ...
 * }
 *
 * We'll map these to the placeholders you want:
 */
const SUPABASE_JSON_TO_PLACEHOLDER: Record<string, string> = {
	API_URL: 'supabase-api-url',
	ANON_KEY: 'supabase-anon-key',
	DB_URL: 'supabase-db-url',
	GRAPHQL_URL: 'supabase-graphql-url',
	SERVICE_ROLE_KEY: 'supabase-service-role-key',
};

/**
 * Only call this if we know at least one built-in placeholder is needed.
 * Runs `supabase status -o json` and returns placeholders found.
 */
function maybeGetSupabasePlaceholders(
	missingPlaceholders: string[]
): PlaceholdersMap {
	const placeholders: PlaceholdersMap = {};

	// Run the command
	const result = spawnSync('supabase', ['status', '-o', 'json'], {
		encoding: 'utf-8',
	});

	if (result.error) {
		console.log(
			chalk.yellow('Warning:'),
			'Could not run `supabase status -o json`. Some placeholders will remain unpopulated.'
		);
		return placeholders;
	}
	if (result.status !== 0) {
		console.log(
			chalk.yellow('Warning:'),
			'Non-zero exit code from `supabase status -o json`. Some placeholders will remain unpopulated.'
		);
		return placeholders;
	}

	// Parse the JSON
	let jsonData: any;
	try {
		jsonData = JSON.parse(result.stdout);
	} catch {
		console.log(
			chalk.yellow('Warning:'),
			'Failed to parse JSON from `supabase status -o json`.'
		);
		return placeholders;
	}

	// Map the JSON fields to placeholders. E.g. "API_URL" -> "supabase-api-url"
	for (const [key, val] of Object.entries(jsonData)) {
		if (typeof val !== 'string') continue;
		const upperKey = key.toUpperCase();

		if (SUPABASE_JSON_TO_PLACEHOLDER[upperKey]) {
			const placeholderName = SUPABASE_JSON_TO_PLACEHOLDER[upperKey];
			if (missingPlaceholders.includes(placeholderName)) {
				placeholders[placeholderName] = val;
			}
			// Additionally set <supabase-url> from API_URL if missing
			if (
				upperKey === 'API_URL' &&
				missingPlaceholders.includes('supabase-url')
			) {
				placeholders['supabase-url'] = val;
			}
		}
	}

	return placeholders;
}

// ----------------------------------------------------------------
// Helper Functions
// ----------------------------------------------------------------

/** Parse a single line from an .env file into EnvLine. */
function parseEnvLine(line: string): EnvLine {
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

/** Parse an .env file (all lines). */
function parseEnvFile(filePath: string): EnvLine[] {
	const content = fs.readFileSync(filePath, 'utf-8');
	const lines = content.split(/\r?\n/);
	return lines.map(parseEnvLine);
}

/** Validate and parse comma-separated key-value pairs from a string, e.g. `foo=bar,baz=qux`. */
function parseKeyValuePairs(input: string): Record<string, string> {
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

/** Check that placeholders match the pattern, then normalize them. */
function validatePlaceholderKey(rawKey: string): string {
	const normalized = normalizePlaceholderName(rawKey);
	if (!PLACEHOLDER_REGEX.test(normalized)) {
		throw new Error(
			`Invalid placeholder name "${rawKey}". Must match ${PLACEHOLDER_REGEX}`
		);
	}
	return normalized;
}

// ----------------------------------------------------------------
// Merge logic with optional override
// ----------------------------------------------------------------

/**
 * Merges lines from new .env content with existing .env.local content.
 * - If `override` is false, we only add new keys that don't exist in existing.
 * - If `override` is true, we overwrite existing keys if they exist in `newLines`.
 */
function mergeEnvLocal(
	existingLines: EnvLine[],
	newLines: EnvLine[],
	override: boolean
): EnvLine[] {
	// Collect new lines into a map keyed by their KEY
	const newMap = new Map<string, EnvLine>();
	for (const ln of newLines) {
		if (ln.type === 'keyvalue') {
			newMap.set(ln.key, ln);
		}
	}

	// We'll accumulate final lines here, starting with existing lines.
	const merged: EnvLine[] = [];

	for (const ln of existingLines) {
		if (ln.type !== 'keyvalue') {
			merged.push(ln);
			continue;
		}
		const key = ln.key;
		if (!override) {
			// If override = false, keep existing as-is.
			// Only new lines for missing keys get appended after this loop.
			merged.push(ln);
			newMap.delete(key); // remove from newMap so we don't re-add it
		} else {
			// If override = true, check if newMap has this key
			if (newMap.has(key)) {
				// overwrite existing
				merged.push(newMap.get(key)!);
				newMap.delete(key);
			} else {
				merged.push(ln);
			}
		}
	}

	// Now add any leftover new lines that didn't exist in the existing file
	for (const line of newMap.values()) {
		merged.push(line);
	}

	return merged;
}

/**
 * Writes out lines to a file, optionally appending `--vars`.
 */
function writeEnvFile(
	filePath: string,
	lines: EnvLine[],
	extraVars: Record<string, string>
): void {
	const output: string[] = [];

	// Add the main lines
	for (const ln of lines) {
		if (ln.type === 'comment' || ln.type === 'blank') {
			output.push(ln.text);
		} else {
			output.push(`${ln.key}=${ln.value}`);
		}
	}

	// Append extra vars if any
	if (Object.keys(extraVars).length > 0) {
		output.push('');
		output.push('# Additional variables from --vars');
		for (const [k, v] of Object.entries(extraVars)) {
			output.push(`${k}=${v}`);
		}
	}

	fs.writeFileSync(filePath, output.join('\n'), 'utf-8');
}

// ----------------------------------------------------------------
// Replacing placeholders in .env.example
// ----------------------------------------------------------------

/**
 * Replace any placeholders (<...>) in each line with values from combinedPlaceholders.
 */
function generateEnvLocalLines(
	envExampleLines: EnvLine[],
	combinedPlaceholders: PlaceholdersMap
): EnvLine[] {
	return envExampleLines.map((line) => {
		if (line.type !== 'keyvalue') return line;

		const rawValue = line.value.trim();
		const placeholderMatch = rawValue.match(/^<(.*)>$/);
		if (!placeholderMatch) return line;

		const placeholderName = normalizePlaceholderName(placeholderMatch[1]);
		const replacement = combinedPlaceholders[placeholderName];
		if (replacement !== undefined && replacement !== null) {
			return {
				...line,
				value: replacement,
				raw: `${line.key}=${replacement}`,
			};
		}
		return line; // keep as placeholder if no match
	});
}

// ----------------------------------------------------------------
// Main Action
// ----------------------------------------------------------------

function generateEnvAction(dirPath: string, options: Options): void {
	// 1. Parse user placeholders from --values
	const userValues = options.values ? parseKeyValuePairs(options.values) : {};
	const userPlaceholders: PlaceholdersMap = {};
	for (const rawKey of Object.keys(userValues)) {
		const normalized = validatePlaceholderKey(rawKey);
		userPlaceholders[normalized] = userValues[rawKey];
	}

	// 2. Parse extra vars from --vars
	const extraVars = options.vars ? parseKeyValuePairs(options.vars) : {};

	// 3. Collect all .env.example files
	const envExampleFiles: string[] = [];
	function scanDir(root: string) {
		const entries = fs.readdirSync(root, { withFileTypes: true });
		for (const e of entries) {
			const fullPath = path.join(root, e.name);
			if (e.isDirectory()) {
				// If you want recursion, keep scanning
				scanDir(fullPath);
			} else {
				if (e.name === '.env.example') {
					envExampleFiles.push(fullPath);
				}
			}
		}
	}
	scanDir(dirPath);

	if (envExampleFiles.length === 0) {
		console.log(chalk.yellow('No .env.example files found in:'), dirPath);
		return;
	}

	// 4. Parse each .env.example to find what placeholders are actually used
	const usedPlaceholders = new Set<string>();
	const fileLinesMap = new Map<string, EnvLine[]>();

	for (const file of envExampleFiles) {
		const lines = parseEnvFile(file);
		fileLinesMap.set(file, lines);

		for (const ln of lines) {
			if (ln.type !== 'keyvalue') continue;
			const match = ln.value.trim().match(/^<(.*)>$/);
			if (match) {
				const placeholder = normalizePlaceholderName(match[1]);
				usedPlaceholders.add(placeholder);
			}
		}
	}

	// 5. Figure out which are built-in Supabase placeholders
	const usedSupabase = [...usedPlaceholders].filter((p) =>
		BUILT_IN_PLACEHOLDER_KEYS.includes(p)
	);

	// 6. Filter out any that the user has already supplied
	const missingSupabase = usedSupabase.filter(
		(p) => !(p in userPlaceholders)
	);

	// 7. If there's at least 1 missing built-in placeholder, run supabase status
	let supabasePlaceholders: PlaceholdersMap = {};
	if (missingSupabase.length > 0) {
		supabasePlaceholders = maybeGetSupabasePlaceholders(missingSupabase);
	} else {
		console.log(
			chalk.gray(
				'No missing built-in Supabase placeholders. Skipping supabase status.'
			)
		);
	}

	// 8. Combine: user placeholders override supabase placeholders
	const combinedPlaceholders: PlaceholdersMap = {
		...supabasePlaceholders,
		...userPlaceholders,
	};

	// 9. If --no-merge is set AND --override is set, we ignore override
	//    because no-merge takes precedence (we won't merge at all).
	const canOverride = !options.merge && options.override;

	// 10. For each .env.example, replace placeholders and merge/write .env.local
	for (const exampleFile of envExampleFiles) {
		console.log(chalk.green('Processing:'), exampleFile);

		const envExampleLines = fileLinesMap.get(exampleFile)!;
		const generated = generateEnvLocalLines(
			envExampleLines,
			combinedPlaceholders
		);

		const outputFileName = options.output || '.env.local';
		const outputFilePath = path.join(
			path.dirname(exampleFile),
			outputFileName
		);

		// If file exists and --no-merge is set, skip
		if (fs.existsSync(outputFilePath) && !options.merge) {
			console.log(
				chalk.blue(
					'Skipping because --no-merge is set and file already exists:'
				),
				outputFilePath
			);
			continue;
		}

		if (fs.existsSync(outputFilePath)) {
			// MERGE scenario
			console.log(chalk.cyan('Merging into existing:'), outputFilePath);

			// If override = true, we overwrite existing keys
			const existing = parseEnvFile(outputFilePath);
			const merged = mergeEnvLocal(
				existing,
				generated,
				Boolean(canOverride)
			);

			if (options.dryRun) {
				console.log(
					chalk.yellow(
						'[DRY RUN] Would have merged/overwritten .env.local:'
					),
					outputFilePath
				);
			} else {
				writeEnvFile(outputFilePath, merged, extraVars);
				console.log(
					chalk.cyan('Merged .env.local updated:'),
					outputFilePath
				);
			}
		} else {
			// CREATE scenario
			if (options.dryRun) {
				console.log(
					chalk.yellow(
						'[DRY RUN] Would have created new .env.local:'
					),
					outputFilePath
				);
			} else {
				writeEnvFile(outputFilePath, generated, extraVars);
				console.log(
					chalk.cyan('New .env.local created:'),
					outputFilePath
				);
			}
		}
	}
}

// ----------------------------------------------------------------
// Commander Setup
// ----------------------------------------------------------------

const program = new Command();

program
	.name('fitvids-env-scanner')
	.description(
		'Scan .env.example files, populate placeholders, generate .env.local, etc.'
	)
	.version(`v${VERSION}`, '-v, --version', 'Display the version')
	.helpOption('-h, --help', 'Display help message');

program
	.command('fill')
	.description(
		'Scan directory for .env.example and populates placeholder values .env.local files in the format of KEY=<placeholder-name> as KEY=my-value'
	)
	.helpOption('-h, --help', 'Display help message')
	.option('-o, --out <filename>', 'Output file name (default: .env.local)')
	.option(
		'--no-merge',
		'Disable merging if the output file already exists',
		true
	)
	.option(
		'--override',
		'Override existing keys in .env.local when merging (ignored if --no-merge)',
		false
	)
	.option('--dry-run', 'Do not write any files, just log what would happen')
	.option(
		'--values <pairs>',
		'Comma separated list of placeholderName=value for placeholders',
		''
	)
	.option(
		'--vars <pairs>',
		'Comma separated list of key=value for extra environment variables',
		''
	)
	.argument(
		'[dir]',
		'Directory to scan (defaults to current working directory)',
		process.cwd()
	)
	.action((dir: string, opts: Options) => {
		try {
			generateEnvAction(path.resolve(dir), opts);
		} catch (error: any) {
			console.error(chalk.red('Error:'), error.message);
			process.exit(1);
		}
	});

program.parse(process.argv);

if (!program.args.length) {
	program.help();
}
