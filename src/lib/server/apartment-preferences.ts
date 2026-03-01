import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { env } from '$env/dynamic/private';
import { generateText, Output } from 'ai';
import { z } from 'zod';

const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-5.2';


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
	if (typeof v === 'string') {
		const lower = v.toLowerCase();
		return TRAVEL_MODE_ALIASES[lower] ?? lower;
	}
	return v;
}, z.enum(['walk', 'bike', 'drive', 'transit']));
const searchTypeSchema = z.preprocess(
	(v) => (typeof v === 'string' ? v.toLowerCase() : v),
	z.enum(['category', 'specific'])
);

/** Coerce string booleans from LLM output ("true"/"false"/"True"/etc.) into real booleans. */
const coerceBool = z.preprocess((v) => {
	if (typeof v === 'string') {
		const lower = v.toLowerCase();
		if (lower === 'true') return true;
		if (lower === 'false') return false;
	}
	return v;
}, z.boolean());

/** Coerce stringified numbers from LLM output. NaN and non-numeric strings → null. */
function coerceToNumber(v: unknown): unknown {
	if (typeof v === 'string') {
		const trimmed = v.trim();
		if (trimmed === '') return null;
		const n = Number(trimmed);
		return Number.isNaN(n) ? null : n;
	}
	if (typeof v === 'number' && Number.isNaN(v)) return null;
	return v;
}

/** Nullable number — accepts strings, NaN, null, undefined. Used for most numeric fields. */
const coerceNumNullable = z.preprocess(coerceToNumber, z.number().nullable());


const importanceSchema = z.preprocess(coerceToNumber, z.number().nullable()).transform((v) => {
	const n = v ?? 0;
	return Math.max(0, Math.min(1, n));
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
	if (typeof v === 'string') {
		const lower = v.toLowerCase();
		return NIGHTLIFE_ALIASES[lower] ?? lower;
	}
	return v;
}, z.enum(['quiet', 'lively']));

const proximityConstraintSchema = z.object({
	label: z.string(),
	search_query: z.string(),
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
	id: z.string(),
	boolean_value: coerceBool.nullable().optional(),
	number_value: coerceNumNullable.optional(),
	string_value: z.string().trim().min(1).nullable().optional()
});

export const clarificationQuestionSchema = z.object({
	id: z.string(),
	field_path: z.string(),
	question: z.string(),
	response_type: clarificationResponseTypeSchema,
	options: z
		.array(
			z.object({
				label: z.string(),
				value: z.string()
			})
		)
		.nullable(),
	unit: z.string().nullable(),
	why_asked: z.string()
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
			search_query: z.string(),
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
					pet_types: z.array(z.string()).nullable(),
					is_dealbreaker: coerceBool,
					importance: importanceSchema
				})
				.nullable(),
			parking: z
				.object({
					required: coerceBool,
					type_preference: z
					.preprocess(
						(v) => (typeof v === 'string' ? v.toLowerCase() : v),
						z.enum(['garage', 'covered', 'any'])
					)
					.nullable(),
					is_dealbreaker: coerceBool,
					importance: importanceSchema
				})
				.nullable(),
			laundry: z
				.object({
					preference: z.preprocess((v) => {
					if (typeof v === 'string') {
						const lower = v.toLowerCase().replace(/[\s-]/g, '_');
						if (lower === 'in_unit' || lower === 'in_suite') return 'in_unit';
						if (lower === 'on_site' || lower === 'shared') return 'on_site';
						return lower;
					}
					return v;
				}, z.enum(['in_unit', 'on_site', 'any'])),
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
						name: z.string(),
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

const RANGE_DEFAULTS = { min: null, max: null, is_dealbreaker: false, importance: 0 };

const PREFERENCE_DEFAULTS = { is_dealbreaker: false, importance: 0 };

/** Fill undefined fields with defaults so partial LLM output passes strict validation. */
function backfillDefaults(input: unknown): unknown {
	if (!input || typeof input !== 'object') return input;
	const obj = input as Record<string, unknown>;

	// Budget
	if (!obj.budget || typeof obj.budget !== 'object') {
		obj.budget = { max_rent: null, ideal_rent: null };
	} else {
		const b = obj.budget as Record<string, unknown>;
		if (!('max_rent' in b)) b.max_rent = null;
		if (!('ideal_rent' in b)) b.ideal_rent = null;
	}

	// Default missing top-level fields
	if (!Array.isArray(obj.constraints)) obj.constraints = [];
	if (typeof obj.raw_input !== 'string') obj.raw_input = '';

	// Backfill commute sub-fields (nullify if search_query is not a valid string)
	if (obj.commute && typeof obj.commute === 'object') {
		const c = obj.commute as Record<string, unknown>;
		if (typeof c.search_query !== 'string' || c.search_query.trim() === '') {
			obj.commute = null;
		} else {
			if (!('max_minutes' in c)) c.max_minutes = null;
			if (!('is_dealbreaker' in c)) c.is_dealbreaker = false;
			if (!('importance' in c)) c.importance = 0.5;
		}
	}

	// Backfill nightlife sub-fields (nullify if preference is invalid)
	if (obj.nightlife && typeof obj.nightlife === 'object') {
		const n = obj.nightlife as Record<string, unknown>;
		if (typeof n.preference !== 'string') {
			obj.nightlife = null;
		} else {
			if (!('is_dealbreaker' in n)) n.is_dealbreaker = false;
			if (!('importance' in n)) n.importance = 0.5;
		}
	}

	// Backfill constraint items
	if (Array.isArray(obj.constraints)) {
		obj.constraints = obj.constraints.filter((item: unknown) => {
			if (!item || typeof item !== 'object') return false;
			const c = item as Record<string, unknown>;
			// Drop constraints with invalid required string fields
			if (typeof c.label !== 'string' || typeof c.search_query !== 'string') return false;
			if (!('max_minutes' in c)) c.max_minutes = null;
			if (!('is_dealbreaker' in c)) c.is_dealbreaker = false;
			if (!('importance' in c)) c.importance = 0.5;
			if (!('search_type' in c)) c.search_type = 'category';
			if (!('travel_mode' in c)) c.travel_mode = 'drive';
			return true;
		});
	}

	// Backfill unit_requirements sub-fields
	if (obj.unit_requirements && typeof obj.unit_requirements === 'object') {
		const ur = obj.unit_requirements as Record<string, unknown>;
		for (const [key, defaultVal] of Object.entries(UNIT_REQUIREMENTS_DEFAULTS)) {
			if (!(key in ur)) ur[key] = defaultVal;
		}
		// Range-like objects: bedrooms, sqft, lease_length_months
		for (const key of ['bedrooms', 'sqft', 'lease_length_months']) {
			if (ur[key] && typeof ur[key] === 'object') {
				ur[key] = { ...RANGE_DEFAULTS, ...(ur[key] as Record<string, unknown>) };
			}
		}
		// Bathrooms
		if (ur.bathrooms && typeof ur.bathrooms === 'object') {
			const b = ur.bathrooms as Record<string, unknown>;
			if (!('min' in b)) b.min = null;
			if (!('is_dealbreaker' in b)) b.is_dealbreaker = false;
			if (!('importance' in b)) b.importance = 0;
		}
		// Pets
		if (ur.pets && typeof ur.pets === 'object') {
			const p = ur.pets as Record<string, unknown>;
			if (!('pet_types' in p)) p.pet_types = null;
			if (!('is_dealbreaker' in p)) p.is_dealbreaker = false;
			if (!('importance' in p)) p.importance = 0.5;
		}
		// Parking
		if (ur.parking && typeof ur.parking === 'object') {
			const p = ur.parking as Record<string, unknown>;
			if (!('type_preference' in p)) p.type_preference = null;
			if (!('is_dealbreaker' in p)) p.is_dealbreaker = false;
			if (!('importance' in p)) p.importance = 0.5;
		}
		// Laundry
		if (ur.laundry && typeof ur.laundry === 'object') {
			const l = ur.laundry as Record<string, unknown>;
			if (!('is_dealbreaker' in l)) l.is_dealbreaker = false;
			if (!('importance' in l)) l.importance = 0.3;
		}
		// Furnished
		if (ur.furnished && typeof ur.furnished === 'object') {
			const f = ur.furnished as Record<string, unknown>;
			if (!('is_dealbreaker' in f)) f.is_dealbreaker = false;
			if (!('importance' in f)) f.importance = 0.3;
		}
		// Amenities array items
		if (Array.isArray(ur.amenities)) {
			for (const item of ur.amenities) {
				if (item && typeof item === 'object') {
					const a = item as Record<string, unknown>;
					if (!('is_dealbreaker' in a)) a.is_dealbreaker = false;
					if (!('importance' in a)) a.importance = 0.3;
				}
			}
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
	current_profile: apartmentPreferenceSchema.nullable().optional()
});

export const apartmentPreferenceExtractionSchema = z.object({
	status: z.enum(['complete', 'needs_clarification']),
	profile: apartmentPreferenceSchema,
	clarification_questions: z.array(clarificationQuestionSchema).max(3)
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

function buildExtractionPrompt(input: ApartmentPreferenceInput) {
	return [
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
	].join('\n');
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
	const apiKey = env.OPENROUTER_API_KEY?.trim();

	if (!apiKey) {
		throw new Error('OPENROUTER_API_KEY is not configured.');
	}

	return apiKey;
}

function resolveApartmentPreferenceModel(modelOverride?: string): ResolvedApartmentPreferenceModel {
	const requestedModel =
		modelOverride?.trim() || env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;

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

async function generateApartmentPreferenceExtraction(
	openrouter: ReturnType<typeof createOpenRouter>,
	selectedModel: string,
	parsedInput: ApartmentPreferenceInput
) {
	return generateText({
		model: openrouter(selectedModel),
		system: APARTMENT_PREFERENCE_SYSTEM_PROMPT,
		prompt: buildExtractionPrompt(parsedInput),
		output: Output.object({
			schema: apartmentPreferenceExtractionSchema,
			description:
				'LifeMatch extraction result containing a normalized profile and any remaining clarifying questions.'
		})
	});
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
