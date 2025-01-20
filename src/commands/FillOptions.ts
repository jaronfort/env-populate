/**
 * Extended options to include new flags:
 * - dryRun?: boolean
 * - override?: boolean
 * - silent?: boolean
 * - verbose?: boolean
 * - ignore?: string
 */
export interface FillOptions {
	out?: string;
	merge?: boolean;
	values?: string;
	vars?: string;
	dryRun?: boolean;
	override?: boolean;
	silent?: boolean;
	verbose?: boolean;
	ignore?: string;
}
