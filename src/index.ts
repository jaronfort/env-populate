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
 * Extended options to include new flags:
 * - dryRun?: boolean
 * - override?: boolean
 * - silent?: boolean
 * - verbose?: boolean
 * - ignore?: string
 */
interface Options {
	out?: string;
	merge?: boolean;
	values?: string;
	vars?: string;
	dryRun?: boolean;
	override?: boolean;
	// New flags
	silent?: boolean;
	verbose?: boolean;
	ignore?: string;
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
	missingPlaceholders: string[],
	log: ReturnType<typeof createLogger>
): PlaceholdersMap {
	const placeholders: PlaceholdersMap = {};

	log.verbose(
		'Invoking `supabase status -o json` to fetch missing placeholders:',
		missingPlaceholders.join(', ')
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

	// Parse the JSON
	let jsonData: any;
	try {
		jsonData = JSON.parse(result.stdout);
	} catch {
		log.warn('Failed to parse JSON from `supabase status -o json`.');
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
// Helper Logging and Ignore Logic
// ----------------------------------------------------------------

/** Create a logger object that respects --silent, --verbose. */
function createLogger(options: { silent?: boolean; verbose?: boolean }) {
	const isSilent = !!options.silent;
	const isVerbose = !!options.verbose && !isSilent; // if silent is set, we ignore verbose

	return {
		normal(...args: any[]) {
			if (!isSilent) {
				console.log(...args);
			}
		},
		verbose(...args: any[]) {
			if (isVerbose) {
				console.log(...args);
			}
		},
		warn(...args: any[]) {
			if (!isSilent) {
				console.log(chalk.yellow('Warning:'), ...args);
			}
		},
		error(...args: any[]) {
			if (!isSilent) {
				console.log(chalk.red('Error:'), ...args);
			}
		},
	};
}

/** Parse a comma-separated ignore list into an array of directory names. */
function parseIgnoreList(input: string): string[] {
	if (!input.trim()) return [];
	return input
		.split(',')
		.map((x) => x.trim())
		.filter((x) => x.length > 0);
}

// ----------------------------------------------------------------
// More Helper Functions
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
	// Create a logger respecting --silent, --verbose
	const log = createLogger({
		silent: options.silent,
		verbose: options.verbose,
	});

	// Parse user placeholders from --values
	const userValues = options.values ? parseKeyValuePairs(options.values) : {};
	const userPlaceholders: PlaceholdersMap = {};
	for (const rawKey of Object.keys(userValues)) {
		const normalized = validatePlaceholderKey(rawKey);
		userPlaceholders[normalized] = userValues[rawKey];
	}

	// Parse extra vars from --vars
	const extraVars = options.vars ? parseKeyValuePairs(options.vars) : {};

	// Parse the ignore list for directories
	const ignoreList = options.ignore ? parseIgnoreList(options.ignore) : [];

	// Recursively collect .env.example files
	const envExampleFiles: string[] = [];

	function scanDir(root: string) {
		log.verbose(`Scanning directory: ${root}`);
		const entries = fs.readdirSync(root, { withFileTypes: true });
		for (const e of entries) {
			const fullPath = path.join(root, e.name);

			// If this directory is in our ignore list, skip it
			if (e.isDirectory() && ignoreList.includes(e.name)) {
				log.verbose(`Skipping ignored directory: ${fullPath}`);
				continue;
			}

			if (e.isDirectory()) {
				scanDir(fullPath);
			} else {
				if (e.name === '.env.example') {
					log.verbose(`Found .env.example: ${fullPath}`);
					envExampleFiles.push(fullPath);
				}
			}
		}
	}
	scanDir(dirPath);

	if (envExampleFiles.length === 0) {
		log.normal(chalk.yellow('No .env.example files found in:'), dirPath);
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
	log.verbose(`Used placeholders: ${[...usedPlaceholders].join(', ')}`);
	log.verbose(`Used SUPABASE placeholders: ${usedSupabase.join(', ')}`);

	// 6. Filter out any that the user has already supplied
	const missingSupabase = usedSupabase.filter(
		(p) => !(p in userPlaceholders)
	);

	// 7. If there's at least 1 missing built-in placeholder, run supabase status
	let supabasePlaceholders: PlaceholdersMap = {};
	if (missingSupabase.length > 0) {
		supabasePlaceholders = maybeGetSupabasePlaceholders(
			missingSupabase,
			log
		);
	} else {
		log.verbose(
			'No missing built-in Supabase placeholders. Skipping supabase status.'
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

	log.verbose(
		`Starting .env.local generation. Merging: ${!!options.merge}, Override: ${!!canOverride}`
	);

	// 10. For each .env.example, replace placeholders and merge/write .env.local
	for (const exampleFile of envExampleFiles) {
		log.normal(chalk.green('Processing:'), exampleFile);

		const envExampleLines = fileLinesMap.get(exampleFile)!;
		const generated = generateEnvLocalLines(
			envExampleLines,
			combinedPlaceholders
		);

		const outputFileName = options.out || '.env.local';
		const outputFilePath = path.join(
			path.dirname(exampleFile),
			outputFileName
		);

		// If file exists and --no-merge is set, skip
		if (fs.existsSync(outputFilePath) && !options.merge) {
			log.normal(
				chalk.blue(
					'Skipping because --no-merge is set and file already exists:'
				),
				outputFilePath
			);
			continue;
		}

		if (fs.existsSync(outputFilePath)) {
			// MERGE scenario
			log.normal(chalk.cyan('Merging into existing:'), outputFilePath);

			// If override = true, we overwrite existing keys
			const existing = parseEnvFile(outputFilePath);
			const merged = mergeEnvLocal(
				existing,
				generated,
				Boolean(canOverride)
			);

			if (options.dryRun) {
				log.normal(
					chalk.yellow(
						'[DRY RUN] Would have merged/overwritten .env.local:'
					),
					outputFilePath
				);
			} else {
				writeEnvFile(outputFilePath, merged, extraVars);
				log.normal(
					chalk.cyan('Merged .env.local updated:'),
					outputFilePath
				);
			}
		} else {
			// CREATE scenario
			if (options.dryRun) {
				log.normal(
					chalk.yellow(
						'[DRY RUN] Would have created new .env.local:'
					),
					outputFilePath
				);
			} else {
				writeEnvFile(outputFilePath, generated, extraVars);
				log.normal(
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
		'Scan directory for .env.example and populates placeholder values .env.local files (KEY=<placeholder> -> KEY=...)'
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
	.option('--silent', 'Suppress all output', false)
	.option('--verbose', 'Show extra logs (ignored if --silent)', false)
	.option(
		'--ignore <patterns>',
		'Comma separated list of directory names to skip',
		''
	)
	.argument(
		'[dir]',
		'Directory to scan (defaults to current working directory)',
		process.cwd()
	)
	.action((dir: string, opts: Options) => {
		try {
			// Because we used `--out` in Commander, but our code expects `options.output`,
			// we alias that here:
			if (typeof opts.out === 'string') {
				opts.out = opts.out;
			}

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
