import { dev } from '$app/environment';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	apartmentPreferenceInputSchema,
	apartmentPreferenceExtractionSchema,
	apartmentPreferenceSchema,
	extractApartmentPreferences,
	getApartmentPreferenceModel
} from '$lib/server/apartment-preferences';
import { z } from 'zod';

function getErrorDetails(err: unknown) {
	if (err instanceof Error) {
		return {
			message: err.message,
			name: err.name,
			stack: dev ? err.stack : undefined,
			cause:
				err.cause instanceof Error
					? {
							message: err.cause.message,
							name: err.cause.name
						}
					: err.cause
		};
	}

	return {
		message: 'Unknown error',
		value: err
	};
}

export const GET: RequestHandler = async () => {
	return json({
		endpoint: '/api/preferences/extract',
		methods: ['GET', 'POST'],
		requestBody: z.toJSONSchema(apartmentPreferenceInputSchema),
		profileSchema: z.toJSONSchema(apartmentPreferenceSchema),
		responseBody: z.toJSONSchema(apartmentPreferenceExtractionSchema),
		defaultModel: getApartmentPreferenceModel()
	});
};

export const POST: RequestHandler = async ({ request }) => {
	let payload: unknown;

	try {
		payload = await request.json();
	} catch {
		error(400, 'Request body must be valid JSON.');
	}

	const parsed = apartmentPreferenceInputSchema.safeParse(payload);

	if (!parsed.success) {
		return json(
			{
				message: 'Invalid request body.',
				issues: parsed.error.flatten()
			},
			{ status: 400 }
		);
	}

	try {
		const result = await extractApartmentPreferences(parsed.data);
		return json(result);
	} catch (err) {
		if (
			err instanceof Error &&
			err.message.includes('must set exactly one of boolean_value, number_value, or string_value')
		) {
			error(400, err.message);
		}

		if (err instanceof Error && err.message === 'OPENROUTER_API_KEY is not configured.') {
			error(500, err.message);
		}

		console.error('Failed to extract apartment preferences.', err);
		return json(
			{
				message: 'Failed to extract apartment preferences.',
				details: dev ? getErrorDetails(err) : undefined
			},
			{ status: 500 }
		);
	}
};
