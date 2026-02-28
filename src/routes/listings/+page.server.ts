import type { PageServerLoad } from './$types';
import { loadAllRentcastListings } from '$lib/server/apartment-inventory';
import { loadDefaultNightlifeGrid } from '$lib/server/nightlife-grid';

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
		return loadAllRentcastListings().map((listing) => ({
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

function loadNightlifeCells(): { lat: number; lng: number; intensity: number }[] {
	try {
		const grid = loadDefaultNightlifeGrid();
		return grid.cells
			.filter((cell) => cell.intensity > 0)
			.map((cell) => ({
				lat: cell.center.lat,
				lng: cell.center.lng,
				intensity: cell.intensity
			}));
	} catch {
		return [];
	}
}

const nightlifeCells = loadNightlifeCells();

export const load: PageServerLoad = async ({ url }) => {
	const prompt = url.searchParams.get('prompt')?.trim() ?? '';

	return {
		prompt,
		listings,
		nightlifeCells
	};
};
