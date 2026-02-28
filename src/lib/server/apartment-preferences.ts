import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { env } from '$env/dynamic/private';
import { generateText, Output } from 'ai';
import { z } from 'zod';

const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-5.2';


const travelModeSchema = z.enum(['walk', 'bike', 'drive', 'transit']);
const searchTypeSchema = z.enum(['category', 'specific']);
const importanceSchema = z.number().min(0).max(1);
const clarificationResponseTypeSchema = z.enum(['boolean', 'number', 'single_select']);

const proximityConstraintSchema = z.object({
	label: z.string(),
	search_query: z.string(),
	search_type: searchTypeSchema,
	travel_mode: travelModeSchema,
	max_minutes: z.number().positive().nullable(),
	is_dealbreaker: z.boolean(),
	importance: importanceSchema
});

const nullableIntegerRangeSchema = z.object({
	min: z.number().int().nullable(),
	max: z.number().int().nullable(),
	is_dealbreaker: z.boolean(),
	importance: importanceSchema
});

const nullableNumberRangeSchema = z.object({
	min: z.number().positive().nullable(),
	max: z.number().positive().nullable(),
	is_dealbreaker: z.boolean(),
	importance: importanceSchema
});

export const clarificationAnswerSchema = z.object({
	id: z.string(),
	boolean_value: z.boolean().nullable().optional(),
	number_value: z.number().nullable().optional(),
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

export const apartmentPreferenceInputSchema = z.object({
	prompt: z.string().trim().min(1).max(4000),
	model: z.string().trim().min(1).optional(),
	clarification_answers: z.array(clarificationAnswerSchema).default([])
});

export const apartmentPreferenceSchema = z.object({
	budget: z.object({
		max_rent: z.number().positive().nullable(),
		ideal_rent: z.number().positive().nullable()
	}),
	commute: z
		.object({
			search_query: z.string(),
			travel_mode: travelModeSchema,
			max_minutes: z.number().positive().nullable(),
			is_dealbreaker: z.boolean(),
			importance: importanceSchema
		})
		.nullable(),
	constraints: z.array(proximityConstraintSchema),
	unit_requirements: z
		.object({
			bedrooms: nullableIntegerRangeSchema.nullable(),
			bathrooms: z
				.object({
					min: z.number().positive().nullable(),
					is_dealbreaker: z.boolean(),
					importance: importanceSchema
				})
				.nullable(),
			pets: z
				.object({
					allowed: z.boolean(),
					pet_types: z.array(z.string()).nullable(),
					is_dealbreaker: z.boolean(),
					importance: importanceSchema
				})
				.nullable(),
			parking: z
				.object({
					required: z.boolean(),
					type_preference: z.enum(['garage', 'covered', 'any']).nullable(),
					is_dealbreaker: z.boolean(),
					importance: importanceSchema
				})
				.nullable(),
			laundry: z
				.object({
					preference: z.enum(['in_unit', 'on_site', 'any']),
					is_dealbreaker: z.boolean(),
					importance: importanceSchema
				})
				.nullable(),
			furnished: z
				.object({
					preferred: z.boolean(),
					is_dealbreaker: z.boolean(),
					importance: importanceSchema
				})
				.nullable(),
			sqft: nullableNumberRangeSchema.nullable(),
			lease_length_months: z
				.object({
					min: z.number().int().positive().nullable(),
					max: z.number().int().positive().nullable(),
					is_dealbreaker: z.boolean(),
					importance: importanceSchema
				})
				.nullable(),
			amenities: z
				.array(
					z.object({
						name: z.string(),
						is_dealbreaker: z.boolean(),
						importance: importanceSchema
					})
				)
				.nullable()
		})
		.nullable(),
	raw_input: z.string()
});

export const apartmentPreferenceExtractionSchema = z.object({
	status: z.enum(['complete', 'needs_clarification']),
	profile: apartmentPreferenceSchema,
	clarification_questions: z.array(clarificationQuestionSchema).max(3)
});

export type ApartmentPreferenceInput = z.infer<typeof apartmentPreferenceInputSchema>;
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
- Only ask a clarifying question when the answer would materially affect apartment filtering or ranking.
- Prefer targeted questions that can be answered as boolean, number, or single_select.
- Do not ask open-ended freeform questions.
- When status is "complete", clarification_questions must be empty.
- When status is "needs_clarification", clarification_questions must contain 1 to 3 concrete questions.
- Preserve the user's original prompt in raw_input.
- Budget, commute, and unit requirements should only include values the user actually stated or strongly implied.
- Never invent numeric values for rent, travel time, square footage, lease length, bathroom count, or bedroom count.
- If a numeric field was not stated, use null.
- If no commute was mentioned, set commute to null.
- If no unit requirements were mentioned, set unit_requirements to null.
- constraints should contain lifestyle and proximity preferences beyond budget and the primary commute.
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
- field_path should identify the field to be updated, such as "budget.max_rent", "commute.max_minutes", or "unit_requirements.pets.allowed".`;

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

function buildExtractionPrompt(input: ApartmentPreferenceInput) {
	return [
		'User apartment preference input:',
		input.prompt,
		'',
		'Clarification answers already collected:',
		formatClarificationAnswers(input.clarification_answers),
		'',
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
