<script lang="ts">
	import type { ApartmentPreferenceExtractionResponse } from "$lib/server/apartment-preferences";
	import {
		finalizeExtractionWithClarifications,
		getExtractionErrorMessage,
		requestListingPreferenceExtraction,
		type ClarificationAnswerMap,
		type ExtractionError,
	} from "$lib/listings/preferences";
	import Map from "$lib/components/ui/map/Map.svelte";
	import MapClusterLayer from "$lib/components/ui/map/MapClusterLayer.svelte";
	import ListingCard from "$lib/components/ListingCard.svelte";
	import ClarifyingQuestions from "$lib/components/ClarifyingQuestions.svelte";
	import GridSpinner from "$lib/components/ui/GridSpinner.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let listings = $derived(data.listings);

	// Compute bounding box for all listings
	let listingBounds = $derived.by(() => {
		if (listings.length === 0) return undefined;

		let minLng = Infinity,
			maxLng = -Infinity;
		let minLat = Infinity,
			maxLat = -Infinity;

		for (const l of listings) {
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

	// Convert listings to GeoJSON for cluster layer
	let listingsGeoJSON = $derived.by(
		(): GeoJSON.FeatureCollection<GeoJSON.Point> => ({
			type: "FeatureCollection",
			features: listings.map((l) => ({
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

	function formatPrice(price: number | null) {
		if (price == null) return "—";
		return `$${price.toLocaleString()}`;
	}

	function formatBedBath(bed: number | null, bath: number | null) {
		const parts: string[] = [];
		if (bed != null) parts.push(bed === 0 ? "Studio" : `${bed}bd`);
		if (bath != null) parts.push(`${bath}ba`);
		return parts.join(" / ") || "—";
	}

	let prompt = $derived(data.prompt);
	let query = $state("");
	let result = $state<ApartmentPreferenceExtractionResponse | null>(null);
	let apiError = $state<ExtractionError | null>(null);
	let isLoading = $state(false);
	let activePrompt = $state("");
	let questionsSubmitted = $state(false);

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

		const updatedResult = finalizeExtractionWithClarifications(
			result,
			answers,
		);

		activePrompt = prompt;
		apiError = null;
		questionsSubmitted = true;
		result = updatedResult;
	}

	$effect(() => {
		query = prompt;
		activePrompt = prompt;

		if (!prompt) {
			result = null;
			apiError = null;
			isLoading = false;
			questionsSubmitted = false;
			return;
		}

		const controller = new AbortController();
		isLoading = true;
		result = null;
		apiError = null;
		questionsSubmitted = false;

		void (async () => {
			try {
				const { response, payload } =
					await requestListingPreferenceExtraction({
						prompt,
						signal: controller.signal,
					});

				if (controller.signal.aborted) {
					return;
				}

				if (!response.ok) {
					apiError = {
						message: getExtractionErrorMessage(payload),
						status: response.status,
					};
					return;
				}

				result = payload as ApartmentPreferenceExtractionResponse;
			} catch (error) {
				if (controller.signal.aborted) {
					return;
				}

				apiError = {
					message:
						error instanceof Error
							? error.message
							: "Failed to extract listing preferences.",
					status: 500,
				};
			} finally {
				if (!controller.signal.aborted) {
					isLoading = false;
				}
			}
		})();

		return () => controller.abort();
	});
</script>

<svelte:window bind:innerWidth />

<svelte:head>
	<title>Listings</title>
</svelte:head>

<!-- Full-screen map background -->
<div class="relative h-[calc(100vh-5rem)]">
	<div class="absolute inset-0">
		<Map
			center={[-117.8265, 33.6846]}
			zoom={12}
			bounds={listingBounds}
			boundsPadding={mapPadding}
			styles={{
				light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
				dark: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
			}}
		>
			<MapClusterLayer
				data={listingsGeoJSON}
				clusterRadius={40}
				clusterMaxZoom={16}
				clusterThresholds={[10, 50]}
				clusterColors={["#6d28d9", "#7c3aed", "#8b5cf6"]}
				pointColor={"#6d28d9"}
			/>
		</Map>
	</div>

	<!-- Content card floating over the map -->
	<div
		class="pointer-events-none absolute inset-0 flex justify-start p-6"
		style="align-items: {questionsSubmitted
			? 'stretch'
			: 'flex-start'}; transition: align-items 0s;"
	>
		<div
			class="pointer-events-auto flex flex-col gap-6 overflow-hidden rounded-[2rem] border border-white/60 bg-white/80 p-5 shadow-2xl shadow-black/15 backdrop-blur-xl"
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
							class="font-serif text-3xl tracking-tight text-gray-900"
						>
							Find your perfect place
						</h1>
						<p
							class="mx-auto mt-3 max-w-md text-sm leading-relaxed text-gray-500"
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
								class="w-full rounded-2xl border border-gray-200 bg-white/70 px-5 py-4 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
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
						class="text-sm font-medium text-gray-400 transition hover:text-primary"
					>
						or go back home
					</a>
				</div>
			{:else if isLoading}
				<!-- Loading state: typewriter -->
				<div class="flex flex-col items-center gap-8 py-12 text-center">
					<h2
						class="font-serif text-2xl tracking-tight text-gray-900"
					>
						Searching for your dream place
					</h2>
					<div
						class="w-full max-w-sm rounded-2xl border border-gray-200/80 bg-gray-50/60 px-6 py-5"
					>
						<p
							class="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400"
						>
							Your prompt
						</p>
						<p class="mt-3 text-sm leading-relaxed text-gray-700">
							{activePrompt}
						</p>
					</div>
					<div class="flex h-7 items-center justify-center gap-3">
						<GridSpinner size="20px" class="text-primary" />
						<span
							class="font-serif text-lg tracking-tight text-gray-900"
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
						class="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50"
					>
						<svg
							class="h-7 w-7 text-red-400"
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
						<h2 class="text-lg font-semibold text-gray-900">
							Something went wrong
						</h2>
						<p class="mt-1 text-sm text-gray-500">
							{apiError.message}
						</p>
					</div>
					<a
						href="/listings"
						class="rounded-full border border-gray-200 px-5 py-2 text-sm font-medium text-gray-700 transition hover:border-primary/40 hover:text-primary"
					>
						Try again
					</a>
				</div>
			{:else if result}
				{#if !questionsSubmitted && result.preferences.clarification_questions.length > 0}
					<!-- Clarifying questions -->
					<div class="flex min-h-0 flex-1 flex-col">
						<div class="border-b border-gray-100 pb-4 text-center">
							<h2
								class="font-serif text-2xl tracking-tight text-gray-900 md:text-3xl"
							>
								Help us refine your search
							</h2>
							<p
								class="mx-auto mt-2 max-w-md text-sm text-gray-500"
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
					<div class="flex min-h-0 flex-1 flex-col gap-4">
						<div class="shrink-0">
							<h2
								class="font-serif text-xl tracking-tight text-gray-900"
							>
								Top matches
							</h2>
							<p class="mt-1 text-xs text-gray-400">
								{Math.min(10, listings.length)} of {listings.length}
								listings
							</p>
						</div>
						<div
							class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1"
						>
							{#each listings.slice(0, 10) as listing (listing.id)}
								<ListingCard {listing} />
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
