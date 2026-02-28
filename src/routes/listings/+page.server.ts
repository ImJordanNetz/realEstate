import type { PageServerLoad } from './$types';
import type { ApartmentPreferenceExtractionResponse } from '$lib/server/apartment-preferences';

type ExtractionError = {
	message: string;
	status: number;
};

function getErrorMessage(payload: unknown): string {
	if (
		payload &&
		typeof payload === 'object' &&
		'message' in payload &&
		typeof payload.message === 'string'
	) {
		return payload.message;
	}

	return 'Failed to extract listing preferences.';
}

export const load: PageServerLoad = async ({ fetch, url }) => {
	const prompt = url.searchParams.get('prompt')?.trim() ?? '';

	if (!prompt) {
		return {
			prompt,
			result: null,
			apiError: null
		};
	}

	const response = await fetch('/api/preferences/extract', {
		method: 'POST',
		headers: {
			'content-type': 'application/json'
		},
		body: JSON.stringify({ prompt })
	});

	const payload: unknown = await response.json().catch(() => null);

	if (!response.ok) {
		return {
			prompt,
			result: null,
			apiError: {
				message: getErrorMessage(payload),
				status: response.status
			} satisfies ExtractionError
		};
	}

	return {
		prompt,
		result: payload as ApartmentPreferenceExtractionResponse,
		apiError: null
	};
};
