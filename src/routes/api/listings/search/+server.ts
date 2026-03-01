import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { apartmentPreferenceLenientSchema } from '$lib/server/apartment-preferences';
import { loadAllRentcastListings } from '$lib/server/apartment-inventory';
import { searchApartments } from '$lib/server/apartment-search';
import { createGoogleMapsProviders } from '$lib/server/google-maps';

const apartmentSearchRequestSchema = z.object({
	preferences: apartmentPreferenceLenientSchema
});

const SEARCH_RESULT_BUFFER_SIZE = 48;

export const POST: RequestHandler = async ({ request }) => {
	const requestId = crypto.randomUUID().slice(0, 8);
	const startedAt = Date.now();
	const log = (scope: string, step: string, details?: Record<string, unknown>) => {
		console.info(`[apartment-search:${requestId}] ${scope}.${step}`, details ?? {});
	};
	let payload: unknown;

	try {
		payload = await request.json();
	} catch (error) {
		log('api', 'invalid_json', {
			contentType: request.headers.get('content-type'),
			contentLength: request.headers.get('content-length'),
			message: error instanceof Error ? error.message : 'Failed to parse request body.'
		});
		return json({ message: 'Request body must be valid JSON.' }, { status: 400 });
	}

	const parsed = apartmentSearchRequestSchema.safeParse(payload);

	if (!parsed.success) {
		log('api', 'invalid_payload', {
			issues: parsed.error.issues.length,
			details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
		});
		return json(
			{
				message: 'Invalid apartment search request.',
				issues: parsed.error.flatten()
			},
			{ status: 400 }
		);
	}

	try {
		const listings = loadAllRentcastListings();
		log('api', 'request_received', {
			listings: listings.length,
			hasCommute: !!parsed.data.preferences.commute,
			constraints: parsed.data.preferences.constraints.length
		});
		const result = await searchApartments({
			preferences: parsed.data.preferences,
			listings,
			providers: createGoogleMapsProviders(log),
			options: {
				ranking: {
					maxResults: SEARCH_RESULT_BUFFER_SIZE
				}
			},
			logger: log
		});
		log('api', 'request_complete', {
			mode: result.mode,
			results: result.ranked.length,
			durationMs: Date.now() - startedAt
		});

		return json(result);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Failed to search apartments.';
		log('api', 'request_failed', {
			message,
			durationMs: Date.now() - startedAt
		});

		return json(
			{
				message
			},
			{ status: 500 }
		);
	}
};
