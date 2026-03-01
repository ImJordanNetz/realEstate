const DISALLOWED_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

const INDEX_SEGMENT = String.raw`(?:\.\d+|\[\d+\])`;

const ALLOWED_CLARIFICATION_FIELD_PATH_PATTERNS = [
	/^budget\.(max_rent|ideal_rent)$/,
	/^nightlife\.(preference|is_dealbreaker|importance)$/,
	/^commute\.(search_query|travel_mode|max_minutes|is_dealbreaker|importance)$/,
	new RegExp(
		String.raw`^constraints${INDEX_SEGMENT}\.(label|search_query|search_type|travel_mode|max_minutes|is_dealbreaker|importance)$`
	),
	/^unit_requirements\.bedrooms\.(min|max|is_dealbreaker|importance)$/,
	/^unit_requirements\.bathrooms\.(min|is_dealbreaker|importance)$/,
	/^unit_requirements\.pets\.(allowed|is_dealbreaker|importance)$/,
	new RegExp(String.raw`^unit_requirements\.pets\.pet_types${INDEX_SEGMENT}$`),
	/^unit_requirements\.parking\.(required|type_preference|is_dealbreaker|importance)$/,
	/^unit_requirements\.laundry\.(preference|is_dealbreaker|importance)$/,
	/^unit_requirements\.furnished\.(preferred|is_dealbreaker|importance)$/,
	/^unit_requirements\.sqft\.(min|max|is_dealbreaker|importance)$/,
	/^unit_requirements\.lease_length_months\.(min|max|is_dealbreaker|importance)$/,
	new RegExp(
		String.raw`^unit_requirements\.amenities${INDEX_SEGMENT}\.(name|is_dealbreaker|importance)$`
	)
];

function splitFieldPath(path: string) {
	return path
		.replace(/\[(\d+)\]/g, '.$1')
		.split('.')
		.filter(Boolean);
}

export function hasUnsafePathSegment(path: string) {
	return splitFieldPath(path).some((segment) => DISALLOWED_PATH_SEGMENTS.has(segment));
}

export function isAllowedClarificationFieldPath(path: string) {
	const trimmed = path.trim();
	if (!trimmed || hasUnsafePathSegment(trimmed)) {
		return false;
	}

	return ALLOWED_CLARIFICATION_FIELD_PATH_PATTERNS.some((pattern) => pattern.test(trimmed));
}
