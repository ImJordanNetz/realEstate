import assert from 'node:assert/strict';
import test from 'node:test';
import {
	loadIrvineRentcastListings,
	type ApartmentInventoryListing
} from '../src/lib/server/apartment-inventory';
import { buildApartmentConstraintKey } from '../src/lib/server/apartment-ranking';
import {
	buildSearchRegion,
	searchApartments,
	type PlaceCandidate,
	type PlaceSearchProvider,
	type RouteMatrixProvider
} from '../src/lib/server/apartment-search';
import type { ApartmentPreferences } from '../src/lib/server/apartment-preferences';

class StubPlacesProvider implements PlaceSearchProvider {
	constructor(private readonly responses: Record<string, PlaceCandidate[]>) {}

	async search(input: { query: string; searchType: string }) {
		return this.responses[this.toKey(input.searchType, input.query)] ?? [];
	}

	private toKey(searchType: string, query: string) {
		return `${searchType}:${query.trim().toLowerCase()}`;
	}
}

class StubRoutesProvider implements RouteMatrixProvider {
	constructor(
		private readonly matrix: Record<string, Record<string, Record<string, number | null>>>
	) {}

	async computeRouteMatrix(input: {
		origins: Array<{ id: string }>;
		destinations: Array<{ id: string }>;
		travelMode: string;
	}) {
		return input.origins.flatMap((origin) =>
			input.destinations.map((destination) => ({
				origin_id: origin.id,
				destination_id: destination.id,
				minutes: this.matrix[input.travelMode]?.[origin.id]?.[destination.id] ?? null
			}))
		);
	}
}

function createPreferenceProfile() {
	return {
		budget: {
			max_rent: 3800,
			ideal_rent: 3500
		},
		commute: {
			search_query: 'University of California, Irvine',
			travel_mode: 'bike',
			max_minutes: 10,
			is_dealbreaker: true,
			importance: 0.9
		},
		constraints: [
			{
				label: 'Walkable parks',
				search_query: 'park',
				search_type: 'category',
				travel_mode: 'walk',
				max_minutes: 10,
				is_dealbreaker: false,
				importance: 0.7
			},
			{
				label: 'Nearby rock climbing',
				search_query: 'rock climbing gym',
				search_type: 'category',
				travel_mode: 'drive',
				max_minutes: null,
				is_dealbreaker: false,
				importance: 0.45
			}
		],
		unit_requirements: {
			bedrooms: null,
			bathrooms: null,
			pets: null,
			parking: {
				required: true,
				type_preference: 'any',
				is_dealbreaker: true,
				importance: 1
			},
			laundry: null,
			furnished: null,
			sqft: null,
			lease_length_months: null,
			amenities: null
		},
		raw_input:
			'I like to rock climb and being a walkable distance to parks is important to me. I commute to UCI every day via bike and I own a car'
	} satisfies ApartmentPreferences;
}

function createListing(
	id: string,
	overrides: Partial<ApartmentInventoryListing> = {}
): ApartmentInventoryListing {
	return {
		id,
		title: id,
		address: `${id} Irvine, CA`,
		location: {
			lat: 33.68,
			lng: -117.82
		},
		source: 'rentcast',
		property_type: 'Apartment',
		status: 'Active',
		rent: 3400,
		bedrooms: 2,
		bathrooms: 2,
		sqft: 1100,
		listed_date: '2026-02-28T00:00:00.000Z',
		furnished: null,
		parking: {
			available: true,
			type: 'covered'
		},
		laundry: null,
		pets: null,
		amenities: [],
		lease_length_months: null,
		...overrides
	};
}

test('loadIrvineRentcastListings normalizes the RentCast feed', () => {
	const listings = loadIrvineRentcastListings();

	assert.equal(listings.length, 500);
	assert.equal(listings[0]?.source, 'rentcast');
	assert.ok(listings.every((listing) => listing.location.lat !== 0 && listing.location.lng !== 0));
	assert.ok(listings.every((listing) => listing.amenities.length === 0));

	const region = buildSearchRegion(listings);
	assert.ok(region.radius_meters > 0);
	assert.ok(region.bounds.south <= region.bounds.north);
	assert.ok(region.bounds.west <= region.bounds.east);
});

test('searchApartments returns strict matches ordered by weighted soft preferences', async () => {
	const preferences = createPreferenceProfile();
	const listings = [
		createListing('alpha', { rent: 3350 }),
		createListing('beta', { rent: 3500 }),
		createListing('gamma', {
			rent: 3200,
			parking: {
				available: false,
				type: 'none'
			}
		})
	];
	const places = new StubPlacesProvider({
		'specific:university of california, irvine': [
			{
				id: 'uci',
				name: 'University of California, Irvine',
				location: { lat: 33.6405, lng: -117.8443 },
				address: 'Irvine, CA',
				types: ['university']
			}
		],
		'category:park': [
			{
				id: 'park-1',
				name: 'Park One',
				location: { lat: 33.681, lng: -117.82 },
				address: 'Irvine, CA',
				types: ['park']
			}
		],
		'category:rock climbing gym': [
			{
				id: 'climb-1',
				name: 'Climb One',
				location: { lat: 33.69, lng: -117.84 },
				address: 'Irvine, CA',
				types: ['gym']
			}
		]
	});
	const routes = new StubRoutesProvider({
		bike: {
			alpha: { uci: 8 },
			beta: { uci: 9 },
			gamma: { uci: 7 }
		},
		walk: {
			alpha: { 'park-1': 4 },
			beta: { 'park-1': 7 },
			gamma: { 'park-1': 2 }
		},
		drive: {
			alpha: { 'climb-1': 10 },
			beta: { 'climb-1': 18 },
			gamma: { 'climb-1': 9 }
		}
	});

	const result = await searchApartments({
		preferences,
		listings,
		providers: { places, routes }
	});
	const parkKey = buildApartmentConstraintKey(preferences.constraints[0]);

	assert.equal(result.mode, 'strict');
	assert.equal(result.ranked[0]?.listing.id, 'alpha');
	assert.equal(result.ranked[0]?.passes_required, true);
	assert.equal(result.ranked[0]?.derived_metrics.commute_minutes, 8);
	assert.equal(result.ranked[0]?.derived_metrics.proximity_minutes[parkKey], 4);
	assert.equal(result.ranked.some((hit) => hit.listing.id === 'gamma'), false);
});

test('searchApartments falls back to best near-miss when no apartment satisfies all required criteria', async () => {
	const preferences = createPreferenceProfile();
	const listings = [
		createListing('alpha'),
		createListing('beta', {
			parking: {
				available: false,
				type: 'none'
			}
		}),
		createListing('gamma', {
			parking: {
				available: false,
				type: 'none'
			}
		})
	];
	const places = new StubPlacesProvider({
		'specific:university of california, irvine': [
			{
				id: 'uci',
				name: 'University of California, Irvine',
				location: { lat: 33.6405, lng: -117.8443 },
				address: 'Irvine, CA',
				types: ['university']
			}
		],
		'category:park': [],
		'category:rock climbing gym': []
	});
	const routes = new StubRoutesProvider({
		bike: {
			alpha: { uci: 11 },
			beta: { uci: 8 },
			gamma: { uci: 14 }
		},
		walk: {},
		drive: {}
	});

	const result = await searchApartments({
		preferences,
		listings,
		providers: { places, routes }
	});

	assert.equal(result.mode, 'fallback');
	assert.equal(result.ranked[0]?.listing.id, 'alpha');
	assert.equal(result.ranked[0]?.passes_required, false);
	assert.equal(result.ranked[0]?.required_pass_count, 2);
	assert.equal(result.ranked[1]?.listing.id, 'beta');
	assert.ok(result.ranked[0]!.required_score > result.ranked[1]!.required_score);
});
