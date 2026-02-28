import 'dotenv/config';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const API_KEY = process.env.RENTCAST_API_KEY;
if (!API_KEY) {
	console.error('Missing RENTCAST_API_KEY in .env');
	process.exit(1);
}

const DATA_DIR = join(import.meta.dirname, '..', 'src', 'lib', 'server', 'data');
const RAW_DIR = join(DATA_DIR, 'rentcast-raw');
const META_PATH = join(DATA_DIR, 'rentcast-meta.json');

type QueryConfig = {
	label: string;
	params: Record<string, string>;
};

type MetaEntry = {
	label: string;
	params: Record<string, string>;
	fetchedAt: string;
	count: number;
	file: string;
};

type Meta = {
	queries: MetaEntry[];
	totalApiCalls: number;
	totalListings: number;
};

function loadMeta(): Meta {
	if (existsSync(META_PATH)) {
		return JSON.parse(readFileSync(META_PATH, 'utf-8'));
	}
	return { queries: [], totalApiCalls: 0, totalListings: 0 };
}

function saveMeta(meta: Meta) {
	writeFileSync(META_PATH, JSON.stringify(meta, null, 2));
}

async function fetchRentcast(query: QueryConfig): Promise<unknown[]> {
	const url = new URL('https://api.rentcast.io/v1/listings/rental/long-term');
	url.searchParams.set('limit', '500');
	url.searchParams.set('status', 'Active');

	for (const [key, value] of Object.entries(query.params)) {
		url.searchParams.set(key, value);
	}

	console.log(`Fetching: ${query.label}`);
	console.log(`  URL: ${url.toString()}`);

	const response = await fetch(url.toString(), {
		headers: { 'X-Api-Key': API_KEY! }
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Rentcast API error ${response.status}: ${body}`);
	}

	const data = await response.json();
	const listings = Array.isArray(data) ? data : [];
	console.log(`  Got ${listings.length} listings`);
	return listings;
}

// --- Define the single test query ---
const queries: QueryConfig[] = [
	{
		label: 'irvine-apartments',
		params: {
			city: 'Irvine',
			state: 'CA',
			propertyType: 'Apartment'
		}
	}
];

async function main() {
	mkdirSync(RAW_DIR, { recursive: true });
	const meta = loadMeta();

	for (const query of queries) {
		const existing = meta.queries.find((q) => q.label === query.label);
		if (existing) {
			console.log(`Skipping "${query.label}" — already fetched on ${existing.fetchedAt} (${existing.count} listings)`);
			continue;
		}

		const listings = await fetchRentcast(query);
		const filename = `${query.label}.json`;
		const filepath = join(RAW_DIR, filename);

		writeFileSync(filepath, JSON.stringify(listings, null, 2));

		meta.queries.push({
			label: query.label,
			params: query.params,
			fetchedAt: new Date().toISOString(),
			count: listings.length,
			file: filename
		});
		meta.totalApiCalls++;
		meta.totalListings += listings.length;

		console.log(`  Saved to ${filepath}`);
	}

	saveMeta(meta);
	console.log(`\nDone. Total API calls used: ${meta.totalApiCalls}, Total listings: ${meta.totalListings}`);
}

main().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(1);
});
