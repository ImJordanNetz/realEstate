import assert from 'node:assert/strict';
import test from 'node:test';
import {
	apartmentPreferenceExtractionSchema,
	apartmentPreferenceInputSchema,
	apartmentPreferenceLenientSchema,
	clarificationQuestionSchema
} from '../src/lib/server/apartment-preferences';

test('apartmentPreferenceLenientSchema normalizes malformed partial profile data', () => {
	const parsed = apartmentPreferenceLenientSchema.parse({
		budget: {
			max_rent: 'Infinity',
			ideal_rent: '$2,500'
		},
		nightlife: {
			preference: ' peaceful '
		},
		commute: {
			search_query: ' UCI ',
			max_minutes: '15'
		},
		constraints: [
			{
				label: ' ',
				search_query: 'park'
			},
			{
				label: ' Grocery store ',
				search_query: ' grocery store ',
				search_type: true,
				travel_mode: ' DRIVING ',
				is_dealbreaker: 'no'
			}
		],
		unit_requirements: {
			bedrooms: {
				min: '3',
				max: '2'
			},
			pets: {
				pet_types: [' cat ', '', 5]
			},
			parking: {
				type_preference: 'carport'
			},
			laundry: {
				preference: 'in-unit'
			},
			furnished: {
				preferred: 'maybe'
			},
			sqft: {
				min: '-10',
				max: '900'
			},
			amenities: [
				{
					name: ' pool ',
					importance: '1.5'
				},
				{
					name: ' '
				}
			]
		},
		raw_input: true
	});

	assert.equal(parsed.budget.max_rent, null);
	assert.equal(parsed.budget.ideal_rent, 2500);
	assert.equal(parsed.nightlife?.preference, 'quiet');
	assert.equal(parsed.commute?.search_query, 'UCI');
	assert.equal(parsed.commute?.travel_mode, 'drive');
	assert.equal(parsed.commute?.max_minutes, 15);
	assert.equal(parsed.constraints.length, 1);
	assert.equal(parsed.constraints[0]?.label, 'Grocery store');
	assert.equal(parsed.constraints[0]?.search_query, 'grocery store');
	assert.equal(parsed.constraints[0]?.search_type, 'category');
	assert.equal(parsed.constraints[0]?.travel_mode, 'drive');
	assert.equal(parsed.constraints[0]?.is_dealbreaker, false);
	assert.equal(parsed.unit_requirements?.bedrooms?.min, 2);
	assert.equal(parsed.unit_requirements?.bedrooms?.max, 3);
	assert.equal(parsed.unit_requirements?.pets?.allowed, true);
	assert.deepEqual(parsed.unit_requirements?.pets?.pet_types, ['cat']);
	assert.equal(parsed.unit_requirements?.parking?.required, true);
	assert.equal(parsed.unit_requirements?.parking?.type_preference, 'covered');
	assert.equal(parsed.unit_requirements?.laundry?.preference, 'in_unit');
	assert.equal(parsed.unit_requirements?.furnished, null);
	assert.equal(parsed.unit_requirements?.sqft?.min, null);
	assert.equal(parsed.unit_requirements?.sqft?.max, 900);
	assert.equal(parsed.unit_requirements?.amenities?.length, 1);
	assert.equal(parsed.unit_requirements?.amenities?.[0]?.name, 'pool');
	assert.equal(parsed.unit_requirements?.amenities?.[0]?.importance, 1);
	assert.equal(parsed.raw_input, '');
});

test('apartmentPreferenceInputSchema accepts lenient current profiles', () => {
	const parsed = apartmentPreferenceInputSchema.parse({
		prompt: 'Find me a place near UCI.',
		current_profile: {
			budget: {
				ideal_rent: '2400'
			},
			constraints: 'none',
			unit_requirements: {
				parking: {
					type_preference: 'garage'
				}
			},
			raw_input: null
		}
	});

	assert.equal(parsed.current_profile?.budget.max_rent, null);
	assert.equal(parsed.current_profile?.budget.ideal_rent, 2400);
	assert.deepEqual(parsed.current_profile?.constraints, []);
	assert.equal(parsed.current_profile?.unit_requirements?.parking?.required, true);
	assert.equal(parsed.current_profile?.unit_requirements?.parking?.type_preference, 'garage');
	assert.equal(parsed.current_profile?.raw_input, '');
});

test('apartmentPreferenceExtractionSchema backfills partial extraction profiles', () => {
	const parsed = apartmentPreferenceExtractionSchema.parse({
		status: 'complete',
		profile: {
			budget: {},
			constraints: 'none',
			unit_requirements: {
				laundry: {
					preference: 'shared'
				}
			},
			raw_input: null
		},
		clarification_questions: []
	});

	assert.equal(parsed.profile.budget.max_rent, null);
	assert.equal(parsed.profile.unit_requirements?.laundry?.preference, 'on_site');
	assert.deepEqual(parsed.profile.constraints, []);
	assert.equal(parsed.profile.raw_input, '');
});

test('clarificationQuestionSchema rejects unsupported clarification paths', () => {
	assert.throws(
		() =>
			clarificationQuestionSchema.parse({
				id: 'unsafe',
				field_path: '__proto__.polluted',
				question: 'Unsafe?',
				response_type: 'boolean',
				options: null,
				unit: null,
				why_asked: 'Never'
			}),
		/supported profile field/
	);
});

test('apartmentPreferenceExtractionSchema enforces status and question consistency', () => {
	assert.throws(
		() =>
			apartmentPreferenceExtractionSchema.parse({
				status: 'needs_clarification',
				profile: {
					budget: {},
					constraints: [],
					raw_input: ''
				},
				clarification_questions: []
			}),
		/at least one question/
	);

	assert.throws(
		() =>
			clarificationQuestionSchema.parse({
				id: 'parking_type',
				field_path: 'unit_requirements.parking.type_preference',
				question: 'What kind of parking do you want?',
				response_type: 'single_select',
				options: null,
				unit: null,
				why_asked: 'Parking affects ranking.'
			}),
		/2 to 6 options/
	);
});
