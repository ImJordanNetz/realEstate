import { z } from 'zod';
import type { ApartmentPreferences } from '$lib/server/apartment-preferences';
import type { ApartmentInventoryListing } from '$lib/server/apartment-inventory';
import {
	loadDefaultNightlifeGrid,
	lookupNightlifeIntensity,
	type NightlifeGrid
} from '$lib/server/nightlife-grid';
import {
	buildApartmentConstraintKey,
	rankApartments,
	type ApartmentRankingOptions,
	type ApartmentListingCandidate,
	type RankingCriterionResult
} from '$lib/server/apartment-ranking';

type TravelMode = NonNullable<ApartmentPreferences['commute']>['travel_mode'];
type SearchType = ApartmentPreferences['constraints'][number]['search_type'];

export const geoPointSchema = z.object({
	lat: z.number(),
	lng: z.number()
});

export const searchRegionSchema = z.object({
	center: geoPointSchema,
	radius_meters: z.number().positive(),
	bounds: z.object({
		south: z.number(),
		west: z.number(),
		north: z.number(),
		east: z.number()
	})
});

export const placeCandidateSchema = z.object({
	id: z.string(),
	name: z.string(),
	location: geoPointSchema,
	address: z.string().nullable(),
	types: z.array(z.string())
});

export const routeMatrixCellSchema = z.object({
	origin_id: z.string(),
	destination_id: z.string(),
	minutes: z.number().nonnegative().nullable()
});

export const apartmentDerivedMetricsSchema = z.object({
	commute_minutes: z.number().nonnegative().nullable(),
	proximity_minutes: z.record(z.string(), z.number().nonnegative().nullable()),
	nightlife_intensity: z.number().min(0).max(100).nullable(),
	nightlife_cell_id: z.string().nullable()
});

export type GeoPoint = z.infer<typeof geoPointSchema>;
export type SearchRegion = z.infer<typeof searchRegionSchema>;
export type PlaceCandidate = z.infer<typeof placeCandidateSchema>;
export type RouteMatrixCell = z.infer<typeof routeMatrixCellSchema>;
export type ApartmentDerivedMetrics = z.infer<typeof apartmentDerivedMetricsSchema>;

export type PlaceSearchRequest = {
	query: string;
	searchType: SearchType | 'specific';
	region: SearchRegion;
	maxResults: number;
};

export type RouteMatrixRequest = {
	origins: Array<{
		id: string;
		location: GeoPoint;
	}>;
	destinations: Array<{
		id: string;
		location: GeoPoint;
	}>;
	travelMode: TravelMode;
	departureTime?: string;
};

export type PlaceSearchProvider = {
	search(input: PlaceSearchRequest): Promise<PlaceCandidate[]>;
};

export type RouteMatrixProvider = {
	computeRouteMatrix(input: RouteMatrixRequest): Promise<RouteMatrixCell[]>;
};

export type ApartmentSearchProviders = {
	places: PlaceSearchProvider;
	routes: RouteMatrixProvider;
};

export type SearchLogger = (
	scope: string,
	step: string,
	details?: Record<string, unknown>
) => void;

export type RankedApartmentSearchHit = {
	listing: ApartmentInventoryListing;
	derived_metrics: ApartmentDerivedMetrics;
	matched_places: {
		commute: PlaceCandidate | null;
		constraints: Record<string, PlaceCandidate | null>;
	};
	total_score: number;
	soft_score: number;
	required_score: number;
	required_coverage: number;
	passes_required: boolean;
	required_pass_count: number;
	required_total: number;
	failed_required: RankingCriterionResult[];
	criteria: RankingCriterionResult[];
};

export type ApartmentSearchResult = {
	mode: 'strict' | 'fallback';
	search_region: SearchRegion;
	ranked: RankedApartmentSearchHit[];
};

export type ApartmentSearchOptions = {
	maxPlaceResults?: number;
	commutePlaceResults?: number;
	regionPaddingMeters?: number;
	shortlistCount?: number;
	ranking?: ApartmentRankingOptions;
	departureTime?: string;
	nightlifeGrid?: NightlifeGrid | null;
};

type RouteSummary = {
	minutesByOriginId: Record<string, number | null>;
	bestPlaceByOriginId: Record<string, PlaceCandidate | null>;
};

const EARTH_RADIUS_METERS = 6_371_000;
const DEFAULT_SHORTLIST_COUNT = 48;

function toRadians(value: number) {
	return (value * Math.PI) / 180;
}

function haversineDistanceMeters(a: GeoPoint, b: GeoPoint) {
	const dLat = toRadians(b.lat - a.lat);
	const dLng = toRadians(b.lng - a.lng);
	const lat1 = toRadians(a.lat);
	const lat2 = toRadians(b.lat);
	const sinLat = Math.sin(dLat / 2);
	const sinLng = Math.sin(dLng / 2);
	const h =
		sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;

	return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

function estimateTravelMinutes(distanceMeters: number, travelMode: TravelMode) {
	const distanceKilometers = distanceMeters / 1000;

	switch (travelMode) {
		case 'walk':
			return (distanceKilometers / 4.8) * 60 * 1.25;
		case 'bike':
			return (distanceKilometers / 15) * 60 * 1.2;
		case 'drive':
			return (distanceKilometers / 32) * 60 * 1.45 + 3;
		case 'transit':
			return (distanceKilometers / 20) * 60 * 1.6 + 8;
	}
}

export function buildSearchRegion(
	listings: ApartmentInventoryListing[],
	paddingMeters = 2_000
): SearchRegion {
	if (!listings.length) {
		return searchRegionSchema.parse({
			center: { lat: 33.6846, lng: -117.8265 },
			radius_meters: paddingMeters,
			bounds: {
				south: 33.6846,
				west: -117.8265,
				north: 33.6846,
				east: -117.8265
			}
		});
	}

	let south = listings[0].location.lat;
	let north = listings[0].location.lat;
	let west = listings[0].location.lng;
	let east = listings[0].location.lng;

	for (const listing of listings) {
		south = Math.min(south, listing.location.lat);
		north = Math.max(north, listing.location.lat);
		west = Math.min(west, listing.location.lng);
		east = Math.max(east, listing.location.lng);
	}

	const center = {
		lat: (south + north) / 2,
		lng: (west + east) / 2
	};

	let radiusMeters = paddingMeters;

	for (const listing of listings) {
		radiusMeters = Math.max(
			radiusMeters,
			haversineDistanceMeters(center, listing.location) + paddingMeters
		);
	}

	return searchRegionSchema.parse({
		center,
		radius_meters: radiusMeters,
		bounds: { south, west, north, east }
	});
}

function toRouteOrigins(listings: ApartmentInventoryListing[]) {
	return listings.map((listing) => ({
		id: listing.id,
		location: listing.location
	}));
}

function createDerivedMetricsStore(listings: ApartmentInventoryListing[]) {
	const metricsByListingId = new Map<string, ApartmentDerivedMetrics>();

	for (const listing of listings) {
		metricsByListingId.set(
			listing.id,
			apartmentDerivedMetricsSchema.parse({
				commute_minutes: null,
				proximity_minutes: {},
				nightlife_intensity: null,
				nightlife_cell_id: null
			})
		);
	}

	return metricsByListingId;
}

function createMatchedConstraintPlacesStore(listings: ApartmentInventoryListing[]) {
	const matchedPlacesByListingId = new Map<string, Record<string, PlaceCandidate | null>>();

	for (const listing of listings) {
		matchedPlacesByListingId.set(listing.id, {});
	}

	return matchedPlacesByListingId;
}

function summarizeRoutes(
	places: PlaceCandidate[],
	cells: RouteMatrixCell[],
	originIds: string[]
): RouteSummary {
	const bestPlaceByOriginId: Record<string, PlaceCandidate | null> = {};
	const minutesByOriginId: Record<string, number | null> = {};
	const placeById = new Map(places.map((place) => [place.id, place]));

	for (const originId of originIds) {
		bestPlaceByOriginId[originId] = null;
		minutesByOriginId[originId] = null;
	}

	for (const cell of cells) {
		if (!(cell.origin_id in minutesByOriginId) || cell.minutes == null) {
			continue;
		}

		const current = minutesByOriginId[cell.origin_id];

		if (current == null || cell.minutes < current) {
			minutesByOriginId[cell.origin_id] = cell.minutes;
			bestPlaceByOriginId[cell.origin_id] = placeById.get(cell.destination_id) ?? null;
		}
	}

	return { bestPlaceByOriginId, minutesByOriginId };
}

function toRankingListing(
	listing: ApartmentInventoryListing,
	derivedMetrics: ApartmentDerivedMetrics
): ApartmentListingCandidate {
	return {
		id: listing.id,
		title: listing.title,
		rent: listing.rent,
		bedrooms: listing.bedrooms,
		bathrooms: listing.bathrooms,
		sqft: listing.sqft,
		lease_length_months: listing.lease_length_months,
		furnished: listing.furnished,
		parking: listing.parking,
		laundry: listing.laundry,
		pets: listing.pets,
		amenities: listing.amenities,
		commute_minutes: derivedMetrics.commute_minutes,
		proximity_minutes: derivedMetrics.proximity_minutes,
		nightlife_intensity: derivedMetrics.nightlife_intensity
	};
}

function applyNightlifeMetrics(params: {
	listings: ApartmentInventoryListing[];
	metricsByListingId: Map<string, ApartmentDerivedMetrics>;
	grid: NightlifeGrid;
}) {
	for (const listing of params.listings) {
		const metrics = params.metricsByListingId.get(listing.id);

		if (!metrics) {
			continue;
		}

		const nightlife = lookupNightlifeIntensity(params.grid, listing.location);
		metrics.nightlife_intensity = nightlife.intensity;
		metrics.nightlife_cell_id = nightlife.cellId;
	}
}

function estimateBestMinutesForPlaces(
	listing: ApartmentInventoryListing,
	places: PlaceCandidate[],
	travelMode: TravelMode
) {
	if (!places.length) {
		return null;
	}

	let bestMinutes = Number.POSITIVE_INFINITY;

	for (const place of places) {
		const distanceMeters = haversineDistanceMeters(listing.location, place.location);
		const estimatedMinutes = estimateTravelMinutes(distanceMeters, travelMode);

		if (estimatedMinutes < bestMinutes) {
			bestMinutes = estimatedMinutes;
		}
	}

	return Number.isFinite(bestMinutes) ? Number(bestMinutes.toFixed(1)) : null;
}

function selectShortlistedListings(params: {
	preferences: ApartmentPreferences;
	listings: ApartmentInventoryListing[];
	commutePlaces: PlaceCandidate[];
	constraintPlacesByKey: Map<string, PlaceCandidate[]>;
	nightlifeGrid: NightlifeGrid | null;
	options: ApartmentSearchOptions;
}) {
	const approximateMetricsByListingId = createDerivedMetricsStore(params.listings);

	if (params.nightlifeGrid) {
		applyNightlifeMetrics({
			listings: params.listings,
			metricsByListingId: approximateMetricsByListingId,
			grid: params.nightlifeGrid
		});
	}

	for (const listing of params.listings) {
		const metrics = approximateMetricsByListingId.get(listing.id);

		if (!metrics) {
			continue;
		}

		if (params.preferences.commute) {
			metrics.commute_minutes = estimateBestMinutesForPlaces(
				listing,
				params.commutePlaces,
				params.preferences.commute.travel_mode
			);
		}

		for (const constraint of params.preferences.constraints) {
			const constraintKey = buildApartmentConstraintKey(constraint);
			metrics.proximity_minutes[constraintKey] = estimateBestMinutesForPlaces(
				listing,
				params.constraintPlacesByKey.get(constraintKey) ?? [],
				constraint.travel_mode
			);
		}
	}

	const approximateRanking = rankApartments(
		params.preferences,
		params.listings.map((listing) =>
			toRankingListing(listing, approximateMetricsByListingId.get(listing.id)!)
		),
		params.options.ranking
	);
	const shortlistCount = Math.min(
		params.options.shortlistCount ?? DEFAULT_SHORTLIST_COUNT,
		params.listings.length
	);
	const shortlistedIds = new Set(
		approximateRanking.ranked.slice(0, shortlistCount).map((item) => item.listing.id)
	);

	return params.listings.filter((listing) => shortlistedIds.has(listing.id));
}

async function computeBestRouteSummary(params: {
	listings: ApartmentInventoryListing[];
	places: PlaceCandidate[];
	travelMode: TravelMode;
	routes: RouteMatrixProvider;
	departureTime?: string;
	logger?: SearchLogger;
	label?: string;
}): Promise<RouteSummary> {
	const originIds = params.listings.map((listing) => listing.id);
	const log = params.logger ?? (() => {});

	if (!params.places.length) {
		log('search', 'route_summary_skipped', {
			label: params.label ?? 'unknown',
			travelMode: params.travelMode,
			origins: params.listings.length,
			reason: 'no_places'
		});
		return summarizeRoutes([], [], originIds);
	}

	const startedAt = Date.now();
	log('search', 'route_summary_start', {
		label: params.label ?? 'unknown',
		travelMode: params.travelMode,
		origins: params.listings.length,
		destinations: params.places.length,
		elements: params.listings.length * params.places.length
	});

	let cells: RouteMatrixCell[];

	try {
		cells = await params.routes.computeRouteMatrix({
			origins: toRouteOrigins(params.listings),
			destinations: params.places.map((place) => ({
				id: place.id,
				location: place.location
			})),
			travelMode: params.travelMode,
			departureTime: params.departureTime
		});
	} catch (error) {
		log('search', 'route_summary_failed', {
			label: params.label ?? 'unknown',
			travelMode: params.travelMode,
			origins: params.listings.length,
			destinations: params.places.length,
			durationMs: Date.now() - startedAt,
			message: error instanceof Error ? error.message : 'Failed to compute route summary.'
		});
		throw error;
	}

	log('search', 'route_summary_complete', {
		label: params.label ?? 'unknown',
		travelMode: params.travelMode,
		origins: params.listings.length,
		destinations: params.places.length,
		cells: cells.length,
		resolvedCells: cells.filter((cell) => cell.minutes != null).length,
		durationMs: Date.now() - startedAt
	});

	return summarizeRoutes(params.places, cells, originIds);
}

export async function searchApartments(params: {
	preferences: ApartmentPreferences;
	listings: ApartmentInventoryListing[];
	providers: ApartmentSearchProviders;
	options?: ApartmentSearchOptions;
	logger?: SearchLogger;
}): Promise<ApartmentSearchResult> {
	const { preferences, listings, providers } = params;
	const options = params.options ?? {};
	const log = params.logger ?? (() => {});
	const startedAt = Date.now();
	const searchRegion = buildSearchRegion(listings, options.regionPaddingMeters);
	const placeResultLimit = options.maxPlaceResults ?? 8;
	const commuteResultLimit = options.commutePlaceResults ?? 1;
	const constraintPlacesByKey = new Map<string, PlaceCandidate[]>();

	log('search', 'start', {
		totalListings: listings.length,
		hasCommute: !!preferences.commute,
		constraints: preferences.constraints.length,
		maxPlaceResults: placeResultLimit,
		commutePlaceResults: commuteResultLimit,
		shortlistCount: options.shortlistCount ?? DEFAULT_SHORTLIST_COUNT
	});
	log('search', 'region_built', {
		centerLat: Number(searchRegion.center.lat.toFixed(5)),
		centerLng: Number(searchRegion.center.lng.toFixed(5)),
		radiusMeters: Math.round(searchRegion.radius_meters)
	});

	let commutePlaces: PlaceCandidate[] = [];

	if (preferences.commute) {
		commutePlaces = await providers.places.search({
			query: preferences.commute.search_query,
			searchType: 'specific',
			region: searchRegion,
			maxResults: commuteResultLimit
		});
		log('search', 'commute_places_ready', {
			query: preferences.commute.search_query,
			travelMode: preferences.commute.travel_mode,
			places: commutePlaces.length
		});
	}

	await Promise.all(
		preferences.constraints.map(async (constraint) => {
			const constraintKey = buildApartmentConstraintKey(constraint);
			const places = await providers.places.search({
				query: constraint.search_query,
				searchType: constraint.search_type,
				region: searchRegion,
				maxResults: placeResultLimit
			});
			constraintPlacesByKey.set(constraintKey, places);
			log('search', 'constraint_places_ready', {
				label: constraint.label,
				query: constraint.search_query,
				travelMode: constraint.travel_mode,
				places: places.length
			});
		})
	);

	let nightlifeGrid: NightlifeGrid | null = null;

	if (preferences.nightlife) {
		if (options.nightlifeGrid !== undefined) {
			nightlifeGrid = options.nightlifeGrid;
		} else {
			try {
				nightlifeGrid = loadDefaultNightlifeGrid();
			} catch (error) {
				const message =
					error instanceof Error ? error.message : 'Unable to load the nightlife grid artifact.';

				throw new Error(
					`Nightlife ranking requires a precomputed grid artifact. Run "npm run nightlife:grid" first. ${message}`
				);
			}
		}
	}

	const shortlistedListings = selectShortlistedListings({
		preferences,
		listings,
		commutePlaces,
		constraintPlacesByKey,
		nightlifeGrid,
		options
	});
	log('search', 'shortlist_selected', {
		from: listings.length,
		to: shortlistedListings.length,
		sampleListingIds: shortlistedListings.slice(0, 5).map((listing) => listing.id)
	});
	const derivedMetricsByListingId = createDerivedMetricsStore(shortlistedListings);
	const matchedConstraintPlacesByListingId =
		createMatchedConstraintPlacesStore(shortlistedListings);
	const originIds = shortlistedListings.map((listing) => listing.id);
	let commutePlaceByListingId: Record<string, PlaceCandidate | null> = {};

	if (nightlifeGrid) {
		applyNightlifeMetrics({
			listings: shortlistedListings,
			metricsByListingId: derivedMetricsByListingId,
			grid: nightlifeGrid
		});
	}

	if (preferences.commute) {
		const routeSummary = await computeBestRouteSummary({
			listings: shortlistedListings,
			places: commutePlaces,
			travelMode: preferences.commute.travel_mode,
			routes: providers.routes,
			departureTime: options.departureTime,
			logger: log,
			label: 'commute'
		});

		commutePlaceByListingId = routeSummary.bestPlaceByOriginId;

		for (const listingId of originIds) {
			const metrics = derivedMetricsByListingId.get(listingId);

			if (metrics) {
				metrics.commute_minutes = routeSummary.minutesByOriginId[listingId] ?? null;
			}
		}
	}

	for (const constraint of preferences.constraints) {
		const constraintKey = buildApartmentConstraintKey(constraint);
		const routeSummary = await computeBestRouteSummary({
			listings: shortlistedListings,
			places: constraintPlacesByKey.get(constraintKey) ?? [],
			travelMode: constraint.travel_mode,
			routes: providers.routes,
			departureTime: options.departureTime,
			logger: log,
			label: constraint.label
		});

		for (const listingId of originIds) {
			const metrics = derivedMetricsByListingId.get(listingId);
			const placeMap = matchedConstraintPlacesByListingId.get(listingId);

			if (metrics) {
				metrics.proximity_minutes[constraintKey] =
					routeSummary.minutesByOriginId[listingId] ?? null;
			}

			if (placeMap) {
				placeMap[constraintKey] = routeSummary.bestPlaceByOriginId[listingId] ?? null;
			}
		}
	}

	const ranked = rankApartments(
		preferences,
		shortlistedListings.map((listing) =>
			toRankingListing(listing, derivedMetricsByListingId.get(listing.id)!)
		),
		options.ranking
	);
	log('search', 'ranking_complete', {
		mode: ranked.mode,
		results: ranked.ranked.length,
		topListingIds: ranked.ranked.slice(0, 5).map((item) => item.listing.id),
		durationMs: Date.now() - startedAt
	});

	return {
		mode: ranked.mode,
		search_region: searchRegion,
		ranked: ranked.ranked.map((item) => {
			const listing = shortlistedListings.find((candidate) => candidate.id === item.listing.id);
			const derivedMetrics = derivedMetricsByListingId.get(item.listing.id);

			if (!listing || !derivedMetrics) {
				throw new Error(`Missing inventory or derived metrics for listing ${item.listing.id}.`);
			}

			return {
				listing,
				derived_metrics: derivedMetrics,
				matched_places: {
					commute: commutePlaceByListingId[item.listing.id] ?? null,
					constraints: matchedConstraintPlacesByListingId.get(item.listing.id) ?? {}
				},
				total_score: item.total_score,
				soft_score: item.soft_score,
				required_score: item.required_score,
				required_coverage: item.required_coverage,
				passes_required: item.passes_required,
				required_pass_count: item.required_pass_count,
				required_total: item.required_total,
				failed_required: item.failed_required,
				criteria: item.criteria
			};
		})
	};
}
