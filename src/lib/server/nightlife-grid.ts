import { z } from 'zod';
import nightlifeGridData from '$lib/server/data/irvine-nightlife-grid-500m.json';
import type {
	GeoPoint,
	PlaceCandidate,
	PlaceSearchProvider,
	SearchLogger,
	SearchRegion
} from '$lib/server/apartment-search';

export type NightlifeGridCell = {
	id: string;
	center: GeoPoint;
	bounds: SearchRegion['bounds'];
	intensity: number;
};

export type NightlifeGrid = {
	cell_size_meters: number;
	rows: number;
	columns: number;
	bounds: SearchRegion['bounds'];
	latitude_step_degrees: number;
	longitude_step_degrees: number;
	venue_count: number;
	max_intensity: number;
	cells: NightlifeGridCell[];
};

export type NightlifeGridArtifact = {
	version: 1;
	generated_at: string;
	source_region: SearchRegion;
	grid: NightlifeGrid;
};

type NightlifeVenue = {
	place: PlaceCandidate;
	weight: number;
};

type NightlifeGridOptions = {
	cellSizeMeters?: number;
	logger?: SearchLogger;
};

const DEFAULT_CACHE_TTL_MS = 1000 * 60 * 60 * 12;
export const DEFAULT_NIGHTLIFE_CELL_SIZE_METERS = 500;
const NIGHTLIFE_INFLUENCE_RADIUS_METERS = 2_000;
const NIGHTLIFE_DISTANCE_DECAY_METERS = 650;
const NIGHTLIFE_INTENSITY_SCALE = 2.25;
const NIGHTLIFE_SEARCHES = [
	{ query: 'bar', weight: 1 },
	{ query: 'cocktail bar', weight: 1.1 },
	{ query: 'night club', weight: 1.25 },
	{ query: 'brewery', weight: 0.8 },
	{ query: 'live music venue', weight: 1.05 },
	{ query: 'pub', weight: 0.95 }
] as const;
const gridCache = new Map<string, { expiresAt: number; promise: Promise<NightlifeGrid> }>();

const geoPointSchema = z.object({
	lat: z.number(),
	lng: z.number()
});

const searchRegionSchema = z.object({
	center: geoPointSchema,
	radius_meters: z.number().positive(),
	bounds: z.object({
		south: z.number(),
		west: z.number(),
		north: z.number(),
		east: z.number()
	})
});

const nightlifeGridCellSchema = z.object({
	id: z.string(),
	center: geoPointSchema,
	bounds: z.object({
		south: z.number(),
		west: z.number(),
		north: z.number(),
		east: z.number()
	}),
	intensity: z.number().min(0).max(100)
});

const nightlifeGridSchema = z.object({
	cell_size_meters: z.number().positive(),
	rows: z.number().int().positive(),
	columns: z.number().int().positive(),
	bounds: z.object({
		south: z.number(),
		west: z.number(),
		north: z.number(),
		east: z.number()
	}),
	latitude_step_degrees: z.number().positive(),
	longitude_step_degrees: z.number().positive(),
	venue_count: z.number().int().nonnegative(),
	max_intensity: z.number().min(0).max(100),
	cells: z.array(nightlifeGridCellSchema)
});

export const nightlifeGridArtifactSchema = z.object({
	version: z.literal(1),
	generated_at: z.string(),
	source_region: searchRegionSchema,
	grid: nightlifeGridSchema
});

function toRadians(value: number) {
	return (value * Math.PI) / 180;
}

function haversineDistanceMeters(a: GeoPoint, b: GeoPoint) {
	const earthRadiusMeters = 6_371_000;
	const dLat = toRadians(b.lat - a.lat);
	const dLng = toRadians(b.lng - a.lng);
	const lat1 = toRadians(a.lat);
	const lat2 = toRadians(b.lat);
	const sinLat = Math.sin(dLat / 2);
	const sinLng = Math.sin(dLng / 2);
	const h =
		sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;

	return 2 * earthRadiusMeters * Math.asin(Math.sqrt(h));
}

function roundCoordinate(value: number, digits = 4) {
	return Number(value.toFixed(digits));
}

function metersToLatitudeDegrees(meters: number) {
	return meters / 111_320;
}

function metersToLongitudeDegrees(meters: number, atLatitude: number) {
	const metersPerDegree = 111_320 * Math.cos(toRadians(atLatitude));
	return meters / Math.max(1e-6, metersPerDegree);
}

function buildNightlifeGridCacheKey(region: SearchRegion, cellSizeMeters: number) {
	return JSON.stringify({
		cellSizeMeters,
		center: {
			lat: roundCoordinate(region.center.lat),
			lng: roundCoordinate(region.center.lng)
		},
		bounds: {
			south: roundCoordinate(region.bounds.south),
			west: roundCoordinate(region.bounds.west),
			north: roundCoordinate(region.bounds.north),
			east: roundCoordinate(region.bounds.east)
		}
	});
}

async function fetchNightlifeVenues(params: {
	region: SearchRegion;
	places: PlaceSearchProvider;
	logger?: SearchLogger;
}): Promise<NightlifeVenue[]> {
	const log = params.logger ?? (() => {});
	const startedAt = Date.now();

	log('nightlife', 'venue_sweep_start', {
		queries: NIGHTLIFE_SEARCHES.length
	});

	const responses = await Promise.all(
		NIGHTLIFE_SEARCHES.map(async (search) => ({
			search,
			places: await params.places.search({
				query: search.query,
				searchType: 'category',
				region: params.region,
				maxResults: 20
			})
		}))
	);

	const venuesByPlaceId = new Map<string, NightlifeVenue>();

	for (const response of responses) {
		for (const place of response.places) {
			const existing = venuesByPlaceId.get(place.id);

			if (!existing) {
				venuesByPlaceId.set(place.id, {
					place,
					weight: response.search.weight
				});
				continue;
			}

			existing.weight = Math.max(existing.weight, response.search.weight);
		}
	}

	log('nightlife', 'venue_sweep_complete', {
		queries: NIGHTLIFE_SEARCHES.length,
		uniqueVenues: venuesByPlaceId.size,
		durationMs: Date.now() - startedAt
	});

	return Array.from(venuesByPlaceId.values());
}

function computeNightlifeIntensity(venues: NightlifeVenue[], center: GeoPoint) {
	let rawIntensity = 0;

	for (const venue of venues) {
		const distanceMeters = haversineDistanceMeters(center, venue.place.location);

		if (distanceMeters > NIGHTLIFE_INFLUENCE_RADIUS_METERS) {
			continue;
		}

		rawIntensity += venue.weight * Math.exp(-distanceMeters / NIGHTLIFE_DISTANCE_DECAY_METERS);
	}

	return Number(
		(100 * (1 - Math.exp(-rawIntensity / NIGHTLIFE_INTENSITY_SCALE))).toFixed(1)
	);
}

function createNightlifeGrid(region: SearchRegion, cellSizeMeters: number, venues: NightlifeVenue[]) {
	const latitudeStepDegrees = metersToLatitudeDegrees(cellSizeMeters);
	const longitudeStepDegrees = metersToLongitudeDegrees(cellSizeMeters, region.center.lat);
	const latitudeSpan = Math.max(region.bounds.north - region.bounds.south, latitudeStepDegrees);
	const longitudeSpan = Math.max(region.bounds.east - region.bounds.west, longitudeStepDegrees);
	const rows = Math.max(1, Math.ceil(latitudeSpan / latitudeStepDegrees));
	const columns = Math.max(1, Math.ceil(longitudeSpan / longitudeStepDegrees));
	const cells: NightlifeGridCell[] = [];
	let maxIntensity = 0;

	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const south = region.bounds.south + row * latitudeStepDegrees;
			const north = Math.min(region.bounds.north, south + latitudeStepDegrees);
			const west = region.bounds.west + column * longitudeStepDegrees;
			const east = Math.min(region.bounds.east, west + longitudeStepDegrees);
			const center = {
				lat: south + Math.min(latitudeStepDegrees, region.bounds.north - south) / 2,
				lng: west + Math.min(longitudeStepDegrees, region.bounds.east - west) / 2
			};
			const intensity = computeNightlifeIntensity(venues, center);

			maxIntensity = Math.max(maxIntensity, intensity);
			cells.push({
				id: `r${row}-c${column}`,
				center,
				bounds: {
					south,
					west,
					north,
					east
				},
				intensity
			});
		}
	}

	return {
		cell_size_meters: cellSizeMeters,
		rows,
		columns,
		bounds: region.bounds,
		latitude_step_degrees: latitudeStepDegrees,
		longitude_step_degrees: longitudeStepDegrees,
		venue_count: venues.length,
		max_intensity: Number(maxIntensity.toFixed(1)),
		cells
	} satisfies NightlifeGrid;
}

export async function buildNightlifeGrid(params: {
	region: SearchRegion;
	places: PlaceSearchProvider;
	options?: NightlifeGridOptions;
}): Promise<NightlifeGrid> {
	const cellSizeMeters = params.options?.cellSizeMeters ?? DEFAULT_NIGHTLIFE_CELL_SIZE_METERS;
	const cacheKey = buildNightlifeGridCacheKey(params.region, cellSizeMeters);
	const cached = gridCache.get(cacheKey);

	if (cached && cached.expiresAt > Date.now()) {
		return cached.promise;
	}

	const promise = (async () => {
		const venues = await fetchNightlifeVenues({
			region: params.region,
			places: params.places,
			logger: params.options?.logger
		});
		const grid = createNightlifeGrid(params.region, cellSizeMeters, venues);

		params.options?.logger?.('nightlife', 'grid_ready', {
			rows: grid.rows,
			columns: grid.columns,
			cellSizeMeters: grid.cell_size_meters,
			venueCount: grid.venue_count,
			maxIntensity: grid.max_intensity
		});

		return grid;
	})().catch((error) => {
		gridCache.delete(cacheKey);
		throw error;
	});

	gridCache.set(cacheKey, {
		expiresAt: Date.now() + DEFAULT_CACHE_TTL_MS,
		promise
	});

	return promise;
}

export function createNightlifeGridArtifact(params: {
	sourceRegion: SearchRegion;
	grid: NightlifeGrid;
	generatedAt?: string;
}): NightlifeGridArtifact {
	return nightlifeGridArtifactSchema.parse({
		version: 1,
		generated_at: params.generatedAt ?? new Date().toISOString(),
		source_region: params.sourceRegion,
		grid: params.grid
	});
}

export function loadNightlifeGridArtifact(): NightlifeGridArtifact {
	return nightlifeGridArtifactSchema.parse(nightlifeGridData);
}

export function loadDefaultNightlifeGrid() {
	return loadNightlifeGridArtifact().grid;
}

export function lookupNightlifeIntensity(
	grid: NightlifeGrid,
	location: GeoPoint
): { cellId: string | null; intensity: number | null } {
	if (
		location.lat < grid.bounds.south ||
		location.lat > grid.bounds.north ||
		location.lng < grid.bounds.west ||
		location.lng > grid.bounds.east
	) {
		return {
			cellId: null,
			intensity: null
		};
	}

	const row = Math.min(
		grid.rows - 1,
		Math.max(0, Math.floor((location.lat - grid.bounds.south) / grid.latitude_step_degrees))
	);
	const column = Math.min(
		grid.columns - 1,
		Math.max(
			0,
			Math.floor((location.lng - grid.bounds.west) / grid.longitude_step_degrees)
		)
	);
	const index = row * grid.columns + column;
	const cell = grid.cells[index];

	return {
		cellId: cell?.id ?? null,
		intensity: cell?.intensity ?? null
	};
}
