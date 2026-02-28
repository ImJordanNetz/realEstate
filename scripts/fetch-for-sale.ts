import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
	extractRapidApiForSaleRows,
	getDefaultOrangeCountyHomesPath,
	getRapidApiForSaleMetaPath,
	getRapidApiForSaleRawDir,
	loadAllRapidApiForSaleRawListings,
	type HomeSearchListing
} from '../src/lib/server/home-inventory';

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY?.trim();
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST?.trim();
const RAPIDAPI_BASE_URL = process.env.RAPIDAPI_BASE_URL?.trim() || `https://${RAPIDAPI_HOST}`;

if (!RAPIDAPI_KEY) {
	console.error('Missing RAPIDAPI_KEY in .env');
	process.exit(1);
}

if (!RAPIDAPI_HOST) {
	console.error('Missing RAPIDAPI_HOST in .env');
	process.exit(1);
}

if (
	RAPIDAPI_HOST.includes('your-real-estate-api-host') ||
	RAPIDAPI_BASE_URL.includes('your-real-estate-api-host')
) {
	console.error(
		'RAPIDAPI_HOST is still set to the placeholder value. Set RAPIDAPI_HOST=us-real-estate.p.rapidapi.com in .env and rerun.'
	);
	process.exit(1);
}

const RAPIDAPI_FOR_SALE_PATH = process.env.RAPIDAPI_FOR_SALE_PATH?.trim() || '/v3/for-sale';
const RAPIDAPI_FOR_SALE_STATE_CODE =
	process.env.RAPIDAPI_FOR_SALE_STATE_CODE?.trim() || 'CA';
const DEFAULT_LIMIT = clampInt(process.env.RAPIDAPI_FOR_SALE_LIMIT, 200, 1, 200);
const DEFAULT_PAGES_PER_CITY = clampInt(
	process.env.RAPIDAPI_FOR_SALE_PAGES_PER_CITY,
	3,
	1,
	25
);
const REQUEST_DELAY_MS = clampInt(process.env.RAPIDAPI_REQUEST_DELAY_MS, 0, 0, 5_000);

const RAW_DIR = getRapidApiForSaleRawDir();
const META_PATH = getRapidApiForSaleMetaPath();
const OUTPUT_PATH = getDefaultOrangeCountyHomesPath();

const ORANGE_COUNTY_CITIES = [
	'Aliso Viejo',
	'Anaheim',
	'Brea',
	'Buena Park',
	'Costa Mesa',
	'Cypress',
	'Dana Point',
	'Fountain Valley',
	'Fullerton',
	'Garden Grove',
	'Huntington Beach',
	'Irvine',
	'La Habra',
	'La Palma',
	'Laguna Beach',
	'Laguna Hills',
	'Laguna Niguel',
	'Laguna Woods',
	'Lake Forest',
	'Los Alamitos',
	'Mission Viejo',
	'Newport Beach',
	'Orange',
	'Placentia',
	'Rancho Santa Margarita',
	'San Clemente',
	'San Juan Capistrano',
	'Santa Ana',
	'Seal Beach',
	'Stanton',
	'Tustin',
	'Villa Park',
	'Westminster',
	'Yorba Linda'
];

type CliOptions = {
	seeds: QuerySeed[];
	force: boolean;
	limit: number;
	pagesPerSeed: number;
};

type QuerySeed = {
	type: 'city' | 'zipcode';
	value: string;
	label: string;
	stateCode: string | null;
};

type MetaEntry = {
	seedType: 'city' | 'zipcode';
	seedValue: string;
	stateCode: string | null;
	page: number;
	offset: number;
	limit: number;
	fetchedAt: string;
	count: number;
	file: string;
	endpoint: string;
};

type Meta = {
	version: 1;
	host: string;
	baseUrl: string;
	path: string;
	queries: MetaEntry[];
	lastNormalizedAt: string | null;
	dedupedHomes: number;
};

function normalizeMetaEntry(entry: Record<string, unknown>): MetaEntry {
	const seedType = entry.seedType === 'zipcode' ? 'zipcode' : 'city';
	const seedValue =
		typeof entry.seedValue === 'string'
			? entry.seedValue
			: typeof entry.city === 'string'
				? entry.city
				: 'unknown';

	return {
		seedType,
		seedValue,
		stateCode: typeof entry.stateCode === 'string' ? entry.stateCode : null,
		page: typeof entry.page === 'number' ? entry.page : 0,
		offset: typeof entry.offset === 'number' ? entry.offset : 0,
		limit: typeof entry.limit === 'number' ? entry.limit : DEFAULT_LIMIT,
		fetchedAt: typeof entry.fetchedAt === 'string' ? entry.fetchedAt : new Date(0).toISOString(),
		count: typeof entry.count === 'number' ? entry.count : 0,
		file: typeof entry.file === 'string' ? entry.file : `${slugify(seedValue)}-page-01.json`,
		endpoint: typeof entry.endpoint === 'string' ? entry.endpoint : ''
	};
}

function clampInt(
	value: string | undefined,
	fallback: number,
	min: number,
	max: number
) {
	const numeric = value ? Number(value) : fallback;

	if (!Number.isInteger(numeric)) {
		return fallback;
	}

	return Math.min(max, Math.max(min, numeric));
}

function parseCliOptions(argv: string[]): CliOptions {
	let force = false;
	let limit = DEFAULT_LIMIT;
	let pagesPerSeed = DEFAULT_PAGES_PER_CITY;
	const selectedCities = new Set<string>();
	const selectedZipcodes = new Set<string>();
	const isZipcodeEndpoint = RAPIDAPI_FOR_SALE_PATH.includes('zipcode');

	for (const arg of argv) {
		if (arg === '--force') {
			force = true;
			continue;
		}

		if (arg.startsWith('--limit=')) {
			limit = clampInt(arg.slice('--limit='.length), DEFAULT_LIMIT, 1, 200);
			continue;
		}

		if (arg.startsWith('--pages=')) {
			pagesPerSeed = clampInt(arg.slice('--pages='.length), DEFAULT_PAGES_PER_CITY, 1, 25);
			continue;
		}

		if (arg.startsWith('--cities=')) {
			for (const city of arg
				.slice('--cities='.length)
				.split(',')
				.map((value) => value.trim())
				.filter(Boolean)) {
					selectedCities.add(city);
			}

			continue;
		}

		if (arg.startsWith('--zipcodes=')) {
			for (const zipcode of arg
				.slice('--zipcodes='.length)
				.split(',')
				.map((value) => value.trim())
				.filter(Boolean)) {
				selectedZipcodes.add(zipcode);
			}
		}
	}

	if (selectedZipcodes.size && !isZipcodeEndpoint) {
		throw new Error(
			'--zipcodes can only be used with a zipcode endpoint such as /v2/for-sale-by-zipcode.'
		);
	}

	if (isZipcodeEndpoint && !selectedZipcodes.size) {
		throw new Error(
			`RAPIDAPI_FOR_SALE_PATH=${RAPIDAPI_FOR_SALE_PATH} requires --zipcodes=... because this endpoint does not accept city/state seeds.`
		);
	}

	const seeds: QuerySeed[] = isZipcodeEndpoint
		? [...selectedZipcodes].map((zipcode) => ({
				type: 'zipcode',
				value: zipcode,
				label: zipcode,
				stateCode: null
			}))
		: (selectedCities.size ? [...selectedCities] : ORANGE_COUNTY_CITIES).map((city) => ({
				type: 'city',
				value: city,
				label: city,
				stateCode: RAPIDAPI_FOR_SALE_STATE_CODE
			}));

	return {
		seeds,
		force,
		limit,
		pagesPerSeed
	};
}

function slugify(value: string) {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function queryKey(seedType: QuerySeed['type'], seedValue: string, page: number) {
	return `${seedType}:${seedValue.toLowerCase()}::${page}`;
}

function buildFilename(seed: QuerySeed, page: number) {
	return `${slugify(seed.value)}-page-${String(page + 1).padStart(2, '0')}.json`;
}

function loadMeta(): Meta {
	if (!existsSync(META_PATH)) {
		return {
			version: 1,
			host: RAPIDAPI_HOST!,
			baseUrl: RAPIDAPI_BASE_URL,
			path: RAPIDAPI_FOR_SALE_PATH,
			queries: [],
			lastNormalizedAt: null,
			dedupedHomes: 0
		};
	}

	const parsed = JSON.parse(readFileSync(META_PATH, 'utf-8')) as {
		version?: number;
		host?: string;
		baseUrl?: string;
		path?: string;
		queries?: Array<Record<string, unknown>>;
		lastNormalizedAt?: string | null;
		dedupedHomes?: number;
	};

	return {
		version: 1,
		host: typeof parsed.host === 'string' ? parsed.host : RAPIDAPI_HOST!,
		baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : RAPIDAPI_BASE_URL,
		path: typeof parsed.path === 'string' ? parsed.path : RAPIDAPI_FOR_SALE_PATH,
		queries: Array.isArray(parsed.queries) ? parsed.queries.map(normalizeMetaEntry) : [],
		lastNormalizedAt:
			typeof parsed.lastNormalizedAt === 'string' || parsed.lastNormalizedAt === null
				? parsed.lastNormalizedAt
				: null,
		dedupedHomes: typeof parsed.dedupedHomes === 'number' ? parsed.dedupedHomes : 0
	};
}

function saveMeta(meta: Meta) {
	const sortedQueries = [...meta.queries].sort((a, b) =>
		a.seedValue === b.seedValue ? a.page - b.page : a.seedValue.localeCompare(b.seedValue)
	);

	const totalRawRows = sortedQueries.reduce((sum, query) => sum + query.count, 0);

	writeFileSync(
		META_PATH,
		JSON.stringify(
			{
				...meta,
				host: RAPIDAPI_HOST!,
				baseUrl: RAPIDAPI_BASE_URL,
				path: RAPIDAPI_FOR_SALE_PATH,
				queries: sortedQueries,
				totalApiCalls: sortedQueries.length,
				totalRawRows
			},
			null,
			2
		)
	);
}

function upsertMetaEntry(meta: Meta, entry: MetaEntry) {
	meta.queries = meta.queries.filter(
		(existing) =>
			queryKey(existing.seedType, existing.seedValue, existing.page) !==
			queryKey(entry.seedType, entry.seedValue, entry.page)
	);
	meta.queries.push(entry);
}

function buildRequestUrl(seed: QuerySeed, offset: number, limit: number) {
	const url = new URL(RAPIDAPI_FOR_SALE_PATH, RAPIDAPI_BASE_URL);

	if (seed.type === 'zipcode') {
		url.searchParams.set('zipcode', seed.value);
	} else {
		url.searchParams.set('city', seed.value);
		url.searchParams.set('state_code', seed.stateCode ?? RAPIDAPI_FOR_SALE_STATE_CODE);
	}

	url.searchParams.set('offset', String(offset));
	url.searchParams.set('limit', String(limit));
	return url;
}

async function fetchForSalePage(seed: QuerySeed, page: number, limit: number) {
	const offset = page * limit;
	const url = buildRequestUrl(seed, offset, limit);

	console.log(`Fetching ${seed.label} page ${page + 1}`);
	console.log(`  ${url.toString()}`);

	const response = await fetch(url, {
		headers: {
			'x-rapidapi-key': RAPIDAPI_KEY!,
			'x-rapidapi-host': RAPIDAPI_HOST!
		}
	});

	const body = await response.text();

	if (!response.ok) {
		if (
			response.status === 404 &&
			body.toLowerCase().includes('does not exist')
		) {
			throw new Error(
				`RapidAPI endpoint ${RAPIDAPI_FOR_SALE_PATH} does not exist on ${RAPIDAPI_HOST}. The current docs list both "/v3/for-sale" and "/api/v3/for-sale", but your live test suggests the "/api" alias may be dead. Try RAPIDAPI_FOR_SALE_PATH=/v3/for-sale first, then /v2/for-sale, then /v2/for-sale-by-zipcode. Raw response: ${body}`
			);
		}

		throw new Error(`RapidAPI error ${response.status}: ${body}`);
	}

	const payload = JSON.parse(body);
	const count = extractRapidApiForSaleRows(payload).length;

	return {
		payload,
		count,
		offset,
		endpoint: url.toString()
	};
}

async function sleep(ms: number) {
	if (ms <= 0) {
		return;
	}

	await new Promise((resolve) => setTimeout(resolve, ms));
}

function writeNormalizedHomes(listings: HomeSearchListing[]) {
	const sorted = [...listings].sort((a, b) => {
		const cityCompare = (a.city ?? '').localeCompare(b.city ?? '');
		if (cityCompare !== 0) {
			return cityCompare;
		}

		return a.address.localeCompare(b.address);
	});

	writeFileSync(OUTPUT_PATH, JSON.stringify(sorted, null, 2));
}

async function main() {
	const options = parseCliOptions(process.argv.slice(2));
	mkdirSync(RAW_DIR, { recursive: true });

	const meta = loadMeta();
	const existingQueries = new Map(
		meta.queries.map((entry) => [
			queryKey(entry.seedType, entry.seedValue, entry.page),
			entry
		])
	);

	for (const seed of options.seeds) {
		for (let page = 0; page < options.pagesPerSeed; page++) {
			const key = queryKey(seed.type, seed.value, page);
			const existing = existingQueries.get(key);
			const filename = buildFilename(seed, page);
			const filepath = `${RAW_DIR}/${filename}`;

			if (!options.force && existing && existsSync(filepath)) {
				console.log(
					`Skipping ${seed.label} page ${page + 1} — already fetched on ${existing.fetchedAt} (${existing.count} rows)`
				);

				if (existing.count < options.limit) {
					break;
				}

				continue;
			}

			const result = await fetchForSalePage(seed, page, options.limit);
			writeFileSync(filepath, JSON.stringify(result.payload, null, 2));

			const entry: MetaEntry = {
				seedType: seed.type,
				seedValue: seed.value,
				stateCode: seed.stateCode,
				page,
				offset: result.offset,
				limit: options.limit,
				fetchedAt: new Date().toISOString(),
				count: result.count,
				file: filename,
				endpoint: result.endpoint
			};

			upsertMetaEntry(meta, entry);
			existingQueries.set(key, entry);

			console.log(`  Saved ${result.count} rows to ${filepath}`);

			if (result.count < options.limit) {
				break;
			}

			await sleep(REQUEST_DELAY_MS);
		}
	}

	const normalizedHomes = loadAllRapidApiForSaleRawListings(RAW_DIR);
	writeNormalizedHomes(normalizedHomes);
	meta.lastNormalizedAt = new Date().toISOString();
	meta.dedupedHomes = normalizedHomes.length;
	saveMeta(meta);

	console.log(`\nWrote ${normalizedHomes.length} deduped homes to ${OUTPUT_PATH}`);
}

main().catch((error) => {
	console.error('Fatal error:', error);
	process.exit(1);
});
