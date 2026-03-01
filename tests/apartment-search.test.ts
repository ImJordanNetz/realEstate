import assert from 'node:assert/strict';
import test from 'node:test';
import {
	loadAllRentcastListings,
	type ApartmentInventoryListing
} from '../src/lib/server/apartment-inventory';
import { buildApartmentConstraintKey } from '../src/lib/server/apartment-ranking';
import {
	buildSearchRegion,
	searchApartments,
	type PlaceCandidate,
	type PlaceSearchRequest,
	type PlaceSearchProvider,
	type RouteMatrixProvider
} from '../src/lib/server/apartment-search';
import type { ApartmentPreferences } from '../src/lib/server/apartment-preferences';
import { buildNightlifeGrid, type NightlifeGrid } from '../src/lib/server/nightlife-grid';

class StubPlacesProvider implements PlaceSearchProvider {
	public readonly calls: Array<{ query: string; searchType: string }> = [];

	constructor(private readonly responses: Record<string, PlaceCandidate[]>) {}

	async search(input: { query: string; searchType: string }) {
		this.calls.push({
			query: input.query,
			searchType: input.searchType
		});

		return this.responses[this.toKey(input.searchType, input.query)] ?? [];
	}

	private toKey(searchType: string, query: string) {
		return `${searchType}:${query.trim().toLowerCase()}`;
	}
}

class RecordingPlacesProvider implements PlaceSearchProvider {
	public readonly calls: Array<{
		query: string;
		searchType: string;
		radiusMeters: number;
	}> = [];

	constructor(private readonly resolver: (input: PlaceSearchRequest) => PlaceCandidate[]) {}

	async search(input: PlaceSearchRequest) {
		this.calls.push({
			query: input.query,
			searchType: input.searchType,
			radiusMeters: input.region.radius_meters
		});

		return this.resolver(input);
	}
}

class StubRoutesProvider implements RouteMatrixProvider {
	public readonly calls: Array<{
		originIds: string[];
		destinationIds: string[];
		travelMode: string;
	}> = [];

	constructor(
		private readonly matrix: Record<string, Record<string, Record<string, number | null>>>
	) {}

	async computeRouteMatrix(input: {
		origins: Array<{ id: string }>;
		destinations: Array<{ id: string }>;
		travelMode: string;
	}) {
		this.calls.push({
			originIds: input.origins.map((origin) => origin.id),
			destinationIds: input.destinations.map((destination) => destination.id),
			travelMode: input.travelMode
		});

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
		nightlife: null,
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

function createNightlifeProfile(preference: 'quiet' | 'lively') {
	return {
		budget: {
			max_rent: null,
			ideal_rent: null
		},
		nightlife: {
			preference,
			is_dealbreaker: false,
			importance: 0.9
		},
		commute: null,
		constraints: [],
		unit_requirements: null,
		raw_input:
			preference === 'quiet' ? 'I want quiet nights' : 'I want lively nightlife nearby'
	} satisfies ApartmentPreferences;
}

function createAmenityLocationProfile() {
	return {
		budget: {
			max_rent: null,
			ideal_rent: null
		},
		nightlife: null,
		commute: null,
		constraints: [],
		unit_requirements: {
			bedrooms: null,
			bathrooms: null,
			pets: null,
			parking: null,
			laundry: null,
			furnished: null,
			sqft: null,
			lease_length_months: null,
			amenities: [
				{
					name: 'gym',
					is_dealbreaker: false,
					importance: 0.8
				}
			]
		},
		raw_input: 'I want a gym nearby'
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
		place_id: null,
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

async function createNightlifeGridForListings(
	listings: ApartmentInventoryListing[],
	places: PlaceSearchProvider
) : Promise<NightlifeGrid> {
	return buildNightlifeGrid({
		region: buildSearchRegion(listings),
		places
	});
}

test('loadAllRentcastListings normalizes the RentCast feed', () => {
	const listings = loadAllRentcastListings();
	assert.equal(listings[0]?.source, 'rentcast');
	assert.ok(listings.every((listing) => listing.location.lat !== 0 && listing.location.lng !== 0));
	assert.ok(listings.every((listing) => listing.amenities.length === 0));

	const region = buildSearchRegion(listings);
	assert.ok(region.radius_meters > 0);
	assert.ok(region.bounds.south <= region.bounds.north);
	assert.ok(region.bounds.west <= region.bounds.east);
});

test('searchApartments returns strict matches first and appends near misses when exact matches are sparse', async () => {
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
	assert.equal(result.ranked[1]?.listing.id, 'beta');
	assert.equal(result.ranked[1]?.passes_required, true);
	assert.equal(result.ranked[2]?.listing.id, 'gamma');
	assert.equal(result.ranked[2]?.passes_required, false);
	assert.equal(result.ranked[0]?.derived_metrics.commute_minutes, 8);
	assert.equal(result.ranked[0]?.derived_metrics.proximity_minutes[parkKey], 4);
	assert.equal(result.ranked.length, 3);
});

test('searchApartments keeps results strict-only once it has at least three exact matches', async () => {
	const preferences = createPreferenceProfile();
	const listings = [
		createListing('alpha', { rent: 3350 }),
		createListing('beta', { rent: 3500 }),
		createListing('delta', { rent: 3450 }),
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
			delta: { uci: 10 },
			gamma: { uci: 7 }
		},
		walk: {
			alpha: { 'park-1': 4 },
			beta: { 'park-1': 7 },
			delta: { 'park-1': 5 },
			gamma: { 'park-1': 2 }
		},
		drive: {
			alpha: { 'climb-1': 10 },
			beta: { 'climb-1': 18 },
			delta: { 'climb-1': 11 },
			gamma: { 'climb-1': 9 }
		}
	});

	const result = await searchApartments({
		preferences,
		listings,
		providers: { places, routes }
	});

	assert.equal(result.mode, 'strict');
	assert.deepEqual(
		result.ranked.map((hit) => hit.listing.id),
		['alpha', 'delta', 'beta']
	);
	assert.ok(result.ranked.every((hit) => hit.passes_required));
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

test('searchApartments only routes a shortlist of top candidates', async () => {
	const preferences = createPreferenceProfile();
	const listings = [
		createListing('alpha', { location: { lat: 33.6407, lng: -117.8444 } }),
		createListing('beta', { location: { lat: 33.642, lng: -117.843 } }),
		createListing('gamma', { location: { lat: 33.67, lng: -117.82 } }),
		createListing('delta', { location: { lat: 33.71, lng: -117.79 } }),
		createListing('epsilon', { location: { lat: 33.73, lng: -117.78 } }),
		createListing('zeta', { location: { lat: 33.75, lng: -117.76 } })
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
				location: { lat: 33.6412, lng: -117.8438 },
				address: 'Irvine, CA',
				types: ['park']
			}
		],
		'category:rock climbing gym': [
			{
				id: 'climb-1',
				name: 'Climb One',
				location: { lat: 33.652, lng: -117.85 },
				address: 'Irvine, CA',
				types: ['gym']
			}
		]
	});
	const routes = new StubRoutesProvider({
		bike: {
			alpha: { uci: 6 },
			beta: { uci: 7 }
		},
		walk: {
			alpha: { 'park-1': 3 },
			beta: { 'park-1': 4 }
		},
		drive: {
			alpha: { 'climb-1': 8 },
			beta: { 'climb-1': 10 }
		}
	});

	const result = await searchApartments({
		preferences,
		listings,
		providers: { places, routes },
		options: {
			shortlistCount: 2
		}
	});

	assert.equal(result.ranked.length, 2);
	assert.deepEqual(
		new Set(routes.calls.flatMap((call) => call.originIds)),
		new Set(['alpha', 'beta'])
	);
	assert.ok(routes.calls.every((call) => call.originIds.length <= 2));
});

test('searchApartments refines saturated category searches against the shortlist region', async () => {
	const preferences = {
		budget: {
			max_rent: null,
			ideal_rent: 2_000
		},
		nightlife: null,
		commute: null,
		constraints: [
			{
				label: 'Parks nearby',
				search_query: 'park',
				search_type: 'category',
				travel_mode: 'walk',
				max_minutes: 10,
				is_dealbreaker: false,
				importance: 0.9
			}
		],
		unit_requirements: null,
		raw_input: 'I want a cheaper apartment near a park'
	} satisfies ApartmentPreferences;
	const listings = [
		createListing('alpha', {
			rent: 1_900,
			location: { lat: 33.6802, lng: -117.8202 }
		}),
		createListing('beta', {
			rent: 3_200,
			location: { lat: 33.832, lng: -117.914 }
		})
	];
	const broadParks = Array.from({ length: 20 }, (_, index) => ({
		id: `broad-park-${index + 1}`,
		name: `Broad Park ${index + 1}`,
		location: {
			lat: 33.83 + index * 0.0005,
			lng: -117.914 + index * 0.0005
		},
		address: 'Far away, CA',
		types: ['park']
	}));
	const localPark: PlaceCandidate = {
		id: 'alpha-local-park',
		name: 'Alpha Local Park',
		location: { lat: 33.681, lng: -117.8201 },
		address: 'Irvine, CA',
		types: ['park']
	};
	const places = new RecordingPlacesProvider((input) => {
		if (input.searchType !== 'category' || input.query !== 'park') {
			return [];
		}

		return input.region.radius_meters > 5_000 ? broadParks : [localPark];
	});
	const routes: RouteMatrixProvider = {
		async computeRouteMatrix(input) {
			return input.origins.flatMap((origin) =>
				input.destinations.map((destination) => ({
					origin_id: origin.id,
					destination_id: destination.id,
					minutes:
						origin.id === 'alpha'
							? destination.id === 'alpha-local-park'
								? 4
								: 28
							: destination.id === 'alpha-local-park'
								? 35
								: 8
				}))
			);
		}
	};

	const result = await searchApartments({
		preferences,
		listings,
		providers: { places, routes },
		options: {
			shortlistCount: 1
		}
	});
	const parkKey = buildApartmentConstraintKey(preferences.constraints[0]);
	const parkCalls = places.calls.filter(
		(call) => call.searchType === 'category' && call.query === 'park'
	);

	assert.equal(parkCalls.length, 2);
	assert.ok(parkCalls[1]!.radiusMeters < parkCalls[0]!.radiusMeters);
	assert.equal(result.ranked.length, 1);
	assert.equal(result.ranked[0]?.listing.id, 'alpha');
	assert.equal(result.ranked[0]?.derived_metrics.proximity_minutes[parkKey], 4);
	assert.equal(result.ranked[0]?.matched_places.constraints[parkKey]?.id, 'alpha-local-park');
});

test('searchApartments skips shortlist refinement when the initial category search is not saturated', async () => {
	const preferences = {
		budget: {
			max_rent: null,
			ideal_rent: 2_000
		},
		nightlife: null,
		commute: null,
		constraints: [
			{
				label: 'Parks nearby',
				search_query: 'park',
				search_type: 'category',
				travel_mode: 'walk',
				max_minutes: 10,
				is_dealbreaker: false,
				importance: 0.9
			}
		],
		unit_requirements: null,
		raw_input: 'I want a cheaper apartment near a park'
	} satisfies ApartmentPreferences;
	const listings = [
		createListing('alpha', {
			rent: 1_900,
			location: { lat: 33.6802, lng: -117.8202 }
		}),
		createListing('beta', {
			rent: 3_200,
			location: { lat: 33.832, lng: -117.914 }
		})
	];
	const localPark: PlaceCandidate = {
		id: 'alpha-local-park',
		name: 'Alpha Local Park',
		location: { lat: 33.681, lng: -117.8201 },
		address: 'Irvine, CA',
		types: ['park']
	};
	const places = new RecordingPlacesProvider((input) => {
		if (input.searchType !== 'category' || input.query !== 'park') {
			return [];
		}

		return [localPark];
	});
	const routes: RouteMatrixProvider = {
		async computeRouteMatrix(input) {
			return input.origins.flatMap((origin) =>
				input.destinations.map((destination) => ({
					origin_id: origin.id,
					destination_id: destination.id,
					minutes: origin.id === 'alpha' && destination.id === 'alpha-local-park' ? 4 : 12
				}))
			);
		}
	};

	await searchApartments({
		preferences,
		listings,
		providers: { places, routes },
		options: {
			shortlistCount: 1
		}
	});

	const parkCalls = places.calls.filter(
		(call) => call.searchType === 'category' && call.query === 'park'
	);
	assert.equal(parkCalls.length, 1);
});

test('searchApartments ranks location-like amenities by nearby travel time', async () => {
	const preferences = createAmenityLocationProfile();
	const listings = [
		createListing('alpha', { location: { lat: 33.6802, lng: -117.8202 } }),
		createListing('beta', { location: { lat: 33.705, lng: -117.79 } })
	];
	const places = new StubPlacesProvider({
		'category:gym': [
			{
				id: 'gym-1',
				name: 'Gym One',
				location: { lat: 33.681, lng: -117.8201 },
				address: 'Irvine, CA',
				types: ['gym']
			}
		]
	});
	const routes = new StubRoutesProvider({
		walk: {
			alpha: { 'gym-1': 4 },
			beta: { 'gym-1': 13 }
		}
	});

	const result = await searchApartments({
		preferences,
		listings,
		providers: { places, routes }
	});

	const amenityCriterionAlpha = result.ranked[0]?.criteria.find(
		(criterion) => criterion.label === 'Amenity: gym'
	);
	const amenityCriterionBeta = result.ranked[1]?.criteria.find(
		(criterion) => criterion.label === 'Amenity: gym'
	);

	assert.equal(result.mode, 'strict');
	assert.equal(result.ranked[0]?.listing.id, 'alpha');
	assert.equal(result.ranked[1]?.listing.id, 'beta');
	assert.equal(amenityCriterionAlpha?.actual, 4);
	assert.equal(amenityCriterionBeta?.actual, 13);
	assert.ok((amenityCriterionAlpha?.score ?? 0) > (amenityCriterionBeta?.score ?? 0));
	assert.deepEqual(
		places.calls.map((call) => `${call.searchType}:${call.query.toLowerCase()}`),
		['category:gym']
	);
});

test('searchApartments does not double-count amenity locations that already exist as needs', async () => {
	const preferences = {
		...createAmenityLocationProfile(),
		constraints: [
			{
				label: 'Nearby gym',
				search_query: 'gym',
				search_type: 'category',
				travel_mode: 'walk',
				max_minutes: 10,
				is_dealbreaker: false,
				importance: 0.9
			}
		]
	} satisfies ApartmentPreferences;
	const listings = [createListing('alpha', { location: { lat: 33.6802, lng: -117.8202 } })];
	const places = new StubPlacesProvider({
		'category:gym': [
			{
				id: 'gym-1',
				name: 'Gym One',
				location: { lat: 33.681, lng: -117.8201 },
				address: 'Irvine, CA',
				types: ['gym']
			}
		]
	});
	const routes = new StubRoutesProvider({
		walk: {
			alpha: { 'gym-1': 4 }
		}
	});

	const result = await searchApartments({
		preferences,
		listings,
		providers: { places, routes }
	});

	assert.equal(result.ranked[0]?.criteria.filter((criterion) => criterion.label === 'Amenity: gym').length, 0);
	assert.equal(places.calls.length, 1);
	assert.equal(routes.calls.length, 1);
});

test('searchApartments ranks quieter cells higher when the user wants quiet nights', async () => {
	const preferences = createNightlifeProfile('quiet');
	const listings = [
		createListing('alpha', { location: { lat: 33.6802, lng: -117.8202 } }),
		createListing('beta', { location: { lat: 33.707, lng: -117.792 } })
	];
	const places = new StubPlacesProvider({
		'category:bar': [
			{
				id: 'bar-1',
				name: 'Late Bar',
				location: { lat: 33.6804, lng: -117.8203 },
				address: 'Irvine, CA',
				types: ['bar']
			}
		],
		'category:cocktail bar': [
			{
				id: 'bar-1',
				name: 'Late Bar',
				location: { lat: 33.6804, lng: -117.8203 },
				address: 'Irvine, CA',
				types: ['bar']
			}
		],
		'category:night club': [
			{
				id: 'club-1',
				name: 'Night Club',
				location: { lat: 33.6807, lng: -117.8206 },
				address: 'Irvine, CA',
				types: ['night_club']
			}
		],
		'category:brewery': [],
		'category:live music venue': [],
		'category:pub': []
	});
	const routes = new StubRoutesProvider({});
	const nightlifeGrid = await createNightlifeGridForListings(listings, places);

	const result = await searchApartments({
		preferences,
		listings,
		providers: { places, routes },
		options: { nightlifeGrid }
	});

	assert.equal(result.mode, 'strict');
	assert.equal(result.ranked[0]?.listing.id, 'beta');
	assert.equal(result.ranked[1]?.listing.id, 'alpha');
	assert.ok(
		(result.ranked[0]?.derived_metrics.nightlife_intensity ?? 100) <
			(result.ranked[1]?.derived_metrics.nightlife_intensity ?? 0)
	);
	assert.ok(result.ranked.every((hit) => hit.derived_metrics.nightlife_cell_id));
	assert.equal(routes.calls.length, 0);
});

test('searchApartments ranks lively cells higher when the user wants nightlife', async () => {
	const preferences = createNightlifeProfile('lively');
	const listings = [
		createListing('alpha', { location: { lat: 33.6802, lng: -117.8202 } }),
		createListing('beta', { location: { lat: 33.707, lng: -117.792 } })
	];
	const places = new StubPlacesProvider({
		'category:bar': [
			{
				id: 'bar-1',
				name: 'Late Bar',
				location: { lat: 33.6804, lng: -117.8203 },
				address: 'Irvine, CA',
				types: ['bar']
			}
		],
		'category:cocktail bar': [],
		'category:night club': [
			{
				id: 'club-1',
				name: 'Night Club',
				location: { lat: 33.6807, lng: -117.8206 },
				address: 'Irvine, CA',
				types: ['night_club']
			}
		],
		'category:brewery': [],
		'category:live music venue': [],
		'category:pub': []
	});
	const routes = new StubRoutesProvider({});
	const nightlifeGrid = await createNightlifeGridForListings(listings, places);

	const result = await searchApartments({
		preferences,
		listings,
		providers: { places, routes },
		options: { nightlifeGrid }
	});

	assert.equal(result.mode, 'strict');
	assert.equal(result.ranked[0]?.listing.id, 'alpha');
	assert.equal(result.ranked[1]?.listing.id, 'beta');
	assert.ok(
		(result.ranked[0]?.derived_metrics.nightlife_intensity ?? 0) >
			(result.ranked[1]?.derived_metrics.nightlife_intensity ?? 100)
	);
});
