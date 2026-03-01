import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { fetchDirectionsPolyline } from '$lib/server/google-maps';

const travelModeSchema = z.enum(['drive', 'transit', 'walk', 'bike']);

const requestSchema = z.object({
	origin: z.object({
		lat: z.number(),
		lng: z.number()
	}),
	destinations: z.array(
		z.object({
			id: z.string(),
			lat: z.number(),
			lng: z.number(),
			travelMode: travelModeSchema
		})
	)
});

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
			{ message: 'Invalid directions request.', issues: parsed.error.flatten() },
			{ status: 400 }
		);
	}

	const { origin, destinations } = parsed.data;

	try {
		const results = await Promise.all(
			destinations.map(async (dest) => {
				const encodedPolyline = await fetchDirectionsPolyline({
					origin,
					destination: { lat: dest.lat, lng: dest.lng },
					travelMode: dest.travelMode
				});

				return {
					id: dest.id,
					encodedPolyline
				};
			})
		);

		return json({ routes: results });
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Failed to fetch directions.';
		return json({ message }, { status: 500 });
	}
};
