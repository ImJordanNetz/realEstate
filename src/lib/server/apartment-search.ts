import { z } from 'zod';
import type { ApartmentPreferences } from '$lib/server/apartment-preferences';
import type { ApartmentInventoryListing } from '$lib/server/apartment-inventory';
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
	proximity_minutes: z.record(z.string(), z.number().nonnegative().nullable())
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
	ranking?: ApartmentRankingOptions;
	departureTime?: string;
};

type RouteSummary = {
	minutesByOriginId: Record<string, number | null>;
	bestPlaceByOriginId: Record<string, PlaceCandidate | null>;
};

const EARTH_RADIUS_METERS = 6_371_000;

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
		proximity_minutes: derivedMetrics.proximity_minutes
	};
}

async function computeBestRouteSummary(params: {
	listings: ApartmentInventoryListing[];
	places: PlaceCandidate[];
	travelMode: TravelMode;
	routes: RouteMatrixProvider;
	departureTime?: string;
}): Promise<RouteSummary> {
	const originIds = params.listings.map((listing) => listing.id);

	if (!params.places.length) {
		return summarizeRoutes([], [], originIds);
	}

	const cells = await params.routes.computeRouteMatrix({
		origins: toRouteOrigins(params.listings),
		destinations: params.places.map((place) => ({
			id: place.id,
			location: place.location
		})),
		travelMode: params.travelMode,
		departureTime: params.departureTime
	});

	return summarizeRoutes(params.places, cells, originIds);
}

export async function searchApartments(params: {
	preferences: ApartmentPreferences;
	listings: ApartmentInventoryListing[];
	providers: ApartmentSearchProviders;
	options?: ApartmentSearchOptions;
}): Promise<ApartmentSearchResult> {
	const { preferences, listings, providers } = params;
	const options = params.options ?? {};
	const searchRegion = buildSearchRegion(listings, options.regionPaddingMeters);
	const placeResultLimit = options.maxPlaceResults ?? 8;
	const commuteResultLimit = options.commutePlaceResults ?? 1;
	const derivedMetricsByListingId = new Map<string, ApartmentDerivedMetrics>();
	const matchedConstraintPlacesByListingId = new Map<string, Record<string, PlaceCandidate | null>>();
	const originIds = listings.map((listing) => listing.id);

	for (const listing of listings) {
		derivedMetricsByListingId.set(
			listing.id,
			apartmentDerivedMetricsSchema.parse({
				commute_minutes: null,
				proximity_minutes: {}
			})
		);
		matchedConstraintPlacesByListingId.set(listing.id, {});
	}

	let commutePlaceByListingId: Record<string, PlaceCandidate | null> = {};

	if (preferences.commute) {
		const commutePlaces = await providers.places.search({
			query: preferences.commute.search_query,
			searchType: 'specific',
			region: searchRegion,
			maxResults: commuteResultLimit
		});
		const routeSummary = await computeBestRouteSummary({
			listings,
			places: commutePlaces,
			travelMode: preferences.commute.travel_mode,
			routes: providers.routes,
			departureTime: options.departureTime
		});

		commutePlaceByListingId = routeSummary.bestPlaceByOriginId;

		for (const listingId of originIds) {
			const metrics = derivedMetricsByListingId.get(listingId);

			if (metrics) {
				metrics.commute_minutes = routeSummary.minutesByOriginId[listingId] ?? null;
			}
		}
	}

	await Promise.all(
		preferences.constraints.map(async (constraint) => {
			const places = await providers.places.search({
				query: constraint.search_query,
				searchType: constraint.search_type,
				region: searchRegion,
				maxResults: placeResultLimit
			});
			const routeSummary = await computeBestRouteSummary({
				listings,
				places,
				travelMode: constraint.travel_mode,
				routes: providers.routes,
				departureTime: options.departureTime
			});
			const constraintKey = buildApartmentConstraintKey(constraint);

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
		})
	);

	const ranked = rankApartments(
		preferences,
		listings.map((listing) =>
			toRankingListing(listing, derivedMetricsByListingId.get(listing.id)!)
		),
		options.ranking
	);

	return {
		mode: ranked.mode,
		search_region: searchRegion,
		ranked: ranked.ranked.map((item) => {
			const listing = listings.find((candidate) => candidate.id === item.listing.id);
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
