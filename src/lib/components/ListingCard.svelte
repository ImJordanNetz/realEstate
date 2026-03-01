<script lang="ts">
	import { browser } from "$app/environment";

	export type ListingHighlight = {
		text: string;
		status: 'pass' | 'fail' | 'unknown';
	};

	export type ListingCardListing = {
		id: string;
		address: string;
		placeId: string | null;
		lat: number;
		lng: number;
		bedrooms: number | null;
		bathrooms: number | null;
		sqft: number | null;
		price: number | null;
		matchScore?: number;
		requiredSummary?: string | null;
		highlights?: ListingHighlight[];
	};

	interface Props {
		listing: ListingCardListing;
		selected?: boolean;
		onclick?: () => void;
	}

	type ListingPhoto = {
		photoUrl: string | null;
		authorName: string | null;
		authorUri: string | null;
		googleMapsUri: string | null;
	};

	let { listing, selected = false, onclick }: Props = $props();
	let photo = $state<ListingPhoto | null>(null);
	let isPhotoLoading = $state(false);
	let photoLoadFailed = $state(false);
	let expanded = $state(false);

	function toggleExpand(e: MouseEvent) {
		e.stopPropagation();
		expanded = !expanded;
	}

	function formatPrice(price: number | null) {
		if (price == null) return "—";
		return `$${price.toLocaleString()}`;
	}

	function formatBedBath(bed: number | null, bath: number | null) {
		const parts: string[] = [];
		if (bed != null) parts.push(bed === 0 ? "Studio" : `${bed} bed`);
		if (bath != null) parts.push(`${bath} bath`);
		return parts.join(" · ") || "—";
	}

	function formatMatchScore(score: number | undefined) {
		if (score == null) return null;
		return `${Math.round(score * 100)}% match`;
	}

	function buildStreetViewUrl(lat: number, lng: number) {
		const url = new URL("https://www.google.com/maps/@");
		url.searchParams.set("api", "1");
		url.searchParams.set("map_action", "pano");
		url.searchParams.set("viewpoint", `${lat},${lng}`);
		return url.toString();
	}

	async function loadListingPhoto(placeId: string, signal: AbortSignal) {
		const response = await fetch(
			`/api/listings/photo?placeId=${encodeURIComponent(placeId)}`,
			{ signal },
		);

		if (!response.ok) {
			throw new Error("Failed to load listing photo.");
		}

		return (await response.json()) as ListingPhoto;
	}

	const streetViewUrl = $derived(buildStreetViewUrl(listing.lat, listing.lng));

	function buildZillowUrl(address: string) {
		const slug = address.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
		return `https://www.zillow.com/homes/${encodeURIComponent(slug)}_rb/`;
	}

	const zillowUrl = $derived(buildZillowUrl(listing.address));

	$effect(() => {
		photo = null;
		photoLoadFailed = false;

		if (!browser || !listing.placeId) {
			isPhotoLoading = false;
			return;
		}

		const controller = new AbortController();
		isPhotoLoading = true;

		void loadListingPhoto(listing.placeId, controller.signal)
			.then((nextPhoto) => {
				if (controller.signal.aborted) return;
				photo = nextPhoto;
			})
			.catch(() => {
				if (controller.signal.aborted) return;
				photoLoadFailed = true;
			})
			.finally(() => {
				if (!controller.signal.aborted) {
					isPhotoLoading = false;
				}
			});

		return () => controller.abort();
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<article
	class="group relative mr-4 flex shrink-0 overflow-hidden rounded-2xl border bg-white shadow-sm transition-all duration-300 hover:shadow-md {selected ? 'border-primary ring-2 ring-primary/20' : 'border-gray-100'} {expanded ? 'flex-col' : 'flex-row'}"
	style={expanded ? 'height: 70vh;' : ''}
	onclick={onclick}
>
	<div
		class="relative shrink-0 bg-gradient-to-br from-gray-100 to-gray-200 transition-all duration-300 {expanded ? 'w-full' : 'w-28 self-stretch'}"
		style={expanded ? 'height: 45%;' : ''}
	>
		{#if photo?.photoUrl}
			<img
				class="h-full w-full object-cover"
				src={photo.photoUrl}
				alt={`Exterior photo of ${listing.address}`}
				loading="lazy"
			/>
		{:else}
			{#if isPhotoLoading}
				<div class="absolute inset-0 animate-pulse bg-gradient-to-br from-sky-100 via-white to-amber-100"></div>
			{/if}
			<div
				class="absolute inset-0 flex items-center justify-center text-gray-300"
			>
				<svg
					class="h-8 w-8"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="1"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z"
					/>
				</svg>
			</div>
			{#if photoLoadFailed || !listing.placeId}
				<span class="absolute inset-x-0 bottom-3 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
					No photo
				</span>
			{/if}
		{/if}
	</div>

	<div class="flex min-w-0 shrink-0 flex-col p-4 transition-all duration-300 {expanded ? 'gap-3 p-5' : 'flex-1 gap-1.5'}">
		<div class="flex items-baseline justify-between">
			<p class="font-semibold tracking-tight text-gray-900 transition-all duration-300 {expanded ? 'text-2xl' : 'text-lg'}">
				{formatPrice(listing.price)}<span
					class="font-normal text-gray-400 {expanded ? 'text-sm' : 'text-xs'}">/mo</span
				>
			</p>
			{#if listing.matchScore != null}
				<span class="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary {expanded ? 'text-sm' : 'text-[11px]'}">
					{formatMatchScore(listing.matchScore)}
				</span>
			{:else if listing.sqft}
				<p class="text-gray-400 {expanded ? 'text-sm' : 'text-xs'}">
					{formatPrice(
						listing.price && listing.sqft
							? Math.round((listing.price / listing.sqft) * 100) /
									100
							: null,
					)}/sqft
				</p>
			{/if}
		</div>

		<div
			class="flex flex-wrap items-center gap-x-2 text-gray-500 {expanded ? 'text-base' : 'text-[13px]'}"
		>
			<span>{formatBedBath(listing.bedrooms, listing.bathrooms)}</span>
			{#if listing.sqft}
				<span class="text-gray-300">·</span>
				<span>{listing.sqft.toLocaleString()} sqft</span>
			{/if}
		</div>

		<a
			class="group/sv flex items-center gap-1 truncate text-gray-400 transition hover:text-gray-600 {expanded ? 'text-sm' : 'text-xs'}"
			href={streetViewUrl}
			target="_blank"
			rel="noreferrer"
		>
			<svg class="h-3 w-3 shrink-0 text-gray-300 transition group-hover/sv:text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
				<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
			</svg>
			<span class="truncate">{listing.address}</span>
		</a>

		{#if listing.requiredSummary}
			<p class="font-medium text-amber-700 {expanded ? 'text-sm' : 'text-xs'}">
				{listing.requiredSummary}
			</p>
		{/if}

		{#if listing.highlights?.length}
			<div class="flex flex-wrap gap-1.5 pt-0.5">
				{#each listing.highlights as highlight (highlight.text)}
					{#if highlight.status === 'fail'}
						<span class="inline-flex items-center rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 font-medium text-rose-400 {expanded ? 'text-xs' : 'text-[10px]'}">
							{highlight.text}
						</span>
					{:else}
						<span class="inline-flex items-center rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 font-medium text-gray-500 {expanded ? 'text-xs' : 'text-[10px]'}">
							{highlight.text}
						</span>
					{/if}
				{/each}
			</div>
		{/if}

		{#if expanded}
			<a
				class="mt-1 inline-flex w-fit items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-600 transition hover:bg-blue-100"
				href={zillowUrl}
				target="_blank"
				rel="noreferrer"
				onclick={(e) => e.stopPropagation()}
			>
				View on Zillow
				<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
				</svg>
			</a>
		{/if}
	</div>

	<!-- Expand/collapse button -->
	<button
		class="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-gray-400 shadow-md backdrop-blur-sm transition hover:bg-white hover:text-gray-700"
		onclick={toggleExpand}
		aria-label={expanded ? 'Collapse listing' : 'Expand listing'}
	>
		<svg class="h-4 w-4 transition-transform duration-300 {expanded ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
		</svg>
	</button>
</article>
