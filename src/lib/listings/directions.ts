/**
 * Client-side directions fetching with polyline decoding and caching.
 */

export type RouteDestination = {
	id: string;
	label: string;
	lat: number;
	lng: number;
	travelMode: 'drive' | 'transit' | 'walk' | 'bike';
	minutes: number | null;
};

export type DecodedRoute = {
	id: string;
	coordinates: [number, number][]; // [lng, lat][]
};

export type DirectionsResult = {
	routes: DecodedRoute[];
};

type ApiResponse = {
	routes: Array<{
		id: string;
		encodedPolyline: string | null;
	}>;
};

type DirectionsRequestParams = {
	listingId: string;
	origin: { lat: number; lng: number };
	destinations: RouteDestination[];
	signal?: AbortSignal;
};

// Client-side cache keyed by the full route request shape
const directionsClientCache = new Map<string, DirectionsResult>();

export function clearDirectionsCache() {
	directionsClientCache.clear();
}

function roundedCoordinate(value: number) {
	return Number(value.toFixed(5));
}

function buildDirectionsCacheKey(params: DirectionsRequestParams) {
	return JSON.stringify({
		listingId: params.listingId,
		origin: {
			lat: roundedCoordinate(params.origin.lat),
			lng: roundedCoordinate(params.origin.lng)
		},
		destinations: params.destinations.map((destination) => ({
			id: destination.id,
			lat: roundedCoordinate(destination.lat),
			lng: roundedCoordinate(destination.lng),
			travelMode: destination.travelMode
		}))
	});
}

/**
 * Decode a Google encoded polyline string into [lng, lat] coordinate pairs.
 * See: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(encoded: string): [number, number][] {
	const coordinates: [number, number][] = [];
	let index = 0;
	let lat = 0;
	let lng = 0;

	while (index < encoded.length) {
		let shift = 0;
		let result = 0;
		let byte: number;

		do {
			byte = encoded.charCodeAt(index++) - 63;
			result |= (byte & 0x1f) << shift;
			shift += 5;
		} while (byte >= 0x20);

		lat += result & 1 ? ~(result >> 1) : result >> 1;

		shift = 0;
		result = 0;

		do {
			byte = encoded.charCodeAt(index++) - 63;
			result |= (byte & 0x1f) << shift;
			shift += 5;
		} while (byte >= 0x20);

		lng += result & 1 ? ~(result >> 1) : result >> 1;

		coordinates.push([lng / 1e5, lat / 1e5]);
	}

	return coordinates;
}

export async function requestDirections(
	params: DirectionsRequestParams
): Promise<DirectionsResult> {
	const cacheKey = buildDirectionsCacheKey(params);
	const cached = directionsClientCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const response = await fetch('/api/listings/directions', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			origin: params.origin,
			destinations: params.destinations.map((d) => ({
				id: d.id,
				lat: d.lat,
				lng: d.lng,
				travelMode: d.travelMode
			}))
		}),
		signal: params.signal
	});

	if (!response.ok) {
		throw new Error('Failed to fetch directions.');
	}

	const data = (await response.json()) as ApiResponse;

	const routes: DecodedRoute[] = data.routes
		.filter((r) => r.encodedPolyline != null)
		.map((r) => ({
			id: r.id,
			coordinates: decodePolyline(r.encodedPolyline!)
		}));

	const result: DirectionsResult = { routes };
	directionsClientCache.set(cacheKey, result);
	return result;
}
