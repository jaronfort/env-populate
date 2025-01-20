#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs';
import path from 'path';

import { fillCommand } from '@/commands/fill.command';

const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const VERSION = packageJson.version || '0.0.0';

const program = new Command();

program
	.name('env-populate')
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
	.action(fillCommand);

program.parse(process.argv);

if (!program.args.length) {
	program.help();
}
