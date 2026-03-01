import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createAssistantExtractionMessage,
	createClarificationAnswerMessage,
	requestListingPreferenceExtraction,
	type ClarificationQuestion
} from '../src/lib/listings/preferences';
import type {
	ApartmentPreferenceExtractionResponse,
	ApartmentPreferences
} from '../src/lib/server/apartment-preferences';

function createProfile() {
	return {
		budget: {
			max_rent: 3500,
			ideal_rent: 3200
		},
		nightlife: {
			preference: 'quiet',
			is_dealbreaker: false,
			importance: 0.55
		},
		commute: {
			search_query: 'University of California, Irvine',
			travel_mode: 'bike',
			max_minutes: 12,
			is_dealbreaker: true,
			importance: 0.95
		},
		constraints: [
			{
				label: 'Climbing gym',
				search_query: 'rock climbing gym',
				search_type: 'category',
				travel_mode: 'drive',
				max_minutes: 15,
				is_dealbreaker: false,
				importance: 0.6
			}
		],
		unit_requirements: {
			bedrooms: {
				min: 1,
				max: 2,
				is_dealbreaker: false,
				importance: 0.4
			},
			bathrooms: null,
			pets: null,
			parking: {
				required: true,
				type_preference: 'covered',
				is_dealbreaker: true,
				importance: 1
			},
			laundry: null,
			furnished: null,
			sqft: null,
			lease_length_months: null,
			amenities: null
		},
		raw_input: 'Quiet place near UCI with covered parking'
	} satisfies ApartmentPreferences;
}

function createExtractionResponse(): ApartmentPreferenceExtractionResponse {
	return {
		model: 'openai/gpt-5.2',
		requested_model: 'openai/gpt-5.2',
		preferences: {
			status: 'needs_clarification',
			profile: createProfile(),
			clarification_questions: [
				{
					id: 'budget_cap',
					field_path: 'budget.max_rent',
					question: 'What is the highest monthly rent you can accept?',
					response_type: 'number',
					options: null,
					unit: 'usd',
					why_asked: 'Rent cap changes which listings remain viable.'
				}
			]
		},
		clarification_answers: [],
		usage: null,
		openrouter: null
	};
}

test('requestListingPreferenceExtraction sends message history and current profile', async () => {
	const currentProfile = createProfile();
	const messageHistory = [
		{
			role: 'user' as const,
			content: 'I want a quiet apartment near UCI.'
		},
		{
			role: 'assistant' as const,
			content: 'Status: complete\nStructured apartment preference JSON:\n{}'
		}
	];

	let capturedBody: Record<string, unknown> | null = null;

	await requestListingPreferenceExtraction({
		prompt: 'Raise my max budget to 3800 and make nightlife less important.',
		messageHistory,
		currentProfile,
		clarificationAnswers: [{ id: 'budget_cap', number_value: 3500 }],
		fetcher: async (_input, init) => {
			capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<
				string,
				unknown
			>;

			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: {
					'content-type': 'application/json'
				}
			});
		}
	});

	assert.ok(capturedBody);
	const body = capturedBody as Record<string, unknown>;
	assert.equal(
		body.prompt,
		'Raise my max budget to 3800 and make nightlife less important.'
	);
	assert.deepEqual(body.message_history, messageHistory);
	assert.deepEqual(body.current_profile, currentProfile);
	assert.deepEqual(body.clarification_answers, [
		{ id: 'budget_cap', number_value: 3500 }
	]);
});

test('createAssistantExtractionMessage keeps the JSON snapshot and clarifying questions', () => {
	const message = createAssistantExtractionMessage(createExtractionResponse());

	assert.equal(message.role, 'assistant');
	assert.match(message.content, /Structured apartment preference JSON:/);
	assert.match(message.content, /"max_rent": 3500/);
	assert.match(
		message.content,
		/What is the highest monthly rent you can accept\?/
	);
});

test('createClarificationAnswerMessage summarizes answered questions', () => {
	const questions = [
		{
			id: 'budget_cap',
			field_path: 'budget.max_rent',
			question: 'What is the highest monthly rent you can accept?',
			response_type: 'number',
			options: null,
			unit: 'usd',
			why_asked: 'Needed for ranking'
		}
	] satisfies ClarificationQuestion[];

	const message = createClarificationAnswerMessage(questions, {
		budget_cap: 3800
	});

	assert.equal(message.role, 'user');
	assert.match(message.content, /Clarification answers:/);
	assert.match(
		message.content,
		/What is the highest monthly rent you can accept\?: 3800/
	);
});
