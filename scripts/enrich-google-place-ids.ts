import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import {
	createEmptyGooglePlaceIdStore,
	getDefaultGooglePlaceIdsPath,
	getDefaultIrvineRentcastPath,
	loadGooglePlaceIdStore,
	rentcastListingCollectionSchema,
	type GooglePlaceMatch,
	type RentcastListing
} from '../src/lib/server/apartment-inventory';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

if (!GOOGLE_API_KEY) {
	console.error('Missing GOOGLE_API_KEY in .env');
	process.exit(1);
}

const RENTCAST_PATH = getDefaultIrvineRentcastPath();
const OUTPUT_PATH = getDefaultGooglePlaceIdsPath();
const REQUEST_DELAY_MS = Number(process.env.GOOGLE_PLACES_THROTTLE_MS ?? 125);
const NEARBY_RADIUS_METERS = Number(process.env.GOOGLE_PLACES_RADIUS_METERS ?? 250);
const MIN_CONFIDENCE = Number(process.env.GOOGLE_PLACES_MIN_CONFIDENCE ?? 0.55);
const FIELD_MASK =
	'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.googleMapsUri';

type GooglePlaceCandidate = {
	id: string;
	displayName?: { text?: string };
	formattedAddress?: string;
	location?: {
		latitude?: number;
		longitude?: number;
	};
	primaryType?: string;
	googleMapsUri?: string;
};

type SearchNearbyResponse = {
	places?: GooglePlaceCandidate[];
};

type SearchTextResponse = {
	places?: GooglePlaceCandidate[];
};

type PropertyGroup = {
	key: string;
	listings: RentcastListing[];
};

function loadRentcastListings() {
	const raw = readFileSync(RENTCAST_PATH, 'utf-8');
	return rentcastListingCollectionSchema.parse(JSON.parse(raw));
}

function normalizeText(value: string) {
	return value
		.toLowerCase()
		.replace(/[#.,/]/g, ' ')
		.replace(/\b(unit|apt|apartment|apartments|suite|ste|building|bldg)\b/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function extractStreetNumber(addressLine1: string | undefined) {
	return addressLine1?.match(/^\d+/)?.[0] ?? null;
}

function extractStreetTokens(addressLine1: string | undefined) {
	return new Set(normalizeText(addressLine1 ?? '').split(' ').filter((token) => token.length >= 3));
}

function buildPropertyKey(listing: RentcastListing) {
	return [
		normalizeText(listing.addressLine1 ?? listing.formattedAddress),
		listing.city.toLowerCase(),
		listing.state.toLowerCase(),
		listing.zipCode
	].join('|');
}

function groupListingsByProperty(listings: RentcastListing[]) {
	const groups = new Map<string, RentcastListing[]>();

	for (const listing of listings) {
		const key = buildPropertyKey(listing);
		const existing = groups.get(key);
		if (existing) {
			existing.push(listing);
			continue;
		}
		groups.set(key, [listing]);
	}

	return [...groups.entries()].map(
		([key, groupedListings]): PropertyGroup => ({ key, listings: groupedListings })
	);
}

function haversineMeters(
	lat1: number,
	lng1: number,
	lat2: number | undefined,
	lng2: number | undefined
) {
	if (lat2 == null || lng2 == null) return Number.POSITIVE_INFINITY;
	const toRad = (degrees: number) => (degrees * Math.PI) / 180;
	const earthRadius = 6371000;
	const dLat = toRad(lat2 - lat1);
	const dLng = toRad(lng2 - lng1);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

	return 2 * earthRadius * Math.asin(Math.sqrt(a));
}

function tokenOverlapScore(sourceTokens: Set<string>, candidateText: string | undefined) {
	if (sourceTokens.size === 0 || !candidateText) return 0;
	const candidateTokens = new Set(normalizeText(candidateText).split(' ').filter(Boolean));
	let matches = 0;

	for (const token of sourceTokens) {
		if (candidateTokens.has(token)) matches++;
	}

	return matches / sourceTokens.size;
}

function scoreCandidate(listing: RentcastListing, candidate: GooglePlaceCandidate) {
	const streetTokens = extractStreetTokens(listing.addressLine1);
	const sourceStreetNumber = extractStreetNumber(listing.addressLine1);
	const candidateDistance = haversineMeters(
		listing.latitude,
		listing.longitude,
		candidate.location?.latitude,
		candidate.location?.longitude
	);
	const distanceScore = Math.max(0, 1 - candidateDistance / NEARBY_RADIUS_METERS);
	const addressScore = tokenOverlapScore(streetTokens, candidate.formattedAddress);
	const nameScore = tokenOverlapScore(streetTokens, candidate.displayName?.text);
	const streetNumberScore =
		sourceStreetNumber && candidate.formattedAddress?.includes(sourceStreetNumber) ? 1 : 0;
	const typeScore =
		candidate.primaryType === 'apartment_complex' ||
		candidate.primaryType === 'apartment_building' ||
		candidate.primaryType === 'housing_complex'
			? 1
			: 0;

	const confidence =
		distanceScore * 0.45 +
		addressScore * 0.25 +
		nameScore * 0.15 +
		streetNumberScore * 0.1 +
		typeScore * 0.05;

	return {
		confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(3)))),
		distanceMeters: Math.round(candidateDistance)
	};
}

async function searchNearby(listing: RentcastListing) {
	const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Goog-Api-Key': GOOGLE_API_KEY!,
			'X-Goog-FieldMask': FIELD_MASK
		},
		body: JSON.stringify({
			includedTypes: ['apartment_complex', 'apartment_building', 'housing_complex'],
			maxResultCount: 5,
			locationRestriction: {
				circle: {
					center: {
						latitude: listing.latitude,
						longitude: listing.longitude
					},
					radius: NEARBY_RADIUS_METERS
				}
			}
		})
	});

	if (!response.ok) {
		throw new Error(`Google Places nearby search failed (${response.status}): ${await response.text()}`);
	}

	const data = (await response.json()) as SearchNearbyResponse;
	return data.places ?? [];
}

async function searchText(listing: RentcastListing) {
	const query = [listing.addressLine1, listing.city, listing.state, listing.zipCode]
		.filter(Boolean)
		.join(', ');

	const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Goog-Api-Key': GOOGLE_API_KEY!,
			'X-Goog-FieldMask': FIELD_MASK
		},
		body: JSON.stringify({
			textQuery: query,
			includedType: 'apartment_complex',
			maxResultCount: 5
		})
	});

	if (!response.ok) {
		throw new Error(`Google Places text search failed (${response.status}): ${await response.text()}`);
	}

	const data = (await response.json()) as SearchTextResponse;
	return data.places ?? [];
}

function createMatchRecord(
	propertyKey: string,
	candidate: GooglePlaceCandidate | null,
	matchMethod: GooglePlaceMatch['matchMethod'],
	confidence: number | null
): GooglePlaceMatch {
	return {
		placeId: candidate?.id ?? null,
		propertyKey,
		matchedName: candidate?.displayName?.text ?? null,
		matchedAddress: candidate?.formattedAddress ?? null,
		primaryType: candidate?.primaryType ?? null,
		googleMapsUri: candidate?.googleMapsUri ?? null,
		matchMethod,
		confidence,
		updatedAt: new Date().toISOString()
	};
}

async function resolvePropertyMatch(group: PropertyGroup) {
	const representative = group.listings[0];
	const nearbyCandidates = await searchNearby(representative);
	const scoredNearby = nearbyCandidates
		.map((candidate) => ({
			candidate,
			...scoreCandidate(representative, candidate)
		}))
		.sort((left, right) => right.confidence - left.confidence);

	if (scoredNearby[0] && scoredNearby[0].confidence >= MIN_CONFIDENCE) {
		return createMatchRecord(group.key, scoredNearby[0].candidate, 'nearby', scoredNearby[0].confidence);
	}

	const textCandidates = await searchText(representative);
	const scoredText = textCandidates
		.map((candidate) => ({
			candidate,
			...scoreCandidate(representative, candidate)
		}))
		.sort((left, right) => right.confidence - left.confidence);

	if (scoredText[0] && scoredText[0].confidence >= MIN_CONFIDENCE) {
		return createMatchRecord(group.key, scoredText[0].candidate, 'text', scoredText[0].confidence);
	}

	return createMatchRecord(group.key, null, 'unmatched', null);
}

function sleep(milliseconds: number) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
	const listings = loadRentcastListings();
	const groups = groupListingsByProperty(listings);
	const store = loadGooglePlaceIdStore(OUTPUT_PATH);
	const nextStore = {
		...createEmptyGooglePlaceIdStore(),
		...store,
		matches: { ...store.matches }
	};
	let resolved = 0;
	let skipped = 0;

	for (const group of groups) {
		const hasExistingMatch = group.listings.every((listing) => !!nextStore.matches[listing.id]);
		if (hasExistingMatch) {
			skipped++;
			continue;
		}

		const match = await resolvePropertyMatch(group);
		for (const listing of group.listings) {
			nextStore.matches[listing.id] = match;
		}

		resolved++;
		const sampleAddress = group.listings[0]?.formattedAddress ?? group.key;
		console.log(
			`[${resolved}/${groups.length - skipped}] ${sampleAddress} -> ${match.placeId ?? 'UNMATCHED'} (${match.matchMethod}${match.confidence != null ? `, ${match.confidence}` : ''})`
		);

		await sleep(REQUEST_DELAY_MS);
	}

	nextStore.updatedAt = new Date().toISOString();
	writeFileSync(OUTPUT_PATH, JSON.stringify(nextStore, null, 2));

	console.log(`\nSaved Google place IDs to ${OUTPUT_PATH}`);
	console.log(`Resolved ${resolved} property groups, skipped ${skipped} already-enriched groups.`);
}

main().catch((error) => {
	console.error('Fatal error while enriching Google place IDs:', error);
	process.exit(1);
});
