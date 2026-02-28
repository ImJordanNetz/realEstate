import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const numberLikeSchema = z.union([z.number(), z.string()]);
const stringLikeSchema = z.union([z.string(), z.number()]);

const rapidApiCoordinateSchema = z
	.object({
		lat: numberLikeSchema.nullable().optional(),
		lon: numberLikeSchema.nullable().optional(),
		lng: numberLikeSchema.nullable().optional()
	})
	.passthrough();

const rapidApiAddressSchema = z
	.object({
		line: z.string().nullable().optional(),
		city: z.string().nullable().optional(),
		state_code: z.string().nullable().optional(),
		postal_code: stringLikeSchema.nullable().optional(),
		coordinate: rapidApiCoordinateSchema.nullable().optional()
	})
	.passthrough();

const rapidApiPhotoSchema = z
	.object({
		href: z.string().nullable().optional()
	})
	.passthrough();

const rapidApiDescriptionSchema = z
	.object({
		beds: numberLikeSchema.nullable().optional(),
		baths_consolidated: numberLikeSchema.nullable().optional(),
		sqft: numberLikeSchema.nullable().optional(),
		lot_sqft: numberLikeSchema.nullable().optional(),
		stories: numberLikeSchema.nullable().optional(),
		sold_date: z.string().nullable().optional(),
		sold_price: numberLikeSchema.nullable().optional()
	})
	.passthrough();

export const rapidApiForSaleRowSchema = z
	.object({
		property_id: stringLikeSchema.nullable().optional(),
		listing_id: stringLikeSchema.nullable().optional(),
		permalink: z.string().nullable().optional(),
		href: z.string().nullable().optional(),
		list_price: numberLikeSchema.nullable().optional(),
		status: z.string().nullable().optional(),
		is_pending: z.boolean().nullable().optional(),
		is_new_listing: z.boolean().nullable().optional(),
		is_price_reduced: z.boolean().nullable().optional(),
		is_new_construction: z.boolean().nullable().optional(),
		is_garage_present: z.boolean().nullable().optional(),
		address: rapidApiAddressSchema.nullable().optional(),
		primary_photo: rapidApiPhotoSchema.nullable().optional(),
		photos: z.array(rapidApiPhotoSchema).nullable().optional(),
		description: rapidApiDescriptionSchema.nullable().optional(),
		advertisers: z.array(z.unknown()).nullable().optional()
	})
	.passthrough();

export const homeSearchListingSchema = z.object({
	property_id: z.string(),
	listing_id: z.string().nullable(),
	address: z.string(),
	city: z.string().nullable(),
	state_code: z.string().nullable(),
	postal_code: z.string().nullable(),
	lat: z.number().nullable(),
	lng: z.number().nullable(),
	list_price: z.number().nonnegative().nullable(),
	beds: z.number().nonnegative().nullable(),
	baths: z.number().nonnegative().nullable(),
	sqft: z.number().nonnegative().nullable(),
	lot_sqft: z.number().nonnegative().nullable(),
	stories: z.number().nonnegative().nullable(),
	sold_date: z.string().nullable(),
	sold_price: z.number().nonnegative().nullable(),
	is_pending: z.boolean(),
	is_new_listing: z.boolean(),
	is_price_reduced: z.boolean(),
	is_new_construction: z.boolean(),
	has_garage: z.boolean().nullable(),
	photo_url: z.string().nullable(),
	href: z.string().nullable()
});

export const homeSearchCollectionSchema = z.array(homeSearchListingSchema);

export type RapidApiForSaleRow = z.infer<typeof rapidApiForSaleRowSchema>;
export type HomeSearchListing = z.infer<typeof homeSearchListingSchema>;

function toNullableString(value: unknown) {
	if (value == null) {
		return null;
	}

	const normalized = String(value).trim();
	return normalized.length ? normalized : null;
}

function toNullableNumber(value: unknown) {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}

	if (typeof value !== 'string') {
		return null;
	}

	const normalized = value.replace(/,/g, '').trim();

	if (!normalized.length) {
		return null;
	}

	const numeric = Number(normalized);
	return Number.isFinite(numeric) ? numeric : null;
}

function toNullableBathCount(value: unknown) {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}

	if (typeof value !== 'string') {
		return null;
	}

	const match = value.trim().match(/(\d+(?:\.\d+)?)/);

	if (!match) {
		return null;
	}

	const numeric = Number(match[1]);
	return Number.isFinite(numeric) ? numeric : null;
}

function toBooleanFlag(value: unknown, fallback = false) {
	if (typeof value === 'boolean') {
		return value;
	}

	if (typeof value === 'number') {
		return value !== 0;
	}

	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase();

		if (['true', '1', 'yes', 'y'].includes(normalized)) {
			return true;
		}

		if (['false', '0', 'no', 'n'].includes(normalized)) {
			return false;
		}
	}

	return fallback;
}

function buildDisplayAddress(row: RapidApiForSaleRow, propertyId: string) {
	const addressLine = row.address?.line?.trim() || null;
	const locality = [row.address?.city, row.address?.state_code, toNullableString(row.address?.postal_code)]
		.filter((value): value is string => !!value)
		.join(', ');

	if (addressLine && locality) {
		return `${addressLine}, ${locality}`;
	}

	if (addressLine) {
		return addressLine;
	}

	if (locality) {
		return locality;
	}

	return propertyId;
}

function pickPhotoUrl(row: RapidApiForSaleRow) {
	return row.primary_photo?.href?.trim() || row.photos?.find((photo) => photo.href?.trim())?.href?.trim() || null;
}

function listingCompletenessScore(listing: HomeSearchListing) {
	let score = 0;

	if (listing.listing_id) score += 1;
	if (listing.city) score += 1;
	if (listing.state_code) score += 1;
	if (listing.postal_code) score += 1;
	if (listing.lat != null && listing.lng != null) score += 4;
	if (listing.list_price != null) score += 4;
	if (listing.beds != null) score += 2;
	if (listing.baths != null) score += 2;
	if (listing.sqft != null) score += 2;
	if (listing.lot_sqft != null) score += 1;
	if (listing.stories != null) score += 1;
	if (listing.sold_date) score += 1;
	if (listing.sold_price != null) score += 1;
	if (listing.photo_url) score += 3;
	if (listing.href) score += 1;
	if (listing.has_garage != null) score += 1;
	if (listing.is_new_construction) score += 0.5;
	if (listing.is_new_listing) score += 0.5;
	if (listing.is_price_reduced) score += 0.25;

	return score;
}

function mergeHomeListings(current: HomeSearchListing, incoming: HomeSearchListing): HomeSearchListing {
	const preferred =
		listingCompletenessScore(incoming) > listingCompletenessScore(current) ? incoming : current;
	const fallback = preferred === incoming ? current : incoming;

	return homeSearchListingSchema.parse({
		property_id: preferred.property_id,
		listing_id: preferred.listing_id ?? fallback.listing_id,
		address: preferred.address !== preferred.property_id ? preferred.address : fallback.address,
		city: preferred.city ?? fallback.city,
		state_code: preferred.state_code ?? fallback.state_code,
		postal_code: preferred.postal_code ?? fallback.postal_code,
		lat: preferred.lat ?? fallback.lat,
		lng: preferred.lng ?? fallback.lng,
		list_price: preferred.list_price ?? fallback.list_price,
		beds: preferred.beds ?? fallback.beds,
		baths: preferred.baths ?? fallback.baths,
		sqft: preferred.sqft ?? fallback.sqft,
		lot_sqft: preferred.lot_sqft ?? fallback.lot_sqft,
		stories: preferred.stories ?? fallback.stories,
		sold_date: preferred.sold_date ?? fallback.sold_date,
		sold_price: preferred.sold_price ?? fallback.sold_price,
		is_pending: preferred.is_pending || fallback.is_pending,
		is_new_listing: preferred.is_new_listing || fallback.is_new_listing,
		is_price_reduced: preferred.is_price_reduced || fallback.is_price_reduced,
		is_new_construction: preferred.is_new_construction || fallback.is_new_construction,
		has_garage: preferred.has_garage ?? fallback.has_garage,
		photo_url: preferred.photo_url ?? fallback.photo_url,
		href: preferred.href ?? fallback.href
	});
}

export function extractRapidApiForSaleRows(payload: unknown): RapidApiForSaleRow[] {
	if (Array.isArray(payload)) {
		return payload.map((row) => rapidApiForSaleRowSchema.parse(row));
	}

	if (!payload || typeof payload !== 'object') {
		return [];
	}

	const candidate = payload as Record<string, unknown>;
	const nestedCollections = [
		candidate.results,
		candidate.data,
		candidate.data && typeof candidate.data === 'object'
			? (candidate.data as Record<string, unknown>).results
			: null,
		candidate.home_search && typeof candidate.home_search === 'object'
			? (candidate.home_search as Record<string, unknown>).results
			: null,
		candidate.data &&
		typeof candidate.data === 'object' &&
		(candidate.data as Record<string, unknown>).home_search &&
		typeof (candidate.data as Record<string, unknown>).home_search === 'object'
			? ((candidate.data as Record<string, unknown>).home_search as Record<string, unknown>).results
			: null,
		candidate.properties
	];

	for (const collection of nestedCollections) {
		if (!Array.isArray(collection)) {
			continue;
		}

		return collection.map((row) => rapidApiForSaleRowSchema.parse(row));
	}

	return [];
}

export function normalizeRapidApiForSaleRow(row: RapidApiForSaleRow): HomeSearchListing | null {
	const parsed = rapidApiForSaleRowSchema.parse(row);
	const propertyId = toNullableString(parsed.property_id);

	if (!propertyId) {
		return null;
	}

	const lat = toNullableNumber(parsed.address?.coordinate?.lat);
	const lng =
		toNullableNumber(parsed.address?.coordinate?.lon) ??
		toNullableNumber(parsed.address?.coordinate?.lng);

	return homeSearchListingSchema.parse({
		property_id: propertyId,
		listing_id: toNullableString(parsed.listing_id),
		address: buildDisplayAddress(parsed, propertyId),
		city: parsed.address?.city?.trim() || null,
		state_code: parsed.address?.state_code?.trim() || null,
		postal_code: toNullableString(parsed.address?.postal_code),
		lat,
		lng,
		list_price: toNullableNumber(parsed.list_price),
		beds: toNullableNumber(parsed.description?.beds),
		baths: toNullableBathCount(parsed.description?.baths_consolidated),
		sqft: toNullableNumber(parsed.description?.sqft),
		lot_sqft: toNullableNumber(parsed.description?.lot_sqft),
		stories: toNullableNumber(parsed.description?.stories),
		sold_date: parsed.description?.sold_date?.trim() || null,
		sold_price: toNullableNumber(parsed.description?.sold_price),
		is_pending: toBooleanFlag(parsed.is_pending, false),
		is_new_listing: toBooleanFlag(parsed.is_new_listing, false),
		is_price_reduced: toBooleanFlag(parsed.is_price_reduced, false),
		is_new_construction: toBooleanFlag(parsed.is_new_construction, false),
		has_garage:
			parsed.is_garage_present == null ? null : toBooleanFlag(parsed.is_garage_present, false),
		photo_url: pickPhotoUrl(parsed),
		href: parsed.href?.trim() || parsed.permalink?.trim() || null
	});
}

export function normalizeRapidApiForSalePayload(payload: unknown): HomeSearchListing[] {
	const deduped = new Map<string, HomeSearchListing>();

	for (const row of extractRapidApiForSaleRows(payload)) {
		const normalized = normalizeRapidApiForSaleRow(row);

		if (!normalized) {
			continue;
		}

		const existing = deduped.get(normalized.property_id);
		deduped.set(
			normalized.property_id,
			existing ? mergeHomeListings(existing, normalized) : normalized
		);
	}

	return [...deduped.values()];
}

export function dedupeHomeListings(listings: HomeSearchListing[]) {
	const deduped = new Map<string, HomeSearchListing>();

	for (const listing of listings) {
		const existing = deduped.get(listing.property_id);
		deduped.set(listing.property_id, existing ? mergeHomeListings(existing, listing) : listing);
	}

	return [...deduped.values()];
}

export function getRapidApiForSaleRawDir() {
	return join(process.cwd(), 'src/lib/server/data/rapidapi-for-sale-raw');
}

export function getRapidApiForSaleMetaPath() {
	return join(process.cwd(), 'src/lib/server/data/rapidapi-for-sale-meta.json');
}

export function getDefaultOrangeCountyHomesPath() {
	return join(process.cwd(), 'src/lib/server/data/orange-county-homes.json');
}

export function loadOrangeCountyHomes(filePath = getDefaultOrangeCountyHomesPath()) {
	const raw = readFileSync(filePath, 'utf-8');
	return homeSearchCollectionSchema.parse(JSON.parse(raw));
}

export function loadAllRapidApiForSaleRawListings(rawDir = getRapidApiForSaleRawDir()) {
	if (!existsSync(rawDir)) {
		return [];
	}

	const normalized: HomeSearchListing[] = [];

	for (const file of readdirSync(rawDir).filter((entry) => entry.endsWith('.json'))) {
		const raw = readFileSync(join(rawDir, file), 'utf-8');
		normalized.push(...normalizeRapidApiForSalePayload(JSON.parse(raw)));
	}

	return dedupeHomeListings(normalized);
}
