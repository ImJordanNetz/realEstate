import type { ApartmentPreferences } from '$lib/server/apartment-preferences';

type NullableNumber = number | null;

export type ParkingType = 'garage' | 'covered' | 'surface' | 'street' | 'none';
export type LaundryType = 'in_unit' | 'on_site' | 'none';

export type ApartmentListingCandidate = {
	id: string;
	title: string;
	rent: NullableNumber;
	bedrooms: NullableNumber;
	bathrooms: NullableNumber;
	sqft: NullableNumber;
	lease_length_months: NullableNumber;
	furnished: boolean | null;
	parking: {
		available: boolean;
		type: ParkingType | null;
	} | null;
	laundry: LaundryType | null;
	pets:
		| {
				allowed: boolean;
				pet_types: string[] | null;
		  }
		| null;
	amenities: string[];
	commute_minutes: NullableNumber;
	proximity_minutes: Record<string, NullableNumber>;
};

export type RankingCriterionResult = {
	key: string;
	label: string;
	required: boolean;
	weight: number;
	score: number;
	status: 'pass' | 'fail' | 'unknown';
	reason: string;
	actual: string | number | boolean | null;
	target: string;
};

export type RankedApartment = {
	listing: ApartmentListingCandidate;
	total_score: number;
	soft_score: number;
	required_score: number;
	required_coverage: number;
	passes_required: boolean;
	required_pass_count: number;
	required_total: number;
	failed_required: RankingCriterionResult[];
	criteria: RankingCriterionResult[];
};

export type ApartmentRankingResult = {
	mode: 'strict' | 'fallback';
	ranked: RankedApartment[];
};

export type ApartmentRankingOptions = {
	maxResults?: number;
	budgetCapIsRequired?: boolean;
	unknownScore?: number;
	defaultTravelTargets?: Partial<Record<'walk' | 'bike' | 'drive' | 'transit', number>>;
};

type CriterionDefinition = {
	key: string;
	label: string;
	required: boolean;
	weight: number;
	evaluate: (listing: ApartmentListingCandidate, unknownScore: number) => RankingCriterionResult;
};

const DEFAULT_UNKNOWN_SCORE = 0.35;
const DEFAULT_MAX_RESULTS = 20;
const DEFAULT_TRAVEL_TARGETS: Record<'walk' | 'bike' | 'drive' | 'transit', number> = {
	walk: 10,
	bike: 15,
	drive: 20,
	transit: 30
};

function clamp(value: number, min = 0, max = 1) {
	return Math.min(max, Math.max(min, value));
}

function normalizeText(value: string) {
	return value.trim().toLowerCase();
}

function toCriterionKey(value: string) {
	return normalizeText(value)
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function formatMinutes(minutes: NullableNumber) {
	return minutes == null ? 'unknown' : `${minutes} min`;
}

function formatRange(min: NullableNumber, max: NullableNumber, unit = '') {
	if (min != null && max != null) {
		return `${min}-${max}${unit}`;
	}

	if (min != null) {
		return `>= ${min}${unit}`;
	}

	if (max != null) {
		return `<= ${max}${unit}`;
	}

	return 'unspecified';
}

function scoreUnknown(
	key: string,
	label: string,
	required: boolean,
	weight: number,
	target: string,
	reason: string,
	unknownScore: number
): RankingCriterionResult {
	return {
		key,
		label,
		required,
		weight,
		score: unknownScore,
		status: 'unknown',
		reason,
		actual: null,
		target
	};
}

function evaluateMaxTarget(
	key: string,
	label: string,
	required: boolean,
	weight: number,
	actual: NullableNumber,
	max: number,
	unknownScore: number,
	unit: string,
	softnessFloor = 5
): RankingCriterionResult {
	if (actual == null) {
		return scoreUnknown(
			key,
			label,
			required,
			weight,
			`<= ${max}${unit}`,
			`${label} is missing for this listing.`,
			unknownScore
		);
	}

	const overage = Math.max(0, actual - max);
	const softness = Math.max(softnessFloor, max * 0.35);
	const score = overage === 0 ? 1 : clamp(1 - overage / softness);
	const status = actual <= max ? 'pass' : 'fail';

	return {
		key,
		label,
		required,
		weight,
		score,
		status,
		reason:
			status === 'pass'
				? `${label} is within the target.`
				: `${label} exceeds the target by ${overage}${unit}.`,
		actual,
		target: `<= ${max}${unit}`
	};
}

function evaluateRangeTarget(
	key: string,
	label: string,
	required: boolean,
	weight: number,
	actual: NullableNumber,
	min: NullableNumber,
	max: NullableNumber,
	unknownScore: number,
	unit: string,
	softnessFloor = 1
): RankingCriterionResult {
	if (actual == null) {
		return scoreUnknown(
			key,
			label,
			required,
			weight,
			formatRange(min, max, unit),
			`${label} is missing for this listing.`,
			unknownScore
		);
	}

	const lowerGap = min == null ? 0 : Math.max(0, min - actual);
	const upperGap = max == null ? 0 : Math.max(0, actual - max);
	const gap = Math.max(lowerGap, upperGap);
	const reference = Math.max(
		softnessFloor,
		min != null ? min * 0.25 : 0,
		max != null ? max * 0.25 : 0
	);
	const withinRange = gap === 0;
	const score = withinRange ? 1 : clamp(1 - gap / reference);

	return {
		key,
		label,
		required,
		weight,
		score,
		status: withinRange ? 'pass' : 'fail',
		reason: withinRange
			? `${label} is within the desired range.`
			: `${label} is outside the desired range by ${gap}${unit}.`,
		actual,
		target: formatRange(min, max, unit)
	};
}

function evaluateBooleanTarget(
	key: string,
	label: string,
	required: boolean,
	weight: number,
	actual: boolean | null,
	target: boolean,
	unknownScore: number
): RankingCriterionResult {
	if (actual == null) {
		return scoreUnknown(
			key,
			label,
			required,
			weight,
			String(target),
			`${label} is missing for this listing.`,
			unknownScore
		);
	}

	const passed = actual === target;

	return {
		key,
		label,
		required,
		weight,
		score: passed ? 1 : 0,
		status: passed ? 'pass' : 'fail',
		reason: passed ? `${label} matches the preference.` : `${label} does not match the preference.`,
		actual,
		target: String(target)
	};
}

function evaluateTravelPreference(
	key: string,
	label: string,
	required: boolean,
	weight: number,
	actual: NullableNumber,
	targetMinutes: number,
	unknownScore: number
): RankingCriterionResult {
	return evaluateMaxTarget(key, label, required, weight, actual, targetMinutes, unknownScore, ' min', 8);
}

function scorePreferredTravelTime(actual: NullableNumber, targetMinutes: number, unknownScore: number) {
	if (actual == null) {
		return unknownScore;
	}

	if (actual <= targetMinutes) {
		return 1;
	}

	return clamp(1 - (actual - targetMinutes) / (targetMinutes * 2));
}

function buildCriterionResult(params: {
	key: string;
	label: string;
	required: boolean;
	weight: number;
	score: number;
	status: 'pass' | 'fail' | 'unknown';
	reason: string;
	actual: string | number | boolean | null;
	target: string;
}): RankingCriterionResult {
	return params;
}

function buildParkingCriterion(
	preferences: NonNullable<ApartmentPreferences['unit_requirements']>['parking']
): CriterionDefinition | null {
	if (!preferences) {
		return null;
	}

	const required = preferences.required || preferences.is_dealbreaker;
	const weight = preferences.importance;
	const targetType = preferences.type_preference;

	return {
		key: 'parking',
		label: 'Parking',
		required,
		weight,
		evaluate: (listing, unknownScore) => {
			if (!listing.parking) {
				return scoreUnknown(
					'parking',
					'Parking',
					required,
					weight,
					targetType ?? 'available parking',
					'Parking information is missing for this listing.',
					unknownScore
				);
			}

			const hasParking = listing.parking.available && listing.parking.type !== 'none';
			const matchesType =
				targetType == null ||
				targetType === 'any' ||
				listing.parking.type === targetType;

			const passed = hasParking && matchesType;
			const score = !hasParking ? 0 : matchesType ? 1 : 0.7;

			return buildCriterionResult({
				key: 'parking',
				label: 'Parking',
				required,
				weight,
				score,
				status: passed ? 'pass' : 'fail',
				reason: !hasParking
					? 'The listing does not offer parking.'
					: matchesType
						? 'The listing offers the preferred parking arrangement.'
						: 'The listing has parking, but not the preferred type.',
				actual: listing.parking.type ?? null,
				target: targetType ?? 'available parking'
			});
		}
	};
}

function buildLaundryCriterion(
	preferences: NonNullable<ApartmentPreferences['unit_requirements']>['laundry']
): CriterionDefinition | null {
	if (!preferences || preferences.preference === 'any') {
		return null;
	}

	const required = preferences.is_dealbreaker;
	const weight = preferences.importance;

	return {
		key: 'laundry',
		label: 'Laundry',
		required,
		weight,
		evaluate: (listing, unknownScore) => {
			if (listing.laundry == null) {
				return scoreUnknown(
					'laundry',
					'Laundry',
					required,
					weight,
					preferences.preference,
					'Laundry information is missing for this listing.',
					unknownScore
				);
			}

			const score =
				preferences.preference === 'in_unit'
					? listing.laundry === 'in_unit'
						? 1
						: listing.laundry === 'on_site'
							? 0.5
							: 0
					: listing.laundry === 'in_unit' || listing.laundry === 'on_site'
						? 1
						: 0;
			const passed =
				preferences.preference === 'in_unit'
					? listing.laundry === 'in_unit'
					: listing.laundry === 'in_unit' || listing.laundry === 'on_site';

			return buildCriterionResult({
				key: 'laundry',
				label: 'Laundry',
				required,
				weight,
				score,
				status: passed ? 'pass' : 'fail',
				reason: passed
					? 'Laundry setup matches the preference.'
					: 'Laundry setup is worse than the preferred option.',
				actual: listing.laundry,
				target: preferences.preference
			});
		}
	};
}

function buildPetsCriterion(
	preferences: NonNullable<ApartmentPreferences['unit_requirements']>['pets']
): CriterionDefinition | null {
	if (!preferences || !preferences.allowed) {
		return null;
	}

	const required = preferences.is_dealbreaker;
	const weight = preferences.importance;
	const wantedTypes = new Set((preferences.pet_types ?? []).map(normalizeText));

	return {
		key: 'pets',
		label: 'Pets',
		required,
		weight,
		evaluate: (listing, unknownScore) => {
			if (!listing.pets) {
				return scoreUnknown(
					'pets',
					'Pets',
					required,
					weight,
					wantedTypes.size ? Array.from(wantedTypes).join(', ') : 'pets allowed',
					'Pet policy is missing for this listing.',
					unknownScore
				);
			}

			const listingTypes = new Set((listing.pets.pet_types ?? []).map(normalizeText));
			const matchesRequestedType =
				!wantedTypes.size ||
				Array.from(wantedTypes).every((petType) => listingTypes.has(petType));
			const passed = listing.pets.allowed && matchesRequestedType;
			const score = listing.pets.allowed ? (matchesRequestedType ? 1 : 0.5) : 0;

			return buildCriterionResult({
				key: 'pets',
				label: 'Pets',
				required,
				weight,
				score,
				status: passed ? 'pass' : 'fail',
				reason: passed
					? 'The listing supports the requested pet policy.'
					: 'The pet policy does not meet the preference.',
				actual: listing.pets.allowed,
				target: wantedTypes.size ? Array.from(wantedTypes).join(', ') : 'pets allowed'
			});
		}
	};
}

function buildAmenityCriterion(
	name: string,
	required: boolean,
	weight: number
): CriterionDefinition {
	const normalizedName = normalizeText(name);

	return {
		key: `amenity:${toCriterionKey(name)}`,
		label: `Amenity: ${name}`,
		required,
		weight,
		evaluate: (listing) => {
			const hasAmenity = listing.amenities.some((amenity) => normalizeText(amenity) === normalizedName);

			return buildCriterionResult({
				key: `amenity:${toCriterionKey(name)}`,
				label: `Amenity: ${name}`,
				required,
				weight,
				score: hasAmenity ? 1 : 0,
				status: hasAmenity ? 'pass' : 'fail',
				reason: hasAmenity
					? 'The listing includes this amenity.'
					: 'The listing does not include this amenity.',
				actual: hasAmenity,
				target: name
			});
		}
	};
}

function buildConstraintKey(
	constraint: ApartmentPreferences['constraints'][number]
) {
	return toCriterionKey(`${constraint.label}-${constraint.search_query}-${constraint.travel_mode}`);
}

function compileCriteria(
	preferences: ApartmentPreferences,
	options: ApartmentRankingOptions
): CriterionDefinition[] {
	const criteria: CriterionDefinition[] = [];
	const unknownScore = clamp(options.unknownScore ?? DEFAULT_UNKNOWN_SCORE);
	const travelTargets = {
		...DEFAULT_TRAVEL_TARGETS,
		...options.defaultTravelTargets
	};

	if (preferences.budget.max_rent != null) {
		const required = options.budgetCapIsRequired ?? true;
		criteria.push({
			key: 'budget:max-rent',
			label: 'Rent cap',
			required,
			weight: 1,
			evaluate: (listing) =>
				evaluateMaxTarget(
					'budget:max-rent',
					'Rent cap',
					required,
					1,
					listing.rent,
					preferences.budget.max_rent!,
					unknownScore,
					' usd',
					250
				)
		});
	}

	if (preferences.budget.ideal_rent != null) {
		criteria.push({
			key: 'budget:ideal-rent',
			label: 'Ideal rent',
			required: false,
			weight: 0.55,
			evaluate: (listing) =>
				evaluateMaxTarget(
					'budget:ideal-rent',
					'Ideal rent',
					false,
					0.55,
					listing.rent,
					preferences.budget.ideal_rent!,
					unknownScore,
					' usd',
					400
				)
		});
	}

	if (preferences.commute) {
		const commute = preferences.commute;
		const targetMinutes = commute.max_minutes ?? travelTargets[commute.travel_mode];
		const required = commute.is_dealbreaker;

		criteria.push({
			key: 'commute',
			label: `Commute to ${commute.search_query}`,
			required,
			weight: commute.importance,
			evaluate: (listing) =>
				evaluateTravelPreference(
					'commute',
					`Commute to ${commute.search_query}`,
					required,
					commute.importance,
					listing.commute_minutes,
					targetMinutes,
					unknownScore
				)
		});
	}

	for (const constraint of preferences.constraints) {
		const key = buildConstraintKey(constraint);
		const targetMinutes = constraint.max_minutes ?? travelTargets[constraint.travel_mode];
		const required = constraint.is_dealbreaker;

		criteria.push({
			key,
			label: constraint.label,
			required,
			weight: constraint.importance,
			evaluate: (listing) => {
				const minutes = listing.proximity_minutes[key] ?? null;

				if (constraint.max_minutes != null) {
					return evaluateTravelPreference(
						key,
						constraint.label,
						required,
						constraint.importance,
						minutes,
						targetMinutes,
						unknownScore
					);
				}

				const score = scorePreferredTravelTime(minutes, targetMinutes, unknownScore);

				return buildCriterionResult({
					key,
					label: constraint.label,
					required,
					weight: constraint.importance,
					score,
					status: minutes == null ? 'unknown' : score >= 0.7 ? 'pass' : 'fail',
					reason:
						minutes == null
							? `${constraint.label} travel time is missing for this listing.`
							: `${constraint.label} is ${formatMinutes(minutes)} away.`,
					actual: minutes,
					target: `shorter is better; target ~${targetMinutes} min`
				});
			}
		});
	}

	const unitRequirements = preferences.unit_requirements;

	if (!unitRequirements) {
		return criteria;
	}

	if (unitRequirements.bedrooms) {
		const { min, max, is_dealbreaker, importance } = unitRequirements.bedrooms;
		criteria.push({
			key: 'bedrooms',
			label: 'Bedrooms',
			required: is_dealbreaker,
			weight: importance,
			evaluate: (listing) =>
				evaluateRangeTarget(
					'bedrooms',
					'Bedrooms',
					is_dealbreaker,
					importance,
					listing.bedrooms,
					min,
					max,
					unknownScore,
					' br',
					1
				)
		});
	}

	if (unitRequirements.bathrooms) {
		const { min, is_dealbreaker, importance } = unitRequirements.bathrooms;
		criteria.push({
			key: 'bathrooms',
			label: 'Bathrooms',
			required: is_dealbreaker,
			weight: importance,
			evaluate: (listing) =>
				evaluateRangeTarget(
					'bathrooms',
					'Bathrooms',
					is_dealbreaker,
					importance,
					listing.bathrooms,
					min,
					null,
					unknownScore,
					' ba',
					0.5
				)
		});
	}

	if (unitRequirements.sqft) {
		const { min, max, is_dealbreaker, importance } = unitRequirements.sqft;
		criteria.push({
			key: 'sqft',
			label: 'Square footage',
			required: is_dealbreaker,
			weight: importance,
			evaluate: (listing) =>
				evaluateRangeTarget(
					'sqft',
					'Square footage',
					is_dealbreaker,
					importance,
					listing.sqft,
					min,
					max,
					unknownScore,
					' sqft',
					100
				)
		});
	}

	if (unitRequirements.lease_length_months) {
		const { min, max, is_dealbreaker, importance } = unitRequirements.lease_length_months;
		criteria.push({
			key: 'lease-length',
			label: 'Lease length',
			required: is_dealbreaker,
			weight: importance,
			evaluate: (listing) =>
				evaluateRangeTarget(
					'lease-length',
					'Lease length',
					is_dealbreaker,
					importance,
					listing.lease_length_months,
					min,
					max,
					unknownScore,
					' mo',
					3
				)
		});
	}

	if (unitRequirements.furnished) {
		criteria.push({
			key: 'furnished',
			label: 'Furnished',
			required: unitRequirements.furnished.is_dealbreaker,
			weight: unitRequirements.furnished.importance,
			evaluate: (listing) =>
				evaluateBooleanTarget(
					'furnished',
					'Furnished',
					unitRequirements.furnished!.is_dealbreaker,
					unitRequirements.furnished!.importance,
					listing.furnished,
					unitRequirements.furnished!.preferred,
					unknownScore
				)
		});
	}

	const parkingCriterion = buildParkingCriterion(unitRequirements.parking);
	if (parkingCriterion) {
		criteria.push(parkingCriterion);
	}

	const laundryCriterion = buildLaundryCriterion(unitRequirements.laundry);
	if (laundryCriterion) {
		criteria.push(laundryCriterion);
	}

	const petsCriterion = buildPetsCriterion(unitRequirements.pets);
	if (petsCriterion) {
		criteria.push(petsCriterion);
	}

	for (const amenity of unitRequirements.amenities ?? []) {
		criteria.push(buildAmenityCriterion(amenity.name, amenity.is_dealbreaker, amenity.importance));
	}

	return criteria;
}

function computeAggregateScore(criteria: RankingCriterionResult[], required: boolean) {
	const relevant = criteria.filter((criterion) => criterion.required === required);

	if (!relevant.length) {
		return 1;
	}

	const totalWeight = relevant.reduce((sum, criterion) => sum + criterion.weight, 0);

	if (totalWeight === 0) {
		return 1;
	}

	const weightedScore = relevant.reduce(
		(sum, criterion) => sum + criterion.score * criterion.weight,
		0
	);

	return clamp(weightedScore / totalWeight);
}

function compareRankedApartments(a: RankedApartment, b: RankedApartment) {
	if (a.passes_required !== b.passes_required) {
		return a.passes_required ? -1 : 1;
	}

	if (a.required_coverage !== b.required_coverage) {
		return b.required_coverage - a.required_coverage;
	}

	if (a.soft_score !== b.soft_score) {
		return b.soft_score - a.soft_score;
	}

	if (a.total_score !== b.total_score) {
		return b.total_score - a.total_score;
	}

	if (a.listing.rent != null && b.listing.rent != null && a.listing.rent !== b.listing.rent) {
		return a.listing.rent - b.listing.rent;
	}

	return a.listing.id.localeCompare(b.listing.id);
}

export function buildApartmentConstraintKey(
	constraint: ApartmentPreferences['constraints'][number]
) {
	return buildConstraintKey(constraint);
}

export function rankApartments(
	preferences: ApartmentPreferences,
	listings: ApartmentListingCandidate[],
	options: ApartmentRankingOptions = {}
): ApartmentRankingResult {
	const criteria = compileCriteria(preferences, options);
	const ranked = listings.map((listing): RankedApartment => {
		const criterionResults = criteria.map((criterion) =>
			criterion.evaluate(listing, clamp(options.unknownScore ?? DEFAULT_UNKNOWN_SCORE))
		);
		const requiredCriteria = criterionResults.filter((criterion) => criterion.required);
		const failedRequired = requiredCriteria.filter((criterion) => criterion.status !== 'pass');
		const requiredPassCount = requiredCriteria.length - failedRequired.length;
		const requiredCoverage =
			requiredCriteria.length === 0 ? 1 : requiredPassCount / requiredCriteria.length;
		const softScore = computeAggregateScore(criterionResults, false);
		const requiredScore = computeAggregateScore(criterionResults, true);
		const passesRequired = failedRequired.length === 0;
		const totalScore = clamp(requiredScore * 0.7 + softScore * 0.3);

		return {
			listing,
			total_score: Number(totalScore.toFixed(4)),
			soft_score: Number(softScore.toFixed(4)),
			required_score: Number(requiredScore.toFixed(4)),
			required_coverage: Number(requiredCoverage.toFixed(4)),
			passes_required: passesRequired,
			required_pass_count: requiredPassCount,
			required_total: requiredCriteria.length,
			failed_required: failedRequired,
			criteria: criterionResults
		};
	});

	ranked.sort(compareRankedApartments);

	const strictMatches = ranked.filter((listing) => listing.passes_required);
	const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;

	if (strictMatches.length > 0) {
		return {
			mode: 'strict',
			ranked: strictMatches.slice(0, maxResults)
		};
	}

	return {
		mode: 'fallback',
		ranked: ranked.slice(0, maxResults)
	};
}
