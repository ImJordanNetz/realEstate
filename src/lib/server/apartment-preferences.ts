import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, JSONParseError, NoObjectGeneratedError, Output, TypeValidationError } from 'ai';
import { isAllowedClarificationFieldPath } from '$lib/shared/apartment-preference-paths';
import { getPrivateEnv } from '$lib/server/runtime-env';
import { z } from 'zod';

const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-5.2';

type TravelMode = 'walk' | 'bike' | 'drive' | 'transit';
type SearchType = 'category' | 'specific';
type NightlifePreference = 'quiet' | 'lively';
type ParkingPreference = 'garage' | 'covered' | 'any';
type LaundryPreference = 'in_unit' | 'on_site' | 'any';

function normalizeToken(value: string) {
	return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function toNonEmptyString(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null;
	}

	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function toCanonicalBoolean(value: unknown): boolean | null {
	if (typeof value === 'boolean') {
		return value;
	}

	if (typeof value === 'number' && (value === 0 || value === 1)) {
		return Boolean(value);
	}

	if (typeof value === 'string') {
		const normalized = normalizeToken(value);
		if (normalized === 'true' || normalized === 'yes' || normalized === 'y' || normalized === '1') {
			return true;
		}
		if (
			normalized === 'false' ||
			normalized === 'no' ||
			normalized === 'n' ||
			normalized === '0'
		) {
			return false;
		}
	}

	return null;
}

function toCanonicalNonNegativeNumber(value: unknown): number | null {
	if (typeof value === 'number') {
		if (!Number.isFinite(value) || value < 0) {
			return null;
		}

		return value;
	}

	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) {
			return null;
		}

		const normalized = trimmed.replace(/[$,]/g, '');
		const parsed = Number(normalized);
		if (!Number.isFinite(parsed) || parsed < 0) {
			return null;
		}

		return parsed;
	}

	return null;
}

function clampUnitInterval(value: number) {
	return Math.max(0, Math.min(1, value));
}

function toCanonicalTravelMode(value: unknown): TravelMode | null {
	if (typeof value !== 'string') {
		return null;
	}

	const normalized = normalizeToken(value);
	const canonical = TRAVEL_MODE_ALIASES[normalized] ?? normalized;

	switch (canonical) {
		case 'walk':
		case 'bike':
		case 'drive':
		case 'transit':
			return canonical;
		default:
			return null;
	}
}

function toCanonicalSearchType(value: unknown): SearchType | null {
	if (typeof value !== 'string') {
		return null;
	}

	switch (normalizeToken(value)) {
		case 'category':
		case 'type':
		case 'place_type':
			return 'category';
		case 'specific':
		case 'named':
		case 'place_name':
			return 'specific';
		default:
			return null;
	}
}

function toCanonicalNightlifePreference(value: unknown): NightlifePreference | null {
	if (typeof value !== 'string') {
		return null;
	}

	const normalized = normalizeToken(value);
	const canonical = NIGHTLIFE_ALIASES[normalized] ?? normalized;

	switch (canonical) {
		case 'quiet':
		case 'lively':
			return canonical;
		default:
			return null;
	}
}

function toCanonicalParkingPreference(value: unknown): ParkingPreference | null {
	if (typeof value !== 'string') {
		return null;
	}

	switch (normalizeToken(value)) {
		case 'garage':
			return 'garage';
		case 'covered':
		case 'carport':
			return 'covered';
		case 'any':
		case 'surface':
		case 'street':
		case 'open':
			return 'any';
		default:
			return null;
	}
}

function toCanonicalLaundryPreference(value: unknown): LaundryPreference | null {
	if (typeof value !== 'string') {
		return null;
	}

	switch (normalizeToken(value)) {
		case 'in_unit':
		case 'in_suite':
			return 'in_unit';
		case 'on_site':
		case 'shared':
			return 'on_site';
		case 'any':
		case 'none':
			return 'any';
		default:
			return null;
	}
}

function sanitizeStringArray(value: unknown): string[] | null {
	if (!Array.isArray(value)) {
		return null;
	}

	const cleaned = value
		.map((item) => toNonEmptyString(item))
		.filter((item): item is string => item !== null);

	return cleaned.length ? cleaned : null;
}

function applyNullableNumberDefault(
	record: Record<string, unknown>,
	key: string,
	defaultValue: number | null = null
) {
	record[key] = toCanonicalNonNegativeNumber(record[key]) ?? defaultValue;
}

function applyBooleanDefault(record: Record<string, unknown>, key: string, defaultValue = false) {
	record[key] = toCanonicalBoolean(record[key]) ?? defaultValue;
}

function applyImportanceDefault(record: Record<string, unknown>, key: string, defaultValue = 0) {
	const numeric = toCanonicalNonNegativeNumber(record[key]);
	record[key] = numeric == null ? defaultValue : clampUnitInterval(numeric);
}

function normalizeRangeObject(
	record: Record<string, unknown>,
	emptyWhen: (range: Record<string, unknown>) => boolean
) {
	applyNullableNumberDefault(record, 'min');
	applyNullableNumberDefault(record, 'max');
	applyBooleanDefault(record, 'is_dealbreaker', false);
	applyImportanceDefault(record, 'importance', 0);

	if (typeof record.min === 'number' && typeof record.max === 'number' && record.min > record.max) {
		[record.min, record.max] = [record.max, record.min];
	}

	return emptyWhen(record) ? null : record;
}


const TRAVEL_MODE_ALIASES: Record<string, string> = {
	walking: 'walk',
	biking: 'bike',
	bicycle: 'bike',
	cycling: 'bike',
	driving: 'drive',
	car: 'drive',
	public_transit: 'transit',
	bus: 'transit',
	train: 'transit',
	subway: 'transit'
};
const travelModeSchema = z.preprocess((v) => {
	return toCanonicalTravelMode(v) ?? v;
}, z.enum(['walk', 'bike', 'drive', 'transit']));
const searchTypeSchema = z.preprocess(
	(v) => toCanonicalSearchType(v) ?? v,
	z.enum(['category', 'specific'])
);

/** Coerce string booleans from LLM output ("true"/"false"/"True"/etc.) into real booleans. */
const coerceBool = z.preprocess((v) => {
	return toCanonicalBoolean(v) ?? v;
}, z.boolean());

/** Coerce stringified numbers from LLM output. NaN and non-numeric strings → null. */
function coerceToNumber(v: unknown): unknown {
	return toCanonicalNonNegativeNumber(v);
}

/** Nullable number — accepts strings, NaN, null, undefined. Used for most numeric fields. */
const coerceNumNullable = z.preprocess(coerceToNumber, z.number().finite().nullable());


const importanceSchema = z.preprocess(coerceToNumber, z.number().finite().nullable()).transform((v) => {
	const n = v ?? 0;
	return clampUnitInterval(n);
});
const clarificationResponseTypeSchema = z.enum(['boolean', 'number', 'single_select']);
const NIGHTLIFE_ALIASES: Record<string, string> = {
	loud: 'lively',
	vibrant: 'lively',
	noisy: 'lively',
	silent: 'quiet',
	peaceful: 'quiet',
	calm: 'quiet'
};
const nightlifePreferenceSchema = z.preprocess((v) => {
	return toCanonicalNightlifePreference(v) ?? v;
}, z.enum(['quiet', 'lively']));

const proximityConstraintSchema = z.object({
	label: z.string().trim().min(1),
	search_query: z.string().trim().min(1),
	search_type: searchTypeSchema,
	travel_mode: travelModeSchema,
	max_minutes: coerceNumNullable,
	is_dealbreaker: coerceBool,
	importance: importanceSchema
});

const nullableIntegerRangeSchema = z.object({
	min: coerceNumNullable,
	max: coerceNumNullable,
	is_dealbreaker: coerceBool,
	importance: importanceSchema
});

const nullableNumberRangeSchema = z.object({
	min: coerceNumNullable,
	max: coerceNumNullable,
	is_dealbreaker: coerceBool,
	importance: importanceSchema
});

export const clarificationAnswerSchema = z.object({
	id: z.string().trim().min(1),
	boolean_value: coerceBool.nullable().optional(),
	number_value: coerceNumNullable.optional(),
	string_value: z.string().trim().min(1).nullable().optional()
});

const clarificationQuestionOptionSchema = z.object({
	label: z.string().trim().min(1).max(80),
	value: z.string().trim().min(1).max(80)
});

export const clarificationQuestionSchema = z.object({
	id: z.string().trim().min(1),
	field_path: z
		.string()
		.trim()
		.min(1)
		.refine(
			(value) => isAllowedClarificationFieldPath(value),
			'Clarification questions must target a supported profile field.'
		),
	question: z.string().trim().min(1).max(400),
	response_type: clarificationResponseTypeSchema,
	options: z.array(clarificationQuestionOptionSchema).max(6).nullable(),
	unit: z.string().trim().min(1).max(24).nullable(),
	why_asked: z.string().trim().min(1).max(240)
}).superRefine((question, ctx) => {
	if (question.response_type === 'single_select') {
		if (!question.options || question.options.length < 2) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'single_select questions must provide 2 to 6 options.',
				path: ['options']
			});
		}

		const seen = new Set<string>();
		for (const option of question.options ?? []) {
			if (seen.has(option.value)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: 'single_select options must use unique values.',
					path: ['options']
				});
				break;
			}
			seen.add(option.value);
		}
	} else if (question.options !== null) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: 'Only single_select questions may include options.',
			path: ['options']
		});
	}

	if (question.response_type !== 'number' && question.unit !== null) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: 'Only number questions may include a unit.',
			path: ['unit']
		});
	}
});

export const apartmentPreferenceMessageSchema = z.object({
	role: z.enum(['user', 'assistant']),
	content: z.string().trim().min(1).max(20_000)
});

export const apartmentPreferenceSchema = z.object({
	budget: z.object({
		max_rent: coerceNumNullable,
		ideal_rent: coerceNumNullable
	}),
	nightlife: z
		.object({
			preference: nightlifePreferenceSchema,
			is_dealbreaker: coerceBool,
			importance: importanceSchema
		})
		.nullable(),
	commute: z
		.object({
			search_query: z.string().trim().min(1),
			travel_mode: travelModeSchema,
			max_minutes: coerceNumNullable,
			is_dealbreaker: coerceBool,
			importance: importanceSchema
		})
		.nullable(),
	constraints: z.array(proximityConstraintSchema),
	unit_requirements: z
		.object({
			bedrooms: nullableIntegerRangeSchema.nullable(),
			bathrooms: z
				.object({
					min: coerceNumNullable,
					is_dealbreaker: coerceBool,
					importance: importanceSchema
				})
				.nullable(),
			pets: z
				.object({
					allowed: coerceBool,
					pet_types: z.array(z.string().trim().min(1)).nullable(),
					is_dealbreaker: coerceBool,
					importance: importanceSchema
				})
				.nullable(),
			parking: z
				.object({
					required: coerceBool,
					type_preference: z.preprocess(
						(v) => toCanonicalParkingPreference(v) ?? v,
						z.enum(['garage', 'covered', 'any'])
					).nullable(),
					is_dealbreaker: coerceBool,
					importance: importanceSchema
				})
				.nullable(),
			laundry: z
				.object({
					preference: z.preprocess(
						(v) => toCanonicalLaundryPreference(v) ?? v,
						z.enum(['in_unit', 'on_site', 'any'])
					),
					is_dealbreaker: coerceBool,
					importance: importanceSchema
				})
				.nullable(),
			furnished: z
				.object({
					preferred: coerceBool,
					is_dealbreaker: coerceBool,
					importance: importanceSchema
				})
				.nullable(),
			sqft: nullableNumberRangeSchema.nullable(),
			lease_length_months: z
				.object({
					min: coerceNumNullable,
					max: coerceNumNullable,
					is_dealbreaker: coerceBool,
					importance: importanceSchema
				})
				.nullable(),
			amenities: z
				.array(
					z.object({
						name: z.string().trim().min(1),
						is_dealbreaker: coerceBool,
						importance: importanceSchema
					})
				)
				.nullable()
		})
		.nullable(),
	raw_input: z.string()
});

/** Default shape for missing fields — null for optional sub-objects, [] for arrays. */
const UNIT_REQUIREMENTS_DEFAULTS = {
	bedrooms: null,
	bathrooms: null,
	pets: null,
	parking: null,
	laundry: null,
	furnished: null,
	sqft: null,
	lease_length_months: null,
	amenities: null
};

/** Fill undefined fields with defaults so partial LLM output passes strict validation. */
function backfillDefaults(input: unknown): unknown {
	if (!input || typeof input !== 'object') return input;
	const obj = input as Record<string, unknown>;

	// Budget
	if (!obj.budget || typeof obj.budget !== 'object') {
		obj.budget = { max_rent: null, ideal_rent: null };
	} else {
		const b = obj.budget as Record<string, unknown>;
		applyNullableNumberDefault(b, 'max_rent');
		applyNullableNumberDefault(b, 'ideal_rent');
	}

	// Default missing top-level fields
	if (!Array.isArray(obj.constraints)) obj.constraints = [];
	obj.raw_input = typeof obj.raw_input === 'string' ? obj.raw_input.trim() : '';

	// Default missing nullable objects to null and nullify invalid non-objects.
	for (const key of ['commute', 'nightlife', 'unit_requirements'] as const) {
		if (!(key in obj) || obj[key] === undefined) {
			obj[key] = null;
		} else if (obj[key] !== null && typeof obj[key] !== 'object') {
			obj[key] = null;
		}
	}

	// Backfill commute sub-fields (nullify if search_query is not a valid string)
	if (obj.commute && typeof obj.commute === 'object') {
		const c = obj.commute as Record<string, unknown>;
		const searchQuery = toNonEmptyString(c.search_query);
		if (!searchQuery) {
			obj.commute = null;
		} else {
			c.search_query = searchQuery;
			c.travel_mode = toCanonicalTravelMode(c.travel_mode) ?? 'drive';
			applyNullableNumberDefault(c, 'max_minutes');
			applyBooleanDefault(c, 'is_dealbreaker', false);
			applyImportanceDefault(c, 'importance', 0.5);
		}
	}

	// Backfill nightlife sub-fields (nullify if preference is invalid)
	if (obj.nightlife && typeof obj.nightlife === 'object') {
		const n = obj.nightlife as Record<string, unknown>;
		const preference = toCanonicalNightlifePreference(n.preference);
		if (!preference) {
			obj.nightlife = null;
		} else {
			n.preference = preference;
			applyBooleanDefault(n, 'is_dealbreaker', false);
			applyImportanceDefault(n, 'importance', 0.5);
		}
	}

	// Backfill constraint items
	if (Array.isArray(obj.constraints)) {
		obj.constraints = obj.constraints.flatMap((item: unknown) => {
			if (!item || typeof item !== 'object') return [];
			const c = item as Record<string, unknown>;
			const label = toNonEmptyString(c.label);
			const searchQuery = toNonEmptyString(c.search_query);

			// Drop constraints with invalid required string fields.
			if (!label || !searchQuery) return [];

			c.label = label;
			c.search_query = searchQuery;
			c.search_type = toCanonicalSearchType(c.search_type) ?? 'category';
			c.travel_mode = toCanonicalTravelMode(c.travel_mode) ?? 'drive';
			applyNullableNumberDefault(c, 'max_minutes');
			applyBooleanDefault(c, 'is_dealbreaker', false);
			applyImportanceDefault(c, 'importance', 0.5);
			return [c];
		});
	}

	// Backfill unit_requirements sub-fields
	if (obj.unit_requirements && typeof obj.unit_requirements === 'object') {
		const ur = obj.unit_requirements as Record<string, unknown>;

		// Nullify non-object nullable sub-fields, default missing ones
		for (const [key, defaultVal] of Object.entries(UNIT_REQUIREMENTS_DEFAULTS)) {
			if (!(key in ur)) {
				ur[key] = defaultVal;
			} else if (key === 'amenities') {
				if (!Array.isArray(ur[key])) ur[key] = null;
			} else if (ur[key] !== null && ur[key] !== undefined && typeof ur[key] !== 'object') {
				ur[key] = null;
			}
		}

		// Range-like objects: bedrooms, sqft, lease_length_months
		for (const key of ['bedrooms', 'sqft', 'lease_length_months']) {
			if (ur[key] && typeof ur[key] === 'object') {
				ur[key] = normalizeRangeObject(ur[key] as Record<string, unknown>, (range) => {
					return range.min == null && range.max == null;
				});
			}
		}

		// Bathrooms
		if (ur.bathrooms && typeof ur.bathrooms === 'object') {
			const b = ur.bathrooms as Record<string, unknown>;
			applyNullableNumberDefault(b, 'min');
			applyBooleanDefault(b, 'is_dealbreaker', false);
			applyImportanceDefault(b, 'importance', 0);
			if (b.min == null) {
				ur.bathrooms = null;
			}
		}

		// Pets
		if (ur.pets && typeof ur.pets === 'object') {
			const p = ur.pets as Record<string, unknown>;
			const petTypes = sanitizeStringArray(p.pet_types);
			const allowed = toCanonicalBoolean(p.allowed);

			if (allowed == null && petTypes == null) {
				ur.pets = null;
			} else {
				p.allowed = allowed ?? true;
				p.pet_types = petTypes;
				applyBooleanDefault(p, 'is_dealbreaker', false);
				applyImportanceDefault(p, 'importance', 0.5);
			}
		}

		// Parking
		if (ur.parking && typeof ur.parking === 'object') {
			const p = ur.parking as Record<string, unknown>;
			const typePreference = toCanonicalParkingPreference(p.type_preference);
			const required = toCanonicalBoolean(p.required);

			if (required == null && typePreference == null) {
				ur.parking = null;
			} else {
				p.required = required ?? true;
				p.type_preference = typePreference;
				applyBooleanDefault(p, 'is_dealbreaker', false);
				applyImportanceDefault(p, 'importance', 0.5);
			}
		}

		// Laundry
		if (ur.laundry && typeof ur.laundry === 'object') {
			const l = ur.laundry as Record<string, unknown>;
			const preference = toCanonicalLaundryPreference(l.preference);
			if (!preference) {
				ur.laundry = null;
			} else {
				l.preference = preference;
				applyBooleanDefault(l, 'is_dealbreaker', false);
				applyImportanceDefault(l, 'importance', 0.3);
			}
		}

		// Furnished
		if (ur.furnished && typeof ur.furnished === 'object') {
			const f = ur.furnished as Record<string, unknown>;
			const preferred = toCanonicalBoolean(f.preferred);
			if (preferred == null) {
				ur.furnished = null;
			} else {
				f.preferred = preferred;
				applyBooleanDefault(f, 'is_dealbreaker', false);
				applyImportanceDefault(f, 'importance', 0.3);
			}
		}

		// Amenities array items
		if (Array.isArray(ur.amenities)) {
			ur.amenities = ur.amenities.flatMap((item: unknown) => {
				if (!item || typeof item !== 'object') return [];
				const a = item as Record<string, unknown>;
				const name = toNonEmptyString(a.name);
				if (!name) return [];
				a.name = name;
				applyBooleanDefault(a, 'is_dealbreaker', false);
				applyImportanceDefault(a, 'importance', 0.3);
				return [a];
			});
		}

		if (
			Object.values(ur).every((value) => value == null || (Array.isArray(value) && value.length === 0))
		) {
			obj.unit_requirements = null;
		}
	}

	return obj;
}

/**
 * Lenient version of apartmentPreferenceSchema that defaults missing fields.
 * Used for API request validation where LLM output may omit fields.
 * The strict base schema (apartmentPreferenceSchema) is used for LLM structured
 * output where OpenAI requires all properties in `required`.
 */
export const apartmentPreferenceLenientSchema = z.preprocess(
	backfillDefaults,
	apartmentPreferenceSchema
);

export const apartmentPreferenceInputSchema = z.object({
	prompt: z.string().trim().min(1).max(4000),
	model: z.string().trim().min(1).optional(),
	clarification_answers: z.array(clarificationAnswerSchema).default([]),
	message_history: z.array(apartmentPreferenceMessageSchema).max(100).default([]),
	current_profile: apartmentPreferenceLenientSchema.nullable().optional()
});

export const apartmentPreferenceExtractionSchema = z.object({
	status: z.enum(['complete', 'needs_clarification']),
	profile: apartmentPreferenceLenientSchema,
	clarification_questions: z.array(clarificationQuestionSchema).max(3)
}).superRefine((result, ctx) => {
	if (result.status === 'complete' && result.clarification_questions.length > 0) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: 'complete results cannot include clarification questions.',
			path: ['clarification_questions']
		});
	}

	if (result.status === 'needs_clarification' && result.clarification_questions.length === 0) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: 'needs_clarification results must include at least one question.',
			path: ['clarification_questions']
		});
	}
});

export type ApartmentPreferenceInput = z.infer<typeof apartmentPreferenceInputSchema>;
export type ApartmentPreferenceMessage = z.infer<typeof apartmentPreferenceMessageSchema>;
export type ApartmentPreferences = z.infer<typeof apartmentPreferenceSchema>;
export type ApartmentPreferenceExtraction = z.infer<typeof apartmentPreferenceExtractionSchema>;
export type ApartmentPreferenceExtractionResponse = {
	model: string;
	requested_model: string;
	preferences: ApartmentPreferenceExtraction;
	clarification_answers: ApartmentPreferenceInput['clarification_answers'];
	usage: unknown;
	openrouter: unknown;
};

type ResolvedApartmentPreferenceModel = {
	requestedModel: string;
	resolvedModel: string;
};

const EXTRACTION_REPAIR_PROMPT = [
	'Your previous response failed schema validation.',
	'Return valid JSON only.',
	'Keep profile fields normalized and clarification metadata valid.',
	'Only use supported clarification field_path values, and ensure status/question counts agree.'
].join(' ');

const APARTMENT_PREFERENCE_SYSTEM_PROMPT = `You extract apartment-ranking preferences from natural language into the LifeMatchProfile schema.

Rules:
- Return data that matches the schema exactly.
- Return a top-level status of either "complete" or "needs_clarification".
- Return a profile object on every response, even when some fields remain unknown.
- Ask at most 3 clarifying questions.
- You may receive prior conversation history and a current profile JSON draft.
- Treat the current profile as editable draft data, not ground truth.
- Use the full conversation history to preserve valid context from earlier turns.
- The latest user request overrides older user statements and any conflicting current-profile values.
- Preserve still-valid fields from the current profile when the newer conversation does not change them.
- Remove or overwrite fields that conflict with newer user instructions, clarification answers, or conversation history.
- Only ask a clarifying question when the answer would materially affect apartment filtering or ranking.
- Prefer targeted questions that can be answered as boolean, number, or single_select.
- Do not ask open-ended freeform questions.
- When status is "complete", clarification_questions must be empty.
- When status is "needs_clarification", clarification_questions must contain 1 to 3 concrete questions.
- Preserve the latest user request in raw_input.
- Budget, commute, and unit requirements should only include values the user actually stated or strongly implied.
- Use nightlife when the user expresses a desire for quiet nights or lively nightlife near home.
- Never invent numeric values for rent, travel time, square footage, lease length, bathroom count, or bedroom count.
- If a numeric field was not stated, use null.
- If nightlife was not mentioned, set nightlife to null.
- If no commute was mentioned, set commute to null.
- If no unit requirements were mentioned, set unit_requirements to null.
- constraints should contain lifestyle and proximity preferences beyond budget and the primary commute.
- Use nightlife.preference = "quiet" for phrases like "quiet at night", "not noisy", or "good for studying".
- Use nightlife.preference = "lively" for phrases like "good nightlife", "walk to bars", or "energetic neighborhood".
- Use search_type = "category" for place types like park, grocery store, or rock climbing gym.
- Use search_type = "specific" for named destinations or venues.
- search_query must be suitable for Google Places lookups.
- importance must be a number between 0 and 1.
- Infer importance from phrasing:
  - "super important", "must", "need" => 0.85 to 1
  - "important", "really want" => 0.6 to 0.84
  - "prefer", "would like" => 0.35 to 0.59
  - "nice to have" => 0.1 to 0.34
- Set is_dealbreaker to true only when the user clearly describes a hard constraint.
- constraints can be an empty array if no non-commute lifestyle constraints were mentioned.
- If clarification answers are provided, use them and avoid asking the same question again unless the answer is still unusable.
- For response_type = "boolean", options must be null.
- For response_type = "number", options must be null and unit should usually be "usd", "minutes", "bedrooms", "bathrooms", or "months" when relevant.
- For response_type = "single_select", options must contain 2 to 6 choices with short labels and values.
- field_path should identify the field to be updated, such as "budget.max_rent", "nightlife.preference", "commute.max_minutes", or "unit_requirements.pets.allowed".`;

function formatClarificationAnswers(clarificationAnswers: ApartmentPreferenceInput['clarification_answers']) {
	if (!clarificationAnswers.length) {
		return 'None';
	}

	return clarificationAnswers
		.map((answer) => {
			const value =
				answer.boolean_value ??
				answer.number_value ??
				answer.string_value ??
				'[missing]';

			return `- ${answer.id}: ${String(value)}`;
		})
		.join('\n');
}

function formatMessageHistory(messageHistory: ApartmentPreferenceInput['message_history']) {
	if (!messageHistory.length) {
		return 'None';
	}

	return messageHistory
		.map((message, index) => {
			const role = message.role === 'assistant' ? 'Assistant' : 'User';
			return `${index + 1}. ${role}:\n${message.content}`;
		})
		.join('\n\n');
}

function formatCurrentProfile(currentProfile: ApartmentPreferenceInput['current_profile']) {
	if (!currentProfile) {
		return 'None';
	}

	return JSON.stringify(currentProfile, null, 2);
}

function buildExtractionPrompt(input: ApartmentPreferenceInput, repairHint?: string) {
	const sections = [
		'Latest user apartment preference request:',
		input.prompt,
		'',
		'Prior conversation history:',
		formatMessageHistory(input.message_history),
		'',
		'Current structured profile JSON draft:',
		formatCurrentProfile(input.current_profile ?? null),
		'',
		'Clarification answers already collected:',
		formatClarificationAnswers(input.clarification_answers),
		'',
		'Update the structured profile using the full conversation and the current JSON draft.',
		'Return the extraction result.'
	];

	if (repairHint) {
		sections.push('', 'Validation repair instructions:', repairHint);
	}

	return sections.join('\n');
}

function validateClarificationAnswers(clarificationAnswers: ApartmentPreferenceInput['clarification_answers']) {
	for (const answer of clarificationAnswers) {
		const definedValues = [answer.boolean_value, answer.number_value, answer.string_value].filter(
			(value) => value !== undefined && value !== null
		);

		if (definedValues.length !== 1) {
			throw new Error(
				`Clarification answer "${answer.id}" must set exactly one of boolean_value, number_value, or string_value.`
			);
		}
	}
}

function getOpenRouterApiKey(): string {
	const apiKey = getPrivateEnv('OPENROUTER_API_KEY')?.trim();

	if (!apiKey) {
		throw new Error('OPENROUTER_API_KEY is not configured.');
	}

	return apiKey;
}

function resolveApartmentPreferenceModel(modelOverride?: string): ResolvedApartmentPreferenceModel {
	const requestedModel =
		modelOverride?.trim() || getPrivateEnv('OPENROUTER_MODEL')?.trim() || DEFAULT_OPENROUTER_MODEL;

	return {
		requestedModel,
		resolvedModel: requestedModel
	};
}

function isInvalidOpenRouterModelError(err: unknown): err is Error {
	return err instanceof Error && /not a valid model ID/i.test(err.message);
}

export function getApartmentPreferenceModel(modelOverride?: string): string {
	return resolveApartmentPreferenceModel(modelOverride).resolvedModel;
}

function isRecoverableStructuredOutputError(err: unknown) {
	return (
		NoObjectGeneratedError.isInstance(err) &&
		(JSONParseError.isInstance(err.cause) || TypeValidationError.isInstance(err.cause))
	);
}

async function generateApartmentPreferenceExtraction(
	openrouter: ReturnType<typeof createOpenRouter>,
	selectedModel: string,
	parsedInput: ApartmentPreferenceInput,
	repairHint?: string
) {
	try {
		return await generateText({
			model: openrouter(selectedModel),
			system: APARTMENT_PREFERENCE_SYSTEM_PROMPT,
			prompt: buildExtractionPrompt(parsedInput, repairHint),
			output: Output.object({
				schema: apartmentPreferenceExtractionSchema,
				description:
					'LifeMatch extraction result containing a normalized profile and any remaining clarifying questions.'
			})
		});
	} catch (err) {
		if (repairHint || !isRecoverableStructuredOutputError(err)) {
			throw err;
		}

		return generateApartmentPreferenceExtraction(
			openrouter,
			selectedModel,
			parsedInput,
			EXTRACTION_REPAIR_PROMPT
		);
	}
}

export async function extractApartmentPreferences(input: ApartmentPreferenceInput) {
	const parsedInput = apartmentPreferenceInputSchema.parse(input);
	validateClarificationAnswers(parsedInput.clarification_answers);

	const openrouter = createOpenRouter({ apiKey: getOpenRouterApiKey() });
	const { requestedModel, resolvedModel } = resolveApartmentPreferenceModel(parsedInput.model);

	let selectedModel = resolvedModel;
	let generationResult;

	try {
		generationResult = await generateApartmentPreferenceExtraction(
			openrouter,
			selectedModel,
			parsedInput
		);
	} catch (err) {
		if (!isInvalidOpenRouterModelError(err)) {
			throw err;
		}

		if (selectedModel === DEFAULT_OPENROUTER_MODEL) {
			throw new Error(
				`Configured OpenRouter model "${requestedModel}" is invalid. Use a supported provider/model ID such as "${DEFAULT_OPENROUTER_MODEL}" or "openai/gpt-5-mini".`
			);
		}

		selectedModel = DEFAULT_OPENROUTER_MODEL;
		generationResult = await generateApartmentPreferenceExtraction(
			openrouter,
			selectedModel,
			parsedInput
		);
	}

	const { output, providerMetadata, usage } = generationResult;

	return {
		model: selectedModel,
		requested_model: requestedModel,
		preferences: output,
		clarification_answers: parsedInput.clarification_answers,
		usage,
		openrouter: {
			...(providerMetadata?.openrouter && typeof providerMetadata.openrouter === 'object'
				? providerMetadata.openrouter
				: {}),
			requested_model: requestedModel,
			resolved_model: selectedModel,
			model_was_normalized: requestedModel !== resolvedModel,
			fell_back_to_default: selectedModel !== resolvedModel
		}
	};
}
