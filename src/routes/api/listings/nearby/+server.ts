import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { createGooglePlacesProvider } from '$lib/server/google-maps';

const requestSchema = z.object({
	lat: z.number(),
	lng: z.number()
});

const POI_CATEGORIES = [
	{ key: 'grocery', query: 'grocery store', type: 'grocery_store' },
	{ key: 'nightlife', query: 'bar', type: 'bar' },
	{ key: 'park', query: 'parks', type: 'park' },
	{ key: 'hospital', query: 'hospital', type: 'hospital' }
] as const;

const SEARCH_RADIUS_METERS = 3000;

export const POST: RequestHandler = async ({ request }) => {
	let payload: unknown;
	try {
		payload = await request.json();
	} catch {
		return json({ message: 'Request body must be valid JSON.' }, { status: 400 });
	}

	const parsed = requestSchema.safeParse(payload);
	if (!parsed.success) {
		return json(
			{ message: 'Invalid nearby request.', issues: parsed.error.flatten() },
			{ status: 400 }
		);
	}

	const { lat, lng } = parsed.data;
	const placesProvider = createGooglePlacesProvider();

	try {
		const results = await Promise.all(
			POI_CATEGORIES.map(async (category) => {
				const places = await placesProvider.search({
					query: category.query,
					searchType: 'category',
					maxResults: 5,
					region: {
						center: { lat, lng },
						radius_meters: SEARCH_RADIUS_METERS,
						bounds: {
							south: lat - 0.027,
							north: lat + 0.027,
							west: lng - 0.033,
							east: lng + 0.033
						}
					}
				});

				return {
					category: category.key,
					places: places.map((p) => ({
						id: p.id,
						name: p.name,
						lat: p.location.lat,
						lng: p.location.lng,
						address: p.address
					}))
				};
			})
		);

		const pois: Record<string, Array<{ id: string; name: string; lat: number; lng: number; address: string | null }>> = {};
		for (const r of results) {
			pois[r.category] = r.places;
		}

		return json({ pois });
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Failed to fetch nearby places.';
		return json({ message }, { status: 500 });
	}
};
