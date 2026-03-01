<script lang="ts">
	import { tick } from "svelte";
	import type {
		ApartmentPreferenceExtractionResponse,
		ApartmentPreferences,
	} from "$lib/server/apartment-preferences";
	import {
		createAssistantExtractionMessage,
		createClarificationAnswerMessage,
		createUserPreferenceMessage,
		finalizeExtractionWithClarifications,
		getExtractionErrorMessage,
		requestListingPreferenceExtraction,
		type ClarificationAnswerMap,
		type ExtractionError,
		type PreferenceConversationMessage,
	} from "$lib/listings/preferences";
	import {
		getApartmentSearchErrorMessage,
		requestApartmentSearch,
		type ApartmentSearchError,
		type ApartmentSearchResponse,
	} from "$lib/listings/search";
	import Map from "$lib/components/ui/map/Map.svelte";
	import MapClusterLayer from "$lib/components/ui/map/MapClusterLayer.svelte";
	import MapHeatmapLayer from "$lib/components/ui/map/MapHeatmapLayer.svelte";
	import MapRouteLayer, {
		type RouteLine,
		type RouteMarker,
	} from "$lib/components/ui/map/MapRouteLayer.svelte";
	import MapPOILayer, {
		type POIPoint,
	} from "$lib/components/ui/map/MapPOILayer.svelte";
	import {
		requestDirections,
		type RouteDestination,
	} from "$lib/listings/directions";
	import ListingCard, {
		type ListingCardListing,
		type ListingHighlight,
	} from "$lib/components/ListingCard.svelte";
	import ClarifyingQuestions from "$lib/components/ClarifyingQuestions.svelte";
	import GridSpinner from "$lib/components/ui/GridSpinner.svelte";
	import { Skeleton } from "$lib/components/ui/skeleton";
	import { LocalStore } from "$lib/localStore.svelte";
	import { fromStore } from "svelte/store";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let baseListings = $derived(data.listings);
	let nightlifeCells = $derived(data.nightlifeCells);
	let interiorPhotos = $derived(data.interiorPhotos);

	type RepresentativeInteriorPhoto = PageData["interiorPhotos"][number];
	const ROOM_TYPE_ORDER = [
		"living-room",
		"kitchen",
		"bedroom",
		"bathroom",
		"dining",
		"balcony",
	] as const;

	let nightlifeGeoJSON = $derived.by(
		(): GeoJSON.FeatureCollection<GeoJSON.Point> => ({
			type: "FeatureCollection",
			features: nightlifeCells.map((cell) => ({
				type: "Feature" as const,
				geometry: {
					type: "Point" as const,
					coordinates: [cell.lng, cell.lat],
				},
				properties: {
					intensity: cell.intensity,
				},
			})),
		}),
	);
	let prompt = $derived(data.prompt);
	let query = $state("");
	let result = $state<ApartmentPreferenceExtractionResponse | null>(null);
	let apiError = $state<ExtractionError | null>(null);
	let isLoading = $state(false);
	let activePrompt = $state("");
	let preferenceMessageHistory = $state<PreferenceConversationMessage[]>([]);
	let questionsSubmitted = $state(false);
	let searchResult = $state<ApartmentSearchResponse | null>(null);
	let searchError = $state<ApartmentSearchError | null>(null);
	let isSearchingMatches = $state(false);
	let lastSearchFingerprint = "";
	let apartmentSearchRequestCount = 0;
	const favoriteListingIdsStore = new LocalStore<string[]>(
		"favorite-listing-ids",
		[],
	);
	const favoriteListingIds = fromStore(favoriteListingIdsStore);
	let favoriteListingIdSet = $derived(new Set(favoriteListingIds.current));
	let showOnlyFavorites = $state(false);

	function uiLog(step: string, details?: Record<string, unknown>) {
		console.info(`[listings-ui] ${step}`, details ?? {});
	}

	function resetPreferenceFlowState() {
		result = null;
		apiError = null;
		questionsSubmitted = false;
		searchResult = null;
		searchError = null;
		isSearchingMatches = false;
		lastSearchFingerprint = "";
		selectedListingId = null;
		routeLines = [];
		routeDestinations = [];
		nearbyPOIs = [];
		lastPOIListingId = "";
	}

	type PreferenceExtractionRunOptions = {
		prompt: string;
		priorHistory?: PreferenceConversationMessage[];
		currentProfile?: ApartmentPreferences | null;
		signal: AbortSignal;
	};

	async function runPreferenceExtraction({
		prompt,
		priorHistory = [],
		currentProfile = null,
		signal,
	}: PreferenceExtractionRunOptions) {
		const nextPrompt = prompt.trim();
		if (!nextPrompt) return;

		const nextUserMessage = createUserPreferenceMessage(nextPrompt);
		activePrompt = nextPrompt;
		isLoading = true;
		resetPreferenceFlowState();

		try {
			uiLog("preference_extraction_start", {
				promptLength: nextPrompt.length,
				historyMessages: priorHistory.length,
				hasCurrentProfile: !!currentProfile,
			});
			const { response, payload } = await requestListingPreferenceExtraction({
				prompt: nextPrompt,
				messageHistory: priorHistory,
				currentProfile,
				signal,
			});

			if (signal.aborted) {
				return;
			}

			if (!response.ok) {
				uiLog("preference_extraction_response_error", {
					status: response.status,
					message: getExtractionErrorMessage(payload),
				});
				apiError = {
					message: getExtractionErrorMessage(payload),
					status: response.status,
				};
				return;
			}

			const extractionResult =
				payload as ApartmentPreferenceExtractionResponse;
			uiLog("preference_extraction_complete", {
				status: extractionResult.preferences.status,
				clarificationQuestions:
					extractionResult.preferences.clarification_questions.length,
			});
			result = extractionResult;
			preferenceMessageHistory = [
				...priorHistory,
				nextUserMessage,
				createAssistantExtractionMessage(extractionResult),
			];

			if (
				extractionResult.preferences.clarification_questions.length === 0
			) {
				questionsSubmitted = true;
			}
		} catch (error) {
			if (signal.aborted) {
				return;
			}

			uiLog("preference_extraction_failed", {
				message:
					error instanceof Error
						? error.message
						: "Failed to extract listing preferences.",
			});
			apiError = {
				message:
					error instanceof Error
						? error.message
						: "Failed to extract listing preferences.",
				status: 500,
			};
		} finally {
			if (!signal.aborted) {
				isLoading = false;
			}
		}
	}

	async function submitPreferenceRevision(
		nextPrompt: string,
		signal: AbortSignal,
	) {
		await runPreferenceExtraction({
			prompt: nextPrompt,
			priorHistory: preferenceMessageHistory,
			currentProfile: result?.preferences.profile ?? null,
			signal,
		});
	}

	function formatNumber(value: number | null | undefined) {
		if (value == null) return "—";
		return Math.round(value).toString();
	}

	function normalizeAddress(address: string): string {
		return address.replace(/,?\s*#\s*[\w-]+/, "").trim();
	}

	function hashString(value: string) {
		let hash = 0;
		for (let i = 0; i < value.length; i += 1) {
			hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
		}
		return hash;
	}

	function rotateItems<T>(items: T[], offset: number) {
		if (items.length === 0) return [];
		const normalizedOffset = offset % items.length;
		return [
			...items.slice(normalizedOffset),
			...items.slice(0, normalizedOffset),
		];
	}

	function dedupeListings<
		T extends {
			address: string;
			price: number | null;
			bedrooms: number | null;
			bathrooms: number | null;
			sqft: number | null;
		},
	>(items: T[]): T[] {
		const seen = new Set<string>();
		return items.filter((item) => {
			const key = `${normalizeAddress(item.address)}|${item.price}|${item.bedrooms}|${item.bathrooms}|${item.sqft}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}

	function sortFavoritesFirst<T extends { id: string }>(items: T[]): T[] {
		return [...items].sort((left, right) => {
			const leftFavorited = favoriteListingIdSet.has(left.id) ? 1 : 0;
			const rightFavorited = favoriteListingIdSet.has(right.id) ? 1 : 0;
			return rightFavorited - leftFavorited;
		});
	}

	let interiorPhotosByRoom = $derived.by(() => {
		const groups = new globalThis.Map<
			string,
			RepresentativeInteriorPhoto[]
		>();
		for (const photo of interiorPhotos) {
			const group = groups.get(photo.roomType) ?? [];
			group.push(photo);
			if (!groups.has(photo.roomType)) {
				groups.set(photo.roomType, group);
			}
		}
		return groups;
	});

	function buildRepresentativePhotoSet(listingId: string) {
		if (interiorPhotos.length === 0) return [];

		const seed = hashString(listingId);
		const selected: RepresentativeInteriorPhoto[] = [];
		const seen = new Set<string>();

		for (const [roomIndex, roomType] of ROOM_TYPE_ORDER.entries()) {
			const roomPhotos = interiorPhotosByRoom.get(roomType) ?? [];
			if (roomPhotos.length === 0) continue;

			const photo = roomPhotos[(seed + roomIndex) % roomPhotos.length];
			if (seen.has(photo.localPath)) continue;

			selected.push(photo);
			seen.add(photo.localPath);
		}

		for (const photo of rotateItems(
			interiorPhotos,
			seed % interiorPhotos.length,
		)) {
			if (selected.length >= Math.min(6, interiorPhotos.length)) break;
			if (seen.has(photo.localPath)) continue;

			selected.push(photo);
			seen.add(photo.localPath);
		}

		return rotateItems(selected, seed % selected.length);
	}

	function formatCriteriaHighlight(
		criterion: ApartmentSearchResponse["ranked"][number]["criteria"][number],
	): ListingHighlight | null {
		if (typeof criterion.actual !== "number") {
			return null;
		}

		let text: string;
		if (criterion.target.includes("min")) {
			text = `${criterion.label}: ${formatNumber(criterion.actual)} min`;
		} else if (criterion.target.includes("usd")) {
			text = `${criterion.label}: $${formatNumber(criterion.actual)}`;
		} else {
			text = `${criterion.label}: ${formatNumber(criterion.actual)}`;
		}

		return { text, status: criterion.status };
	}

	let listingCards = $derived.by((): ListingCardListing[] => {
		if (!searchResult) {
			const mapped = baseListings.map((listing) => ({
				id: listing.id,
				address: listing.address,
				placeId: listing.placeId,
				lat: listing.lat,
				lng: listing.lng,
				bedrooms: listing.bedrooms,
				bathrooms: listing.bathrooms,
				sqft: listing.sqft,
				price: listing.price,
				representativePhotos: buildRepresentativePhotoSet(listing.id),
			}));
			return sortFavoritesFirst(dedupeListings(mapped)).slice(0, 10);
		}

		const mapped = searchResult.ranked.map((hit) => {
			const highlights = hit.criteria
				.map(formatCriteriaHighlight)
				.filter((value): value is ListingHighlight => !!value)
				.filter((value) => !value.text.startsWith("Rent cap"))
				.slice(0, 5);

			return {
				id: hit.listing.id,
				address: hit.listing.address,
				placeId: hit.listing.place_id,
				lat: hit.listing.location.lat,
				lng: hit.listing.location.lng,
				bedrooms: hit.listing.bedrooms,
				bathrooms: hit.listing.bathrooms,
				sqft: hit.listing.sqft,
				price: hit.listing.rent,
				matchScore: hit.total_score,
				requiredSummary: null,
				highlights,
				representativePhotos: buildRepresentativePhotoSet(
					hit.listing.id,
				),
			};
		});
		return sortFavoritesFirst(dedupeListings(mapped));
	});

	let displayedListingCards = $derived(
		showOnlyFavorites
			? listingCards.filter((l) => favoriteListingIdSet.has(l.id))
			: listingCards,
	);

	function toggleListingFavorite(listingId: string) {
		favoriteListingIdsStore.update((ids) =>
			ids.includes(listingId)
				? ids.filter((id) => id !== listingId)
				: [...ids, listingId],
		);
	}

	let listings = $derived.by(() => {
		if (!searchResult) {
			return baseListings;
		}

		return searchResult.ranked.map((hit) => ({
			id: hit.listing.id,
			address: hit.listing.address,
			lat: hit.listing.location.lat,
			lng: hit.listing.location.lng,
			bedrooms: hit.listing.bedrooms,
			bathrooms: hit.listing.bathrooms,
			sqft: hit.listing.sqft,
			price: hit.listing.rent,
		}));
	});

	let displayedListings = $derived(
		showOnlyFavorites
			? listings.filter((l) => favoriteListingIdSet.has(l.id))
			: listings,
	);

	let completedProfile = $derived.by(() => {
		if (!result) return null;
		if (result.preferences.clarification_questions.length > 0) return null;
		return result.preferences.profile;
	});

	let usesWalkingOrBiking = $derived.by(() => {
		if (!completedProfile) return false;
		const constraints = Array.isArray(completedProfile.constraints)
			? completedProfile.constraints
			: [];

		return (
			completedProfile.commute?.travel_mode === "bike" ||
			completedProfile.commute?.travel_mode === "walk" ||
			constraints.some(
				(constraint) =>
					constraint.travel_mode === "bike" ||
					constraint.travel_mode === "walk",
			)
		);
	});

	let listingBounds = $derived.by(() => {
		if (displayedListings.length === 0) return undefined;

		let minLng = Infinity,
			maxLng = -Infinity;
		let minLat = Infinity,
			maxLat = -Infinity;

		for (const l of displayedListings) {
			if (l.lng < minLng) minLng = l.lng;
			if (l.lng > maxLng) maxLng = l.lng;
			if (l.lat < minLat) minLat = l.lat;
			if (l.lat > maxLat) maxLat = l.lat;
		}

		return [
			[minLng, minLat],
			[maxLng, maxLat],
		] as [[number, number], [number, number]];
	});

	let listingsGeoJSON = $derived.by(
		(): GeoJSON.FeatureCollection<GeoJSON.Point> => ({
			type: "FeatureCollection",
			features: displayedListings.map((l) => ({
				type: "Feature" as const,
				geometry: {
					type: "Point" as const,
					coordinates: [l.lng, l.lat],
				},
				properties: {
					id: l.id,
					price: l.price,
					address: l.address,
					bedrooms: l.bedrooms,
					bathrooms: l.bathrooms,
					sqft: l.sqft,
				},
			})),
		}),
	);

	// When the left panel is showing (questionsSubmitted), add extra left padding
	// so the map centers in the visible 2/3 of the screen.
	// The card takes ~33.3% of the viewport width, so we pad the left by that amount.
	let innerWidth = $state(
		typeof window !== "undefined" ? window.innerWidth : 1200,
	);
	let mapPadding = $derived(
		questionsSubmitted
			? {
					top: 60,
					bottom: 60,
					left: Math.round(innerWidth / 3) + 60,
					right: 60,
				}
			: 60,
	);
	let floatingCardTopPadding = $derived(
		questionsSubmitted ? "6rem" : "1.5rem",
	);

	// Typewriter loading phrases
	const loadingPhrases = [
		"Blorping the floorplans",
		"Consulting the landlord spirits",
		"Measuring closet vibes",
		"Sniffing out good deals",
		"Judging kitchen counter space",
		"Asking the walls if they talk",
		"Counting ceiling fans aggressively",
		"Befriending neighborhood cats",
		"Rating sunset views from balconies",
		"Interrogating the garbage disposal",
	];
	let typewriterText = $state("");

	$effect(() => {
		if (!isLoading) {
			typewriterText = "";
			return;
		}

		let charIndex = 0;
		let isDeleting = false;
		let phraseIndex = Math.floor(Math.random() * loadingPhrases.length);
		let timeout: ReturnType<typeof setTimeout>;

		function tick() {
			const phrase = loadingPhrases[phraseIndex];

			if (!isDeleting) {
				charIndex++;
				typewriterText = phrase.slice(0, charIndex);
				if (charIndex === phrase.length) {
					timeout = setTimeout(() => {
						isDeleting = true;
						tick();
					}, 1400);
					return;
				}
				timeout = setTimeout(tick, 60 + Math.random() * 40);
			} else {
				charIndex--;
				typewriterText = phrase.slice(0, charIndex);
				if (charIndex === 0) {
					isDeleting = false;
					phraseIndex = (phraseIndex + 1) % loadingPhrases.length;
					timeout = setTimeout(tick, 300);
					return;
				}
				timeout = setTimeout(tick, 30 + Math.random() * 20);
			}
		}

		tick();
		return () => clearTimeout(timeout);
	});

	const hasPrompt = $derived(prompt.length > 0);

	function handleQuestionsSubmit(answers: ClarificationAnswerMap) {
		if (!result) {
			return;
		}

		uiLog("clarifications_submitted", {
			answerIds: Object.keys(answers),
			answerCount: Object.keys(answers).length,
		});

		const updatedResult = finalizeExtractionWithClarifications(
			result,
			answers,
		);

		apiError = null;
		searchError = null;
		searchResult = null;
		questionsSubmitted = true;
		preferenceMessageHistory = [
			...preferenceMessageHistory,
			createClarificationAnswerMessage(
				result.preferences.clarification_questions,
				answers,
			),
		];
		result = updatedResult;
	}

	$effect(() => {
		query = prompt;

		if (!prompt) {
			activePrompt = "";
			isLoading = false;
			preferenceMessageHistory = [];
			resetPreferenceFlowState();
			return;
		}

		const controller = new AbortController();
		preferenceMessageHistory = [];
		void runPreferenceExtraction({
			prompt,
			signal: controller.signal,
		});

		return () => controller.abort();
	});

	$effect(() => {
		const profile = completedProfile;

		if (!profile) {
			isSearchingMatches = false;
			searchResult = null;
			searchError = null;
			lastSearchFingerprint = "";
			return;
		}

		const fingerprint = JSON.stringify(profile);

		if (fingerprint === lastSearchFingerprint) {
			uiLog("apartment_search_skipped_duplicate_profile", {
				fingerprintLength: fingerprint.length,
			});
			return;
		}

		lastSearchFingerprint = fingerprint;
		const controller = new AbortController();
		const requestId = ++apartmentSearchRequestCount;
		const startedAt = Date.now();
		isSearchingMatches = true;
		searchResult = null;
		searchError = null;

		void (async () => {
			try {
				const constraints = Array.isArray(profile.constraints)
					? profile.constraints
					: [];
				uiLog("apartment_search_start", {
					requestId,
					hasCommute: !!profile.commute,
					constraints: constraints.length,
					fingerprintLength: fingerprint.length,
				});
				const { response, payload } = await requestApartmentSearch({
					preferences: profile,
					signal: controller.signal,
				});

				if (controller.signal.aborted) {
					uiLog("apartment_search_ignored_after_abort", {
						requestId,
						durationMs: Date.now() - startedAt,
					});
					return;
				}

				if (!response.ok) {
					uiLog("apartment_search_response_error", {
						requestId,
						status: response.status,
						message: getApartmentSearchErrorMessage(payload),
						durationMs: Date.now() - startedAt,
					});
					searchError = {
						message: getApartmentSearchErrorMessage(payload),
						status: response.status,
					};
					return;
				}

				const rankingResult = payload as ApartmentSearchResponse;
				uiLog("apartment_search_complete", {
					requestId,
					mode: rankingResult.mode,
					results: rankingResult.ranked.length,
					topListingIds: rankingResult.ranked
						.slice(0, 5)
						.map((hit) => hit.listing.id),
					durationMs: Date.now() - startedAt,
				});
				searchResult = rankingResult;
			} catch (error) {
				if (controller.signal.aborted) {
					uiLog("apartment_search_aborted", {
						requestId,
						durationMs: Date.now() - startedAt,
					});
					return;
				}

				uiLog("apartment_search_failed", {
					requestId,
					message:
						error instanceof Error
							? error.message
							: "Failed to rank apartments.",
					durationMs: Date.now() - startedAt,
				});
				searchError = {
					message:
						error instanceof Error
							? error.message
							: "Failed to rank apartments.",
					status: 500,
				};
			} finally {
				if (!controller.signal.aborted) {
					isSearchingMatches = false;
					uiLog("apartment_search_finish", {
						requestId,
						durationMs: Date.now() - startedAt,
					});
				}
			}
		})();

		return () => {
			if (!controller.signal.aborted) {
				uiLog("apartment_search_cleanup_abort", {
					requestId,
					durationMs: Date.now() - startedAt,
				});
				controller.abort();
			}
		};
	});

	let leftPanelRightPadding = $derived(questionsSubmitted ? "pr-1" : "");

	// Map interaction: clicking a listing focuses the map on it
	let mapInstance: import("maplibre-gl").Map | null = $state(null);
	let selectedListingId = $state<string | null>(null);
	let listingsScrollContainer: HTMLDivElement | null = $state(null);

	async function selectListing(
		listingId: string,
		options: {
			scrollIntoView?: boolean;
			behavior?: ScrollBehavior;
		} = {},
	) {
		const { scrollIntoView = false, behavior = "auto" } = options;
		const container = listingsScrollContainer;
		const listingElement = document.getElementById(`listing-${listingId}`);
		const previousOffset =
			container && listingElement
				? listingElement.getBoundingClientRect().top -
					container.getBoundingClientRect().top
				: null;

		selectedListingId = listingId;
		await tick();

		if (container && listingElement && previousOffset != null) {
			const nextOffset =
				listingElement.getBoundingClientRect().top -
				container.getBoundingClientRect().top;
			container.scrollTop += nextOffset - previousOffset;
		}

		if (scrollIntoView) {
			listingElement?.scrollIntoView({ behavior, block: "nearest" });
		}
	}

	function handleListingClick(listing: ListingCardListing) {
		void selectListing(listing.id);
		// The map will be fitted to include the listing + its destinations
		// inside the $effect that builds routeDestinations.
	}

	function handleMapPointClick(
		feature: GeoJSON.Feature<GeoJSON.Point>,
		_coordinates: [number, number],
	) {
		const id = feature.properties?.id as string | undefined;
		if (!id) return;
		void selectListing(id, { scrollIntoView: true, behavior: "smooth" });
	}

	// --- Route polylines on selected listing ---
	let routeLines = $state<RouteLine[]>([]);
	let routeDestinations = $state<RouteMarker[]>([]);

	// --- Nearby POIs on selected listing ---
	let nearbyPOIs = $state<POIPoint[]>([]);

	// Filter out POIs that overlap with route destinations to avoid duplicate markers
	let filteredPOIs = $derived.by(() => {
		if (routeDestinations.length === 0) return nearbyPOIs;
		const destPlaceIds = new Set(
			routeDestinations
				.map((d) => d.placeId)
				.filter((id): id is string => !!id),
		);
		if (destPlaceIds.size === 0) return nearbyPOIs;
		return nearbyPOIs.filter((poi) => !destPlaceIds.has(poi.id));
	});

	function buildConstraintKey(constraint: {
		label: string;
		search_query: string;
		travel_mode: string;
	}) {
		return `${constraint.label}-${constraint.search_query}-${constraint.travel_mode}`
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
	}

	/** Fit the map to show the listing origin and all its route destinations. */
	function fitMapToListingAndDestinations(
		origin: { lat: number; lng: number },
		markers: RouteMarker[],
	) {
		if (!mapInstance) return;

		const points: [number, number][] = [
			[origin.lng, origin.lat],
			...markers.map((m) => [m.lng, m.lat] as [number, number]),
		];

		// Compute bounding box
		let minLng = Infinity,
			minLat = Infinity,
			maxLng = -Infinity,
			maxLat = -Infinity;
		for (const [lng, lat] of points) {
			if (lng < minLng) minLng = lng;
			if (lng > maxLng) maxLng = lng;
			if (lat < minLat) minLat = lat;
			if (lat > maxLat) maxLat = lat;
		}

		const panelPixels = questionsSubmitted ? Math.round(innerWidth / 3) : 0;

		mapInstance.fitBounds(
			[
				[minLng, minLat],
				[maxLng, maxLat],
			],
			{
				padding: {
					top: 60,
					bottom: 60,
					left: panelPixels + 60,
					right: 60,
				},
				maxZoom: 15,
				duration: 800,
			},
		);
	}

	$effect(() => {
		const listingId = selectedListingId;
		const profile = completedProfile;
		const result = searchResult;

		// Clear routes if no selection or no search results
		if (!listingId || !result || !profile) {
			routeLines = [];
			routeDestinations = [];
			return;
		}

		const hit = result.ranked.find((h) => h.listing.id === listingId);
		if (!hit) {
			routeLines = [];
			routeDestinations = [];
			return;
		}

		const origin = {
			lat: hit.listing.location.lat,
			lng: hit.listing.location.lng,
		};

		// Build destinations from matched_places
		const dests: RouteDestination[] = [];
		const markers: RouteMarker[] = [];

		// Commute destination
		if (hit.matched_places.commute && profile.commute) {
			const place = hit.matched_places.commute;
			dests.push({
				id: "commute",
				label: place.name,
				lat: place.location.lat,
				lng: place.location.lng,
				travelMode: profile.commute.travel_mode,
				minutes: hit.derived_metrics.commute_minutes,
			});
			markers.push({
				id: "commute",
				name: place.name,
				lat: place.location.lat,
				lng: place.location.lng,
				minutes: hit.derived_metrics.commute_minutes,
				placeId: place.id,
				address: place.address,
			});
		}

		// Constraint destinations
		const constraints = Array.isArray(profile.constraints)
			? profile.constraints
			: [];
		for (const constraint of constraints) {
			const key = buildConstraintKey(constraint);
			const place = hit.matched_places.constraints[key];
			if (!place) continue;

			dests.push({
				id: key,
				label: place.name,
				lat: place.location.lat,
				lng: place.location.lng,
				travelMode: constraint.travel_mode,
				minutes: hit.derived_metrics.proximity_minutes[key] ?? null,
			});
			markers.push({
				id: key,
				name: place.name,
				lat: place.location.lat,
				lng: place.location.lng,
				minutes: hit.derived_metrics.proximity_minutes[key] ?? null,
				placeId: place.id,
				address: place.address,
			});
		}

		if (dests.length === 0) {
			routeLines = [];
			routeDestinations = [];
			// Still fly to the listing even if there are no destinations
			if (mapInstance) {
				const panelPixels = questionsSubmitted
					? Math.round(innerWidth / 3)
					: 0;
				mapInstance.flyTo({
					center: [origin.lng, origin.lat],
					zoom: 15,
					duration: 800,
					padding: { top: 0, bottom: 0, left: panelPixels, right: 0 },
				});
			}
			return;
		}

		// Set markers immediately (before polylines arrive)
		routeDestinations = markers;

		// Fit the map to show the listing + all its destinations
		fitMapToListingAndDestinations(origin, markers);

		const controller = new AbortController();

		void requestDirections({
			listingId,
			origin,
			destinations: dests,
			signal: controller.signal,
		})
			.then((result) => {
				if (controller.signal.aborted) return;
				routeLines = result.routes;
			})
			.catch(() => {
				if (controller.signal.aborted) return;
				// Silently fail — markers still show
				routeLines = [];
			});

		return () => controller.abort();
	});

	// --- Fetch nearby POIs when a listing is selected ---
	let lastPOIListingId = "";
	$effect(() => {
		const listingId = selectedListingId;

		if (!listingId) {
			nearbyPOIs = [];
			lastPOIListingId = "";
			return;
		}

		// Find the listing coordinates
		const listing = listings.find((l) => l.id === listingId);
		if (!listing) {
			nearbyPOIs = [];
			return;
		}

		// Don't refetch if same listing
		if (listingId === lastPOIListingId) return;
		lastPOIListingId = listingId;

		const controller = new AbortController();

		void fetch("/api/listings/nearby", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ lat: listing.lat, lng: listing.lng }),
			signal: controller.signal,
		})
			.then((res) => res.json())
			.then((data) => {
				if (controller.signal.aborted) return;
				const points: POIPoint[] = [];
				const pois = data.pois as Record<
					string,
					Array<{
						id: string;
						name: string;
						lat: number;
						lng: number;
						address: string | null;
					}>
				>;
				for (const [category, places] of Object.entries(pois)) {
					for (const place of places) {
						points.push({ ...place, category });
					}
				}
				nearbyPOIs = points;
			})
			.catch(() => {
				if (controller.signal.aborted) return;
				nearbyPOIs = [];
			});

		return () => controller.abort();
	});
</script>

<svelte:window bind:innerWidth />

<svelte:head>
	<title>Listings</title>
</svelte:head>

<!-- Full-screen map background -->
<div class="relative h-screen">
	<div class="absolute inset-0">
		<Map
			center={[-117.8265, 33.6846]}
			zoom={12}
			bounds={listingBounds}
			boundsPadding={mapPadding}
			styles={{
				light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
				dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
			}}
			onmapcreated={(m) => (mapInstance = m)}
		>
			<!-- <MapHeatmapLayer
				data={nightlifeGeoJSON}
				intensityProperty="intensity"
				maxIntensity={93}
				radius={30}
				opacity={0.6}
			/> -->
			<MapClusterLayer
				data={listingsGeoJSON}
				clusterRadius={40}
				clusterMaxZoom={16}
				clusterThresholds={[10, 50]}
				clusterColors={["#6d28d9", "#7c3aed", "#8b5cf6"]}
				pointColor="#6d28d9"
				selectedPointId={selectedListingId}
				onpointclick={handleMapPointClick}
			/>
			<MapPOILayer pois={filteredPOIs} />
			<MapRouteLayer
				routes={routeLines}
				destinations={routeDestinations}
			/>
		</Map>
	</div>

	<!-- Content card floating over the map -->
	<div
		class="pointer-events-none absolute inset-0 flex justify-start p-6"
		style="align-items: {questionsSubmitted
			? 'stretch'
			: 'center'}; padding-top: {floatingCardTopPadding}; transition: align-items 0s;"
	>
		<div
			class="pointer-events-auto flex flex-col gap-6 overflow-hidden rounded-[2rem] border border-border bg-card/80 p-5 {leftPanelRightPadding} shadow-2xl shadow-black/15 backdrop-blur-xl"
			style="
				width: {questionsSubmitted ? '33.333%' : '80%'};
				max-width: {questionsSubmitted ? 'none' : '64rem'};
				max-height: {questionsSubmitted ? 'none' : 'calc(100vh - 8rem)'};
				transform: translateX({questionsSubmitted
				? '0%'
				: 'calc(50vw - 50% - 1.5rem)'});
				transition: width 700ms cubic-bezier(0.4, 0, 0.2, 1), max-width 700ms cubic-bezier(0.4, 0, 0.2, 1), transform 700ms cubic-bezier(0.4, 0, 0.2, 1);
				text-align: {questionsSubmitted ? 'left' : 'center'};
			"
		>
			{#if !hasPrompt}
				<!-- Empty state: no prompt -->
				<div class="flex flex-col items-center gap-6 py-8 text-center">
					<div
						class="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10"
					>
						<svg
							class="h-8 w-8 text-primary"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							stroke-width="1.5"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
							/>
						</svg>
					</div>
					<div>
						<h1
							class="font-serif text-3xl tracking-tight text-foreground"
						>
							Find your perfect place
						</h1>
						<p
							class="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground"
						>
							Describe what you're looking for in natural
							language. We'll analyze your preferences and help
							you find the best match.
						</p>
					</div>
					<form
						action="/listings"
						method="GET"
						class="w-full max-w-lg"
					>
						<div class="flex flex-col gap-3">
							<textarea
								id="prompt"
								name="prompt"
								rows="3"
								bind:value={query}
								class="w-full rounded-2xl border border-border bg-card/70 px-5 py-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
								placeholder="e.g. I want a 2BR near UCI with a pool, under $2500/mo, pet-friendly..."
							></textarea>
							<button
								type="submit"
								class="w-full rounded-2xl bg-primary px-5 py-3.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition hover:bg-primary/90"
							>
								Search listings
							</button>
						</div>
					</form>
					<a
						href="/"
						class="text-sm font-medium text-muted-foreground transition hover:text-primary"
					>
						or go back home
					</a>
				</div>
			{:else if isLoading}
				<!-- Loading state: typewriter -->
				<div class="flex flex-col items-center gap-8 py-12 text-center">
					<h2
						class="font-serif text-2xl tracking-tight text-foreground"
					>
						Searching for your dream place
					</h2>
					<div
						class="w-full max-w-sm rounded-2xl border border-border/80 bg-muted/60 px-6 py-5"
					>
						<p
							class="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground"
						>
							Your prompt
						</p>
						<p class="mt-3 text-sm leading-relaxed text-foreground">
							{activePrompt}
						</p>
					</div>
					<div class="flex h-7 items-center justify-center gap-3">
						<GridSpinner size="20px" class="text-primary" />
						<span
							class="font-serif text-lg tracking-tight text-foreground"
							>{typewriterText}<span
								class="ml-px inline-block h-5 w-[2px] translate-y-[2px] animate-[blink_1s_steps(1)_infinite] bg-primary/70"
							></span></span
						>
					</div>
				</div>
			{:else if apiError}
				<!-- Error state -->
				<div class="flex flex-col items-center gap-5 py-8 text-center">
					<div
						class="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10"
					>
						<svg
							class="h-7 w-7 text-destructive"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							stroke-width="1.5"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
							/>
						</svg>
					</div>
					<div>
						<h2 class="text-lg font-semibold text-foreground">
							Something went wrong
						</h2>
						<p class="mt-1 text-sm text-muted-foreground">
							{apiError.message}
						</p>
					</div>
					<a
						href="/listings"
						class="rounded-full border border-border px-5 py-2 text-sm font-medium text-foreground transition hover:border-primary/40 hover:text-primary"
					>
						Try again
					</a>
				</div>
			{:else if result}
				{#if !questionsSubmitted && result.preferences.clarification_questions.length > 0}
					<!-- Clarifying questions -->
					<div class="flex min-h-0 flex-1 flex-col">
						<div class="border-b border-border pb-4 text-center">
							<h2
								class="font-serif text-2xl tracking-tight text-foreground md:text-3xl"
							>
								Help us refine your search
							</h2>
							<p
								class="mx-auto mt-2 max-w-md text-sm text-muted-foreground"
							>
								We understood most of your preferences. Answer
								these to get the best results.
							</p>
						</div>

						<div class="min-h-0 flex-1 pt-4">
							<ClarifyingQuestions
								questions={result.preferences
									.clarification_questions}
								onsubmit={handleQuestionsSubmit}
							/>
						</div>
					</div>
				{:else}
					<!-- Listings results -->
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="flex min-h-0 flex-1 flex-col gap-4"
						onclick={(e) => {
							if (!(e.target as HTMLElement).closest("article")) {
								selectedListingId = null;
							}
						}}
					>
						<div class="shrink-0">
							<div class="mr-4 flex items-center justify-between">
								<div>
									<h2
										class="font-serif text-xl tracking-tight text-foreground"
									>
										Top matches
									</h2>
									{#if isSearchingMatches}
										<p class="mt-1 text-xs text-muted-foreground">
											Finding the best listings for you...
										</p>
									{:else if searchResult}
										<p class="mt-1 text-xs text-muted-foreground">
											{searchResult.ranked.length} listings ranked
										</p>
									{:else}
										<p class="mt-1 text-xs text-muted-foreground">
											{Math.min(10, listings.length)} of {listings.length}
											listings
										</p>
									{/if}
								</div>
								{#if favoriteListingIdSet.size > 0}
									<button
										class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition {showOnlyFavorites
											? 'bg-rose-500/10 text-rose-500'
											: 'bg-muted text-muted-foreground hover:text-foreground'}"
										onclick={() => (showOnlyFavorites = !showOnlyFavorites)}
									>
										<svg
											class="h-3.5 w-3.5 {showOnlyFavorites ? 'fill-rose-500' : ''}"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												d="m12 21-1.45-1.32C5.4 15.02 2 11.93 2 8.15 2 5.06 4.42 2.75 7.3 2.75c1.63 0 3.2.76 4.2 1.94 1-1.18 2.57-1.94 4.2-1.94C18.58 2.75 21 5.06 21 8.15c0 3.78-3.4 6.87-8.55 11.54z"
											/>
										</svg>
										{showOnlyFavorites ? 'Show all' : `Favorites (${favoriteListingIdSet.size})`}
									</button>
								{/if}
							</div>
						</div>
						<div
							class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1"
							bind:this={listingsScrollContainer}
						>
							{#if isSearchingMatches && !searchResult}
								{#each { length: 5 } as _, i (i)}
									<div
										class="flex shrink-0 flex-row rounded-2xl border border-border bg-card shadow-sm overflow-hidden mr-4"
									>
										<Skeleton
											class="w-28 shrink-0 self-stretch rounded-none"
										/>
										<div
											class="flex min-w-0 flex-1 flex-col gap-2.5 p-4"
										>
											<div
												class="flex items-baseline justify-between"
											>
												<Skeleton class="h-5 w-20" />
												<Skeleton
													class="h-4 w-16 rounded-full"
												/>
											</div>
											<Skeleton class="h-3.5 w-28" />
											<Skeleton class="h-3 w-40" />
											<div class="flex gap-1.5 pt-0.5">
												<Skeleton
													class="h-4 w-20 rounded-md"
												/>
												<Skeleton
													class="h-4 w-24 rounded-md"
												/>
											</div>
										</div>
									</div>
								{/each}
							{/if}
							{#each displayedListingCards as listing (listing.id)}
								<div id="listing-{listing.id}">
									<ListingCard
										{listing}
										isFavorited={favoriteListingIdSet.has(
											listing.id,
										)}
										selected={selectedListingId ===
											listing.id}
										onclick={() =>
											handleListingClick(listing)}
										ontogglefavorite={() =>
											toggleListingFavorite(listing.id)}
									/>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			{/if}
		</div>
	</div>
</div>

<style>
	@keyframes blink {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0;
		}
	}
</style>
