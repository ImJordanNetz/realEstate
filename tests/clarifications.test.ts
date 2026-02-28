import assert from 'node:assert/strict';
import test from 'node:test';
import { applyClarificationAnswersToProfile } from '../src/lib/listings/preferences';
import type { ClarificationQuestion } from '../src/lib/listings/preferences';
import type { ApartmentPreferences } from '../src/lib/server/apartment-preferences';

function createProfile() {
	return {
		budget: {
			max_rent: null,
			ideal_rent: null
		},
		nightlife: null,
		commute: {
			search_query: 'University of California, Irvine',
			travel_mode: 'bike',
			max_minutes: 10,
			is_dealbreaker: true,
			importance: 0.9
		},
		constraints: [
			{
				label: 'Walkable parks',
				search_query: 'park',
				search_type: 'category',
				travel_mode: 'walk',
				max_minutes: null,
				is_dealbreaker: false,
				importance: 0.7
			}
		],
		unit_requirements: null,
		raw_input: 'test'
	} satisfies ApartmentPreferences;
}

test('applyClarificationAnswersToProfile preserves arrays for dot-index field paths', () => {
	const profile = createProfile();
	const questions = [
		{
			id: 'parks_time',
			field_path: 'constraints.0.max_minutes',
			question: 'How far can the park be?',
			response_type: 'number',
			options: null,
			unit: 'minutes',
			why_asked: 'Needed for ranking'
		}
	] satisfies ClarificationQuestion[];

	const updated = applyClarificationAnswersToProfile(profile, questions, {
		parks_time: 12
	});

	assert.ok(Array.isArray(updated.constraints));
	assert.equal(updated.constraints[0]?.max_minutes, 12);
	assert.equal(updated.constraints[0]?.label, 'Walkable parks');
});

test('applyClarificationAnswersToProfile preserves arrays for bracket-index field paths', () => {
	const profile = createProfile();
	const questions = [
		{
			id: 'parks_time',
			field_path: 'constraints[0].max_minutes',
			question: 'How far can the park be?',
			response_type: 'number',
			options: null,
			unit: 'minutes',
			why_asked: 'Needed for ranking'
		}
	] satisfies ClarificationQuestion[];

	const updated = applyClarificationAnswersToProfile(profile, questions, {
		parks_time: 15
	});

	assert.ok(Array.isArray(updated.constraints));
	assert.equal(updated.constraints[0]?.max_minutes, 15);
	assert.equal(updated.constraints[0]?.travel_mode, 'walk');
});

test('applyClarificationAnswersToProfile updates top-level nightlife preferences', () => {
	const profile = createProfile();
	const questions = [
		{
			id: 'nightlife_vibe',
			field_path: 'nightlife.preference',
			question: 'Do you want quiet nights or lively nightlife?',
			response_type: 'single_select',
			options: [
				{ label: 'Quiet', value: 'quiet' },
				{ label: 'Lively', value: 'lively' }
			],
			unit: null,
			why_asked: 'Needed to rank neighborhood nightlife'
		}
	] satisfies ClarificationQuestion[];

	const updated = applyClarificationAnswersToProfile(
		{
			...profile,
			nightlife: {
				preference: 'quiet',
				is_dealbreaker: false,
				importance: 0.6
			}
		},
		questions,
		{
			nightlife_vibe: 'lively'
		}
	);

	assert.equal(updated.nightlife?.preference, 'lively');
	assert.equal(updated.nightlife?.importance, 0.6);
});
