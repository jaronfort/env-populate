export type EnvLine =
	| { type: 'comment'; text: string }
	| { type: 'blank'; text: '' }
	| { type: 'keyvalue'; key: string; value: string; raw: string };
