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
	class="group flex shrink-0 flex-row rounded-2xl border bg-white shadow-sm transition hover:shadow-md overflow-hidden mr-4 {selected ? 'border-primary ring-2 ring-primary/20' : 'border-gray-100'} {onclick ? 'cursor-pointer' : ''}"
	onclick={onclick}
>
	<div
		class="relative w-28 shrink-0 self-stretch bg-gradient-to-br from-gray-100 to-gray-200"
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

	<div class="flex min-w-0 flex-1 flex-col gap-1.5 p-4">
		<div class="flex items-baseline justify-between">
			<p class="text-lg font-semibold tracking-tight text-gray-900">
				{formatPrice(listing.price)}<span
					class="text-xs font-normal text-gray-400">/mo</span
				>
			</p>
			{#if listing.matchScore != null}
				<span class="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
					{formatMatchScore(listing.matchScore)}
				</span>
			{:else if listing.sqft}
				<p class="text-xs text-gray-400">
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
			class="flex flex-wrap items-center gap-x-2 text-[13px] text-gray-500"
		>
			<span>{formatBedBath(listing.bedrooms, listing.bathrooms)}</span>
			{#if listing.sqft}
				<span class="text-gray-300">·</span>
				<span>{listing.sqft.toLocaleString()} sqft</span>
			{/if}
		</div>

		<a
			class="group/sv flex items-center gap-1 truncate text-xs text-gray-400 transition hover:text-gray-600"
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
			<p class="text-xs font-medium text-amber-700">
				{listing.requiredSummary}
			</p>
		{/if}

		{#if listing.highlights?.length}
			<div class="flex flex-wrap gap-1.5 pt-0.5">
				{#each listing.highlights as highlight (highlight.text)}
					{#if highlight.status === 'fail'}
						<span class="inline-flex items-center rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-400">
							{highlight.text}
						</span>
					{:else}
						<span class="inline-flex items-center rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500">
							{highlight.text}
						</span>
					{/if}
				{/each}
			</div>
		{/if}
	</div>
</article>
