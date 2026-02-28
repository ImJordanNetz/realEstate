import type { PageServerLoad } from './$types';
import { loadIrvineRentcastListings } from '$lib/server/apartment-inventory';

export type MapListing = {
	id: string;
	address: string;
	lat: number;
	lng: number;
	placeId: string | null;
	bedrooms: number | null;
	bathrooms: number | null;
	sqft: number | null;
	price: number | null;
};

function loadListings(): MapListing[] {
	try {
		return loadIrvineRentcastListings().map((listing) => ({
			id: listing.id,
			address: listing.address,
			lat: listing.location.lat,
			lng: listing.location.lng,
			placeId: listing.place_id,
			bedrooms: listing.bedrooms,
			bathrooms: listing.bathrooms,
			sqft: listing.sqft,
			price: listing.rent
		}));
	} catch {
		return [];
	}
}

const listings = loadListings();

export const load: PageServerLoad = async ({ url }) => {
	const prompt = url.searchParams.get('prompt')?.trim() ?? '';

	return {
		prompt,
		listings
	};
};
