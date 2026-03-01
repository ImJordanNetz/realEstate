import { z } from 'zod';
import irvineApartments from '$lib/server/data/rentcast-raw/irvine-apartments.json';
import anaheimApartments from '$lib/server/data/rentcast-raw/anaheim-apartments.json';
import costaMesaApartments from '$lib/server/data/rentcast-raw/costa-mesa-apartments.json';
import santaAnaApartments from '$lib/server/data/rentcast-raw/santa-ana-apartments.json';
import googlePlaceIdsData from '$lib/server/data/google-place-ids.json';

export const apartmentLocationSchema = z.object({
	lat: z.number(),
	lng: z.number()
});

export const parkingSchema = z.object({
	available: z.boolean(),
	type: z.enum(['garage', 'covered', 'surface', 'street', 'none']).nullable()
});

export const petsPolicySchema = z.object({
	allowed: z.boolean(),
	pet_types: z.array(z.string()).nullable()
});

export const apartmentInventoryListingSchema = z.object({
	id: z.string(),
	title: z.string(),
	address: z.string(),
	location: apartmentLocationSchema,
	place_id: z.string().nullable(),
	source: z.literal('rentcast'),
	property_type: z.string().nullable(),
	status: z.string(),
	rent: z.number().nonnegative().nullable(),
	bedrooms: z.number().nonnegative().nullable(),
	bathrooms: z.number().nonnegative().nullable(),
	sqft: z.number().nonnegative().nullable(),
	listed_date: z.string().nullable(),
	furnished: z.boolean().nullable(),
	parking: parkingSchema.nullable(),
	laundry: z.enum(['in_unit', 'on_site', 'none']).nullable(),
	pets: petsPolicySchema.nullable(),
	amenities: z.array(z.string()),
	lease_length_months: z.number().int().positive().nullable()
});

export const apartmentInventoryCollectionSchema = z.array(apartmentInventoryListingSchema);

export const googlePlaceMatchSchema = z.object({
	placeId: z.string().nullable(),
	propertyKey: z.string(),
	matchedName: z.string().nullable(),
	matchedAddress: z.string().nullable(),
	primaryType: z.string().nullable(),
	googleMapsUri: z.string().nullable(),
	matchMethod: z.enum(['nearby', 'text', 'unmatched']),
	confidence: z.number().min(0).max(1).nullable(),
	updatedAt: z.string()
});

export const googlePlaceIdStoreSchema = z.object({
	version: z.literal(1),
	updatedAt: z.string(),
	matches: z.record(z.string(), googlePlaceMatchSchema)
});

export const rentcastListingSchema = z.object({
	id: z.string(),
	formattedAddress: z.string(),
	addressLine1: z.string().optional(),
	addressLine2: z.string().nullable().optional(),
	city: z.string(),
	state: z.string(),
	zipCode: z.string(),
	county: z.string().optional(),
	latitude: z.number(),
	longitude: z.number(),
	propertyType: z.string().nullable().optional(),
	bedrooms: z.number().nonnegative().nullable().optional(),
	bathrooms: z.number().nonnegative().nullable().optional(),
	squareFootage: z.number().nonnegative().nullable().optional(),
	status: z.string(),
	price: z.number().nonnegative().nullable(),
	listingType: z.string().nullable().optional(),
	listedDate: z.string().nullable().optional(),
	removedDate: z.string().nullable().optional(),
	createdDate: z.string().nullable().optional(),
	lastSeenDate: z.string().nullable().optional(),
	daysOnMarket: z.number().nonnegative().nullable().optional(),
	history: z.record(z.string(), z.unknown()).optional()
});

export const rentcastListingCollectionSchema = z.array(rentcastListingSchema);

export type ApartmentInventoryListing = z.infer<typeof apartmentInventoryListingSchema>;
export type RentcastListing = z.infer<typeof rentcastListingSchema>;
export type GooglePlaceMatch = z.infer<typeof googlePlaceMatchSchema>;
export type GooglePlaceIdStore = z.infer<typeof googlePlaceIdStoreSchema>;

export function normalizeRentcastListing(
	listing: RentcastListing,
	placeMatch?: GooglePlaceMatch
): ApartmentInventoryListing {
	return apartmentInventoryListingSchema.parse({
		id: listing.id,
		title: listing.addressLine1?.trim() || listing.formattedAddress,
		address: listing.formattedAddress,
		location: {
			lat: listing.latitude,
			lng: listing.longitude
		},
		place_id: placeMatch?.placeId ?? null,
		source: 'rentcast',
		property_type: listing.propertyType ?? null,
		status: listing.status,
		rent: listing.price ?? null,
		bedrooms: listing.bedrooms ?? null,
		bathrooms: listing.bathrooms ?? null,
		sqft: listing.squareFootage ?? null,
		listed_date: listing.listedDate ?? null,
		furnished: null,
		parking: null,
		laundry: null,
		pets: null,
		amenities: [],
		lease_length_months: null
	});
}

export function createEmptyGooglePlaceIdStore(): GooglePlaceIdStore {
	return {
		version: 1,
		updatedAt: new Date(0).toISOString(),
		matches: {}
	};
}

export function loadGooglePlaceIdStore(): GooglePlaceIdStore {
	try {
		return googlePlaceIdStoreSchema.parse(googlePlaceIdsData);
	} catch {
		return createEmptyGooglePlaceIdStore();
	}
}

function normalizeRentcastCollection(
	data: unknown[],
	googlePlaces: GooglePlaceIdStore
): ApartmentInventoryListing[] {
	const parsed = rentcastListingCollectionSchema.parse(data);
	return parsed
		.filter((listing) => listing.status === 'Active' && !!listing.latitude && !!listing.longitude)
		.map((listing) => normalizeRentcastListing(listing, googlePlaces.matches[listing.id]));
}

export function loadAllRentcastListings(): ApartmentInventoryListing[] {
	const googlePlaces = loadGooglePlaceIdStore();
	const allRaw = [irvineApartments, anaheimApartments, costaMesaApartments, santaAnaApartments];
	const all: ApartmentInventoryListing[] = [];
	for (const data of allRaw) {
		all.push(...normalizeRentcastCollection(data, googlePlaces));
	}
	return all;
}
