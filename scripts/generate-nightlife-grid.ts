import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import {
	buildSearchRegion,
	type PlaceCandidate,
	type PlaceSearchProvider,
	type PlaceSearchRequest
} from '../src/lib/server/apartment-search';
import { loadAllRentcastListings } from '../src/lib/server/apartment-inventory';
import { join } from 'node:path';
import {
	buildNightlifeGrid,
	createNightlifeGridArtifact
} from '../src/lib/server/nightlife-grid';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

if (!GOOGLE_API_KEY) {
	console.error('Missing GOOGLE_API_KEY in .env');
	process.exit(1);
}

const OUTPUT_PATH = join(process.cwd(), 'src/lib/server/data/irvine-nightlife-grid-500m.json');
const REGION_PADDING_METERS = Number(process.env.NIGHTLIFE_GRID_PADDING_METERS ?? 2_000);
const CELL_SIZE_METERS = Number(process.env.NIGHTLIFE_GRID_CELL_SIZE_METERS ?? 500);
const GOOGLE_PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const FIELD_MASK =
	'places.id,places.displayName,places.formattedAddress,places.location,places.types';

function normalizeQuery(query: string) {
	return query.trim().replace(/\s+/g, ' ');
}

function constraintQueryToIncludedType(query: string) {
	switch (normalizeQuery(query).toLowerCase()) {
		case 'bar':
		case 'bars':
		case 'cocktail bar':
		case 'cocktail bars':
		case 'pub':
		case 'pubs':
		case 'lounge':
		case 'lounges':
			return 'bar';
		case 'night club':
		case 'night clubs':
		case 'nightclub':
		case 'nightclubs':
			return 'night_club';
		case 'brewery':
		case 'breweries':
			return 'brewery';
		default:
			return null;
	}
}

function buildPlacesSearchBody(input: PlaceSearchRequest) {
	const pageSize = Math.min(Math.max(input.maxResults, 1), 20);
	const normalizedQuery = normalizeQuery(input.query);
	const includedType =
		input.searchType === 'category' ? constraintQueryToIncludedType(normalizedQuery) : null;

	return {
		textQuery: normalizedQuery,
		pageSize,
		languageCode: 'en',
		regionCode: 'US',
		...(includedType
			? {
					includedType,
					strictTypeFiltering: true,
					locationRestriction: {
						rectangle: {
							low: {
								latitude: input.region.bounds.south,
								longitude: input.region.bounds.west
							},
							high: {
								latitude: input.region.bounds.north,
								longitude: input.region.bounds.east
							}
						}
					}
				}
			: {
					locationBias: {
						circle: {
							center: {
								latitude: input.region.center.lat,
								longitude: input.region.center.lng
							},
							radius: Math.min(Math.max(input.region.radius_meters, 1), 50_000)
						}
					}
				})
	};
}

function createScriptPlacesProvider(): PlaceSearchProvider {
	return {
		async search(input: PlaceSearchRequest): Promise<PlaceCandidate[]> {
			const response = await fetch(GOOGLE_PLACES_TEXT_SEARCH_URL, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'X-Goog-Api-Key': GOOGLE_API_KEY!,
					'X-Goog-FieldMask': FIELD_MASK
				},
				body: JSON.stringify(buildPlacesSearchBody(input))
			});

			if (!response.ok) {
				throw new Error(
					`Google Places text search failed (${response.status}): ${await response.text()}`
				);
			}

			const payload = (await response.json()) as {
				places?: Array<{
					id?: string;
					displayName?: { text?: string };
					formattedAddress?: string;
					location?: { latitude?: number; longitude?: number };
					types?: string[];
				}>;
			};

			return (payload.places ?? [])
				.filter((place) => place.id && place.location?.latitude != null && place.location?.longitude != null)
				.map(
					(place): PlaceCandidate => ({
						id: place.id!,
						name: place.displayName?.text ?? 'Unknown place',
						location: {
							lat: place.location!.latitude!,
							lng: place.location!.longitude!
						},
						address: place.formattedAddress ?? null,
						types: place.types ?? []
					})
				);
		}
	};
}

async function main() {
	const listings = loadAllRentcastListings();
	const region = buildSearchRegion(listings, REGION_PADDING_METERS);
	const grid = await buildNightlifeGrid({
		region,
		places: createScriptPlacesProvider(),
		options: {
			cellSizeMeters: CELL_SIZE_METERS
		}
	});
	const artifact = createNightlifeGridArtifact({
		sourceRegion: region,
		grid
	});

	writeFileSync(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);

	console.log(
		JSON.stringify(
			{
				outputPath: OUTPUT_PATH,
				listings: listings.length,
				cellSizeMeters: grid.cell_size_meters,
				rows: grid.rows,
				columns: grid.columns,
				cells: grid.cells.length,
				venueCount: grid.venue_count,
				maxIntensity: grid.max_intensity
			},
			null,
			2
		)
	);
}

main().catch((error) => {
	console.error('Failed to generate nightlife grid.', error);
	process.exit(1);
});
