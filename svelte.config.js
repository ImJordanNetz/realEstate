import adapter from '@sveltejs/adapter-vercel';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			// Ensure serverless functions have access to our bundled JSON datasets
			includeFiles: ['src/lib/server/data/**'],
			runtime: 'nodejs20.x'
		})
	}
};

export default config;
