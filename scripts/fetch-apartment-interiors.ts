import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const API_KEY = process.env.PEXELS_API_KEY?.trim();

if (!API_KEY) {
	console.error('Missing PEXELS_API_KEY in .env');
	process.exit(1);
}

const STATIC_DIR = join(import.meta.dirname, '..', 'static', 'images', 'apartment-interiors');
const DATA_DIR = join(import.meta.dirname, '..', 'src', 'lib', 'server', 'data');
const MANIFEST_PATH = join(DATA_DIR, 'apartment-interiors.json');
const PER_QUERY = 8;

const searches = [
	{ roomType: 'living-room', query: 'apartment living room interior' },
	{ roomType: 'kitchen', query: 'apartment kitchen interior' },
	{ roomType: 'bedroom', query: 'apartment bedroom interior' },
	{ roomType: 'bathroom', query: 'apartment bathroom interior' },
	{ roomType: 'dining', query: 'apartment dining area interior' },
	{ roomType: 'balcony', query: 'apartment balcony interior' }
] as const;

type PexelsPhoto = {
	id: number;
	width: number;
	height: number;
	url: string;
	photographer: string;
	photographer_url: string;
	alt: string;
	src: {
		original: string;
		large2x: string;
		large: string;
		medium: string;
	};
};

type PexelsSearchResponse = {
	photos: PexelsPhoto[];
};

type InteriorPhotoManifestEntry = {
	id: number;
	roomType: string;
	query: string;
	localPath: string;
	width: number;
	height: number;
	alt: string;
	photographer: string;
	photographerUrl: string;
	pexelsUrl: string;
};

function slugify(value: string) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function inferExtension(photoUrl: string, contentType: string | null) {
	if (contentType?.includes('image/jpeg')) return '.jpg';
	if (contentType?.includes('image/png')) return '.png';
	if (contentType?.includes('image/webp')) return '.webp';

	const parsed = new URL(photoUrl);
	const fromPath = extname(parsed.pathname);
	return fromPath || '.jpg';
}

async function searchPhotos(query: string) {
	const url = new URL('https://api.pexels.com/v1/search');
	url.searchParams.set('query', query);
	url.searchParams.set('per_page', String(PER_QUERY));
	url.searchParams.set('orientation', 'landscape');
	url.searchParams.set('size', 'large');

	const response = await fetch(url, {
		headers: {
			Authorization: API_KEY!
		}
	});

	if (!response.ok) {
		throw new Error(`Pexels search failed (${response.status}): ${await response.text()}`);
	}

	const payload = (await response.json()) as PexelsSearchResponse;
	return payload.photos ?? [];
}

async function downloadPhoto(photo: PexelsPhoto, roomType: string, index: number) {
	const downloadUrl = photo.src.large2x || photo.src.large || photo.src.medium || photo.src.original;
	const response = await fetch(downloadUrl);

	if (!response.ok) {
		throw new Error(`Failed to download photo ${photo.id} (${response.status})`);
	}

	const extension = inferExtension(downloadUrl, response.headers.get('content-type'));
	const filename = `${roomType}-${String(index + 1).padStart(2, '0')}-${photo.id}${extension}`;
	const outputPath = join(STATIC_DIR, filename);
	const bytes = Buffer.from(await response.arrayBuffer());

	await writeFile(outputPath, bytes);

	return {
		filename,
		localPath: `/images/apartment-interiors/${filename}`
	};
}

async function main() {
	await mkdir(STATIC_DIR, { recursive: true });
	await mkdir(DATA_DIR, { recursive: true });

	const seen = new Set<number>();
	const manifest: InteriorPhotoManifestEntry[] = [];

	for (const search of searches) {
		console.log(`Searching Pexels for "${search.query}"`);
		const photos = await searchPhotos(search.query);
		let savedCount = 0;

		for (const photo of photos) {
			if (seen.has(photo.id)) {
				continue;
			}

			const saved = await downloadPhoto(photo, search.roomType, savedCount);
			seen.add(photo.id);
			savedCount += 1;

			manifest.push({
				id: photo.id,
				roomType: search.roomType,
				query: search.query,
				localPath: saved.localPath,
				width: photo.width,
				height: photo.height,
				alt: photo.alt?.trim() || `${search.roomType} apartment interior`,
				photographer: photo.photographer,
				photographerUrl: photo.photographer_url,
				pexelsUrl: photo.url
			});

			console.log(`  Saved ${saved.filename}`);
		}
	}

	await writeFile(
		MANIFEST_PATH,
		`${JSON.stringify(
			{
				downloadedAt: new Date().toISOString(),
				total: manifest.length,
				photos: manifest
			},
			null,
			2
		)}\n`
	);

	console.log(`\nDownloaded ${manifest.length} apartment interior photos.`);
	console.log(`Images: ${STATIC_DIR}`);
	console.log(`Manifest: ${MANIFEST_PATH}`);
}

main().catch((error) => {
	console.error('Fatal error:', error);
	process.exit(1);
});
