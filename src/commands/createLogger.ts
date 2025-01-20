import chalk from 'chalk';

export function createLogger(options: { silent?: boolean; verbose?: boolean }) {
	const isSilent = !!options.silent;
	const isVerbose = !!options.verbose && !isSilent;

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
