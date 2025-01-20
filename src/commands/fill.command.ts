import chalk from 'chalk';
import path from 'path';

import { FillOptions } from './FillOptions';
import { generateEnvAction } from './generateEnvAction';

export function fillCommand(dir: string, opts: FillOptions) {
	try {
		generateEnvAction(path.resolve(dir), opts);
	} catch (error: any) {
		console.error(chalk.red('Error:'), error.message);
		process.exit(1);
	}
}
