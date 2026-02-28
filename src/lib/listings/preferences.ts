import type {
	ApartmentPreferenceExtractionResponse,
	ApartmentPreferences
} from '$lib/server/apartment-preferences';

export type ExtractionError = {
	message: string;
	status: number;
};

export type ClarificationAnswerValue = string | boolean | number;
export type ClarificationAnswerMap = Record<string, ClarificationAnswerValue>;
export type ClarificationQuestion =
	ApartmentPreferenceExtractionResponse['preferences']['clarification_questions'][number];
export type ClarificationAnswer =
	ApartmentPreferenceExtractionResponse['clarification_answers'][number];
type MutablePathContainer = Record<string | number, unknown>;

type ExtractionRequest = {
	prompt: string;
	clarificationAnswers?: ApartmentPreferenceExtractionResponse['clarification_answers'];
	signal?: AbortSignal;
	fetcher?: typeof fetch;
};

const EMPTY_CLARIFICATION_ANSWERS: ApartmentPreferenceExtractionResponse['clarification_answers'] =
	[];

export function getExtractionErrorMessage(payload: unknown): string {
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

export async function requestListingPreferenceExtraction({
	prompt,
	clarificationAnswers = EMPTY_CLARIFICATION_ANSWERS,
	signal,
	fetcher = fetch
}: ExtractionRequest) {
	const response = await fetcher('/api/preferences/extract', {
		method: 'POST',
		headers: {
			'content-type': 'application/json'
		},
		body: JSON.stringify({
			prompt,
			clarification_answers: clarificationAnswers
		}),
		signal
	});

	const payload: unknown = await response.json().catch(() => null);

	return { response, payload };
}

export function toClarificationAnswers(
	questions: ClarificationQuestion[],
	answers: ClarificationAnswerMap
): ApartmentPreferenceExtractionResponse['clarification_answers'] {
	return questions.flatMap((question): ClarificationAnswer[] => {
		if (!(question.id in answers)) {
			return [];
		}

		const value = answers[question.id];

		if (question.response_type === 'boolean' && typeof value === 'boolean') {
			return [{ id: question.id, boolean_value: value }];
		}

		if (question.response_type === 'number' && typeof value === 'number') {
			return [{ id: question.id, number_value: value }];
		}

		if (question.response_type === 'single_select' && typeof value === 'string') {
			return [{ id: question.id, string_value: value }];
		}

		return [];
	});
}

function setValueAtPath(target: Record<string, unknown>, path: string, value: ClarificationAnswerValue) {
	const segments = path
		.replace(/\[(\d+)\]/g, '.$1')
		.split('.')
		.filter(Boolean);

	if (!segments.length) {
		return;
	}

	let current: unknown = target;

	for (const [index, segment] of segments.slice(0, -1).entries()) {
		const nextSegment = segments[index + 1];
		const currentIsArray = Array.isArray(current);
		const segmentKey = currentIsArray ? Number.parseInt(segment, 10) : segment;

		if (
			current == null ||
			(typeof current !== 'object' && !Array.isArray(current)) ||
			(currentIsArray && Number.isNaN(segmentKey))
		) {
			return;
		}

		const container = current as MutablePathContainer;
		const nextValue = container[segmentKey];
		const shouldCreateArray = /^\d+$/.test(nextSegment ?? '');

		if (!nextValue || typeof nextValue !== 'object') {
			container[segmentKey] = shouldCreateArray ? [] : {};
		}

		current = container[segmentKey];
	}

	if (current == null || (typeof current !== 'object' && !Array.isArray(current))) {
		return;
	}

	const finalSegment = segments[segments.length - 1];
	const finalKey = Array.isArray(current) ? Number.parseInt(finalSegment, 10) : finalSegment;

	if (Array.isArray(current) && Number.isNaN(finalKey)) {
		return;
	}

	(current as MutablePathContainer)[finalKey] = value;
}

export function applyClarificationAnswersToProfile(
	profile: ApartmentPreferences,
	questions: ClarificationQuestion[],
	answers: ClarificationAnswerMap
) {
	const updatedProfile = JSON.parse(JSON.stringify(profile)) as ApartmentPreferences;

	for (const question of questions) {
		if (!(question.id in answers)) {
			continue;
		}

		setValueAtPath(updatedProfile as Record<string, unknown>, question.field_path, answers[question.id]);
	}

	return updatedProfile;
}

export function finalizeExtractionWithClarifications(
	result: ApartmentPreferenceExtractionResponse,
	answers: ClarificationAnswerMap
): ApartmentPreferenceExtractionResponse {
	const questions = result.preferences.clarification_questions;
	const clarificationAnswers = toClarificationAnswers(questions, answers);
	const updatedProfile = applyClarificationAnswersToProfile(
		result.preferences.profile,
		questions,
		answers
	);

	return {
		...result,
		clarification_answers: clarificationAnswers,
		preferences: {
			...result.preferences,
			status: 'complete',
			profile: updatedProfile,
			clarification_questions: []
		}
	};
}
