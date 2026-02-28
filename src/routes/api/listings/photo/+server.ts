import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getGooglePlacePhoto } from '$lib/server/google-maps';

const listingPhotoQuerySchema = z.object({
	placeId: z.string().trim().min(1)
});

export const GET: RequestHandler = async ({ url }) => {
	const parsed = listingPhotoQuerySchema.safeParse({
		placeId: url.searchParams.get('placeId')
	});

	if (!parsed.success) {
		return json(
			{
				message: 'A valid placeId query parameter is required.'
			},
			{ status: 400 }
		);
	}

	try {
		const photo = await getGooglePlacePhoto(parsed.data.placeId);

		return json(photo, {
			headers: {
				'cache-control': 'private, max-age=3600'
			}
		});
	} catch (error) {
		return json(
			{
				message:
					error instanceof Error ? error.message : 'Failed to load listing photo.'
			},
			{ status: 500 }
		);
	}
};
