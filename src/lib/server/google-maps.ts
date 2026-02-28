import { env } from '$env/dynamic/private';
import { z } from 'zod';
import type {
	PlaceCandidate,
	PlaceSearchProvider,
	PlaceSearchRequest,
	RouteMatrixCell,
	RouteMatrixProvider,
	RouteMatrixRequest,
	SearchLogger
} from '$lib/server/apartment-search';

const GOOGLE_PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const GOOGLE_PLACE_DETAILS_URL = 'https://places.googleapis.com/v1/places';
const GOOGLE_ROUTE_MATRIX_URL =
	'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
const PLACE_CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const PHOTO_CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const ROUTE_CACHE_TTL_MS = 1000 * 60 * 30;
const placeCache = new Map<string, { expiresAt: number; value: PlaceCandidate[] }>();
const photoCache = new Map<string, { expiresAt: number; value: GooglePlacePhoto }>();
const routeCache = new Map<string, { expiresAt: number; value: RouteMatrixCell[] }>();

const googlePlaceSearchResponseSchema = z.object({
	places: z
		.array(
			z.object({
				id: z.string(),
				displayName: z
					.object({
						text: z.string()
					})
					.optional(),
				formattedAddress: z.string().optional(),
				location: z
					.object({
						latitude: z.number(),
						longitude: z.number()
					})
					.optional(),
				types: z.array(z.string()).optional()
			})
		)
		.optional()
});

const googleRouteMatrixResponseSchema = z.array(
	z.object({
		originIndex: z.number().int().nonnegative(),
		destinationIndex: z.number().int().nonnegative(),
		duration: z.string().optional(),
		condition: z.string().optional()
	})
);

const googlePlacePhotoDetailsResponseSchema = z.object({
	googleMapsUri: z.string().optional(),
	photos: z
		.array(
			z.object({
				name: z.string(),
				authorAttributions: z
					.array(
						z.object({
							displayName: z.string().optional(),
							uri: z.string().optional()
						})
					)
					.optional()
			})
		)
		.optional()
});

const googlePlacePhotoMediaResponseSchema = z.object({
	photoUri: z.string()
});

export type GooglePlacePhoto = {
	photoUrl: string | null;
	authorName: string | null;
	authorUri: string | null;
	googleMapsUri: string | null;
};

function logGoogleStep(
	logger: SearchLogger | undefined,
	scope: string,
	step: string,
	details?: Record<string, unknown>
) {
	logger?.(scope, step, details);
}

function getGoogleApiKey() {
	const apiKey = env.GOOGLE_API_KEY?.trim();

	if (!apiKey) {
		throw new Error('GOOGLE_API_KEY is not configured.');
	}

	return apiKey;
}

function normalizeQuery(query: string) {
	return query.trim().replace(/\s+/g, ' ');
}

function roundedCoordinate(value: number) {
	return Number(value.toFixed(5));
}

function getCachedValue<T>(cache: Map<string, { expiresAt: number; value: T }>, key: string) {
	const entry = cache.get(key);

	if (!entry) {
		return null;
	}

	if (entry.expiresAt <= Date.now()) {
		cache.delete(key);
		return null;
	}

	return entry.value;
}

function setCachedValue<T>(
	cache: Map<string, { expiresAt: number; value: T }>,
	key: string,
	value: T,
	ttlMs: number
) {
	cache.set(key, {
		expiresAt: Date.now() + ttlMs,
		value
	});
}

function normalizeExternalUri(uri: string | undefined) {
	if (!uri) {
		return null;
	}

	if (uri.startsWith('//')) {
		return `https:${uri}`;
	}

	return uri;
}

function constraintQueryToIncludedType(query: string) {
	switch (normalizeQuery(query).toLowerCase()) {
		case 'park':
		case 'parks':
			return 'park';
		case 'grocery store':
		case 'grocery stores':
			return 'grocery_store';
		case 'gym':
			return 'gym';
		default:
			return null;
	}
}

function buildPlaceSearchCacheKey(input: PlaceSearchRequest) {
	return JSON.stringify({
		query: normalizeQuery(input.query).toLowerCase(),
		searchType: input.searchType,
		maxResults: input.maxResults,
		center: {
			lat: roundedCoordinate(input.region.center.lat),
			lng: roundedCoordinate(input.region.center.lng)
		},
		radiusMeters: Math.round(input.region.radius_meters),
		bounds: {
			south: roundedCoordinate(input.region.bounds.south),
			west: roundedCoordinate(input.region.bounds.west),
			north: roundedCoordinate(input.region.bounds.north),
			east: roundedCoordinate(input.region.bounds.east)
		}
	});
}

function buildRouteCacheKey(input: RouteMatrixRequest) {
	return JSON.stringify({
		travelMode: input.travelMode,
		departureTime: input.departureTime ?? null,
		origins: input.origins.map((origin) => ({
			id: origin.id,
			lat: roundedCoordinate(origin.location.lat),
			lng: roundedCoordinate(origin.location.lng)
		})),
		destinations: input.destinations.map((destination) => ({
			id: destination.id,
			lat: roundedCoordinate(destination.location.lat),
			lng: roundedCoordinate(destination.location.lng)
		}))
	});
}

function buildPlacesSearchBody(input: PlaceSearchRequest) {
	const pageSize = Math.min(Math.max(input.maxResults, 1), 20);
	const normalizedQuery = normalizeQuery(input.query);

	if (input.searchType === 'category') {
		const includedType = constraintQueryToIncludedType(normalizedQuery);

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

	return {
		textQuery: normalizedQuery,
		pageSize,
		languageCode: 'en',
		regionCode: 'US',
		locationBias: {
			circle: {
				center: {
					latitude: input.region.center.lat,
					longitude: input.region.center.lng
				},
				radius: Math.min(Math.max(input.region.radius_meters, 1), 50_000)
			}
		}
	};
}

function parseGoogleDurationToMinutes(duration: string | undefined) {
	if (!duration) {
		return null;
	}

	const match = duration.match(/^([0-9.]+)s$/);

	if (!match) {
		return null;
	}

	return Number((Number.parseFloat(match[1]) / 60).toFixed(1));
}

function toGoogleTravelMode(travelMode: RouteMatrixRequest['travelMode']) {
	switch (travelMode) {
		case 'bike':
			return 'BICYCLE';
		case 'walk':
			return 'WALK';
		case 'drive':
			return 'DRIVE';
		case 'transit':
			return 'TRANSIT';
	}
}

function getMatrixElementLimit(travelMode: RouteMatrixRequest['travelMode']) {
	return travelMode === 'transit' ? 100 : 625;
}

async function readGoogleError(response: Response) {
	const payload = await response.json().catch(() => null);

	if (
		payload &&
		typeof payload === 'object' &&
		'error' in payload &&
		payload.error &&
		typeof payload.error === 'object' &&
		'message' in payload.error &&
		typeof payload.error.message === 'string'
	) {
		return payload.error.message;
	}

	return `${response.status} ${response.statusText}`;
}

async function fetchGooglePlaces(input: PlaceSearchRequest) {
	const apiKey = getGoogleApiKey();
	const response = await fetch(GOOGLE_PLACES_TEXT_SEARCH_URL, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'X-Goog-Api-Key': apiKey,
			'X-Goog-FieldMask':
				'places.id,places.displayName,places.formattedAddress,places.location,places.types'
		},
		body: JSON.stringify(buildPlacesSearchBody(input))
	});

	if (!response.ok) {
		throw new Error(`Google Places search failed: ${await readGoogleError(response)}`);
	}

	const payload = googlePlaceSearchResponseSchema.parse(await response.json());

	return (payload.places ?? [])
		.filter((place) => place.location)
		.map((place) => ({
			id: place.id,
			name: place.displayName?.text ?? place.formattedAddress ?? place.id,
			address: place.formattedAddress ?? null,
			location: {
				lat: place.location!.latitude,
				lng: place.location!.longitude
			},
			types: place.types ?? []
	}));
}

async function fetchGooglePlacePhoto(placeId: string): Promise<GooglePlacePhoto> {
	const apiKey = getGoogleApiKey();
	const response = await fetch(`${GOOGLE_PLACE_DETAILS_URL}/${placeId}`, {
		headers: {
			'content-type': 'application/json',
			'X-Goog-Api-Key': apiKey,
			'X-Goog-FieldMask': 'photos,googleMapsUri'
		}
	});

	if (!response.ok) {
		throw new Error(`Google Place Details failed: ${await readGoogleError(response)}`);
	}

	const payload = googlePlacePhotoDetailsResponseSchema.parse(await response.json());
	const photo = payload.photos?.[0];
	const attribution = photo?.authorAttributions?.[0];

	if (!photo) {
		return {
			photoUrl: null,
			authorName: null,
			authorUri: null,
			googleMapsUri: payload.googleMapsUri ?? null
		};
	}

	const photoUrl = new URL(`https://places.googleapis.com/v1/${photo.name}/media`);
	photoUrl.searchParams.set('maxWidthPx', '800');
	photoUrl.searchParams.set('maxHeightPx', '600');
	photoUrl.searchParams.set('skipHttpRedirect', 'true');
	photoUrl.searchParams.set('key', apiKey);

	const photoResponse = await fetch(photoUrl.toString());

	if (!photoResponse.ok) {
		throw new Error(`Google Place Photos failed: ${await readGoogleError(photoResponse)}`);
	}

	const photoPayload = googlePlacePhotoMediaResponseSchema.parse(await photoResponse.json());

	return {
		photoUrl: photoPayload.photoUri,
		authorName: attribution?.displayName ?? null,
		authorUri: normalizeExternalUri(attribution?.uri),
		googleMapsUri: payload.googleMapsUri ?? null
	};
}

export function createGooglePlacesProvider(logger?: SearchLogger): PlaceSearchProvider {
	return {
		async search(input) {
			const cacheKey = buildPlaceSearchCacheKey(input);
			const cached = getCachedValue(placeCache, cacheKey);

			if (cached) {
				logGoogleStep(logger, 'google-places', 'cache_hit', {
					query: input.query,
					searchType: input.searchType,
					results: cached.length
				});
				return cached;
			}

			const startedAt = Date.now();
			logGoogleStep(logger, 'google-places', 'request_start', {
				query: input.query,
				searchType: input.searchType,
				maxResults: input.maxResults,
				radiusMeters: Math.round(input.region.radius_meters)
			});

			try {
				const places = await fetchGooglePlaces(input);
				setCachedValue(placeCache, cacheKey, places, PLACE_CACHE_TTL_MS);
				logGoogleStep(logger, 'google-places', 'request_complete', {
					query: input.query,
					searchType: input.searchType,
					results: places.length,
					durationMs: Date.now() - startedAt
				});

				return places;
			} catch (error) {
				logGoogleStep(logger, 'google-places', 'request_failed', {
					query: input.query,
					searchType: input.searchType,
					durationMs: Date.now() - startedAt,
					message: error instanceof Error ? error.message : 'Google Places request failed.'
				});
				throw error;
			}
		}
	};
}

export async function getGooglePlacePhoto(placeId: string) {
	const cacheKey = placeId.trim();
	const cached = getCachedValue(photoCache, cacheKey);

	if (cached) {
		return cached;
	}

	const photo = await fetchGooglePlacePhoto(cacheKey);
	setCachedValue(photoCache, cacheKey, photo, PHOTO_CACHE_TTL_MS);

	return photo;
}

async function fetchRouteMatrixBatch(input: RouteMatrixRequest) {
	const apiKey = getGoogleApiKey();
	const response = await fetch(GOOGLE_ROUTE_MATRIX_URL, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'X-Goog-Api-Key': apiKey,
			'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,condition'
		},
		body: JSON.stringify({
			origins: input.origins.map((origin) => ({
				waypoint: {
					location: {
						latLng: {
							latitude: origin.location.lat,
							longitude: origin.location.lng
						}
					}
				}
			})),
			destinations: input.destinations.map((destination) => ({
				waypoint: {
					location: {
						latLng: {
							latitude: destination.location.lat,
							longitude: destination.location.lng
						}
					}
				}
			})),
			travelMode: toGoogleTravelMode(input.travelMode),
			...(input.travelMode === 'drive'
				? { routingPreference: 'TRAFFIC_UNAWARE' }
				: {}),
			...(input.departureTime &&
			(input.travelMode === 'drive' || input.travelMode === 'transit')
				? { departureTime: input.departureTime }
				: {})
		})
	});

	if (!response.ok) {
		throw new Error(`Google Routes matrix failed: ${await readGoogleError(response)}`);
	}

	return googleRouteMatrixResponseSchema.parse(await response.json());
}

export function createGoogleRoutesProvider(logger?: SearchLogger): RouteMatrixProvider {
	return {
		async computeRouteMatrix(input) {
			if (!input.origins.length || !input.destinations.length) {
				logGoogleStep(logger, 'google-routes', 'matrix_skipped', {
					travelMode: input.travelMode,
					origins: input.origins.length,
					destinations: input.destinations.length,
					reason: 'empty_matrix'
				});
				return [];
			}

			const elementLimit = getMatrixElementLimit(input.travelMode);
			const maxOriginsPerBatch = Math.max(
				1,
				Math.floor(elementLimit / Math.max(input.destinations.length, 1))
			);
			const allCells: RouteMatrixCell[] = [];
			const totalBatches = Math.ceil(input.origins.length / maxOriginsPerBatch);
			const matrixStartedAt = Date.now();

			logGoogleStep(logger, 'google-routes', 'matrix_start', {
				travelMode: input.travelMode,
				origins: input.origins.length,
				destinations: input.destinations.length,
				elements: input.origins.length * input.destinations.length,
				maxOriginsPerBatch,
				totalBatches
			});

			try {
				for (
					let index = 0, batchNumber = 1;
					index < input.origins.length;
					index += maxOriginsPerBatch, batchNumber += 1
				) {
					const batchInput: RouteMatrixRequest = {
						...input,
						origins: input.origins.slice(index, index + maxOriginsPerBatch)
					};
					const cacheKey = buildRouteCacheKey(batchInput);
					const cached = getCachedValue(routeCache, cacheKey);

					if (cached) {
						logGoogleStep(logger, 'google-routes', 'batch_cache_hit', {
							travelMode: input.travelMode,
							batchNumber,
							totalBatches,
							origins: batchInput.origins.length,
							destinations: batchInput.destinations.length,
							elements: batchInput.origins.length * batchInput.destinations.length
						});
						allCells.push(...cached);
						continue;
					}

					const batchStartedAt = Date.now();
					logGoogleStep(logger, 'google-routes', 'batch_request_start', {
						travelMode: input.travelMode,
						batchNumber,
						totalBatches,
						origins: batchInput.origins.length,
						destinations: batchInput.destinations.length,
						elements: batchInput.origins.length * batchInput.destinations.length
					});

					try {
						const payload = await fetchRouteMatrixBatch(batchInput);
						const cells = payload.map((cell) => {
							const origin = batchInput.origins[cell.originIndex];
							const destination = batchInput.destinations[cell.destinationIndex];

							return {
								origin_id: origin.id,
								destination_id: destination.id,
								minutes:
									cell.condition === 'ROUTE_EXISTS'
										? parseGoogleDurationToMinutes(cell.duration)
										: null
							};
						});

						setCachedValue(routeCache, cacheKey, cells, ROUTE_CACHE_TTL_MS);
						logGoogleStep(logger, 'google-routes', 'batch_request_complete', {
							travelMode: input.travelMode,
							batchNumber,
							totalBatches,
							cells: cells.length,
							resolvedCells: cells.filter((cell) => cell.minutes != null).length,
							durationMs: Date.now() - batchStartedAt
						});
						allCells.push(...cells);
					} catch (error) {
						logGoogleStep(logger, 'google-routes', 'batch_request_failed', {
							travelMode: input.travelMode,
							batchNumber,
							totalBatches,
							origins: batchInput.origins.length,
							destinations: batchInput.destinations.length,
							elements: batchInput.origins.length * batchInput.destinations.length,
							durationMs: Date.now() - batchStartedAt,
							message:
								error instanceof Error
									? error.message
									: 'Google Routes batch request failed.'
						});
						throw error;
					}
				}
			} catch (error) {
				logGoogleStep(logger, 'google-routes', 'matrix_failed', {
					travelMode: input.travelMode,
					origins: input.origins.length,
					destinations: input.destinations.length,
					elements: input.origins.length * input.destinations.length,
					durationMs: Date.now() - matrixStartedAt,
					message: error instanceof Error ? error.message : 'Google Routes matrix failed.'
				});
				throw error;
			}

			logGoogleStep(logger, 'google-routes', 'matrix_complete', {
				travelMode: input.travelMode,
				origins: input.origins.length,
				destinations: input.destinations.length,
				cells: allCells.length,
				resolvedCells: allCells.filter((cell) => cell.minutes != null).length,
				durationMs: Date.now() - matrixStartedAt
			});

			return allCells;
		}
	};
}

export function createGoogleMapsProviders(logger?: SearchLogger) {
	return {
		places: createGooglePlacesProvider(logger),
		routes: createGoogleRoutesProvider(logger)
	};
}
