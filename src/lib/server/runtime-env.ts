import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let dotenvLoaded = false;

function ensureDotenvLoaded() {
	if (dotenvLoaded) {
		return;
	}

	dotenvLoaded = true;

	try {
		require('dotenv/config');
	} catch {
		// Ignore missing dotenv in deployed runtimes where process.env is already populated.
	}
}

export function getPrivateEnv(name: string) {
	ensureDotenvLoaded();

	const value = process.env[name];
	return typeof value === 'string' ? value : undefined;
}
