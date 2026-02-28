import type { ApartmentPreferences } from '$lib/server/apartment-preferences';
import type { ApartmentSearchResult } from '$lib/server/apartment-search';

export type ApartmentSearchResponse = ApartmentSearchResult;
export type ApartmentSearchError = {
	message: string;
	status: number;
};

export function getApartmentSearchErrorMessage(payload: unknown) {
	if (
		payload &&
		typeof payload === 'object' &&
		'message' in payload &&
		typeof payload.message === 'string'
	) {
		return payload.message;
	}

	return 'Failed to rank apartments.';
}

export async function requestApartmentSearch(params: {
	preferences: ApartmentPreferences;
	signal?: AbortSignal;
	fetcher?: typeof fetch;
}) {
	const response = await (params.fetcher ?? fetch)('/api/listings/search', {
		method: 'POST',
		headers: {
			'content-type': 'application/json'
		},
		body: JSON.stringify({
			preferences: params.preferences
		}),
		signal: params.signal
	});
	const payload: unknown = await response.json().catch(() => null);

	return {
		response,
		payload: payload as ApartmentSearchResult | { message?: string } | null
	};
}
