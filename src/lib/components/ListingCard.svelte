<script lang="ts">
	import { browser } from "$app/environment";

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
		highlights?: string[];
	};

	interface Props {
		listing: ListingCardListing;
	}

	type ListingPhoto = {
		photoUrl: string | null;
		authorName: string | null;
		authorUri: string | null;
		googleMapsUri: string | null;
	};

	let { listing }: Props = $props();
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

<article
	class="group flex shrink-0 flex-row rounded-2xl border border-gray-100 bg-white shadow-sm transition hover:shadow-md overflow-hidden mr-4"
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

	<div class="flex min-w-0 flex-1 flex-col gap-2 p-4">
		<div class="flex items-baseline justify-between">
			<p class="text-xl font-semibold tracking-tight text-gray-900">
				{formatPrice(listing.price)}<span
					class="text-sm font-normal text-gray-400">/mo</span
				>
			</p>
			{#if listing.matchScore != null}
				<p class="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
					{formatMatchScore(listing.matchScore)}
				</p>
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
			class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600"
		>
			<span>{formatBedBath(listing.bedrooms, listing.bathrooms)}</span>
			{#if listing.sqft}
				<span class="text-gray-300">|</span>
				<span>{listing.sqft.toLocaleString()} sqft</span>
			{/if}
		</div>

		<div class="flex items-center justify-between gap-3">
			<p class="truncate text-xs leading-relaxed text-gray-400">
				{listing.address}
			</p>
			<a
				class="shrink-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700 transition hover:text-sky-900"
				href={streetViewUrl}
				target="_blank"
				rel="noreferrer"
			>
				Street View
			</a>
		</div>

		{#if listing.requiredSummary}
			<p class="text-xs font-medium text-amber-700">
				{listing.requiredSummary}
			</p>
		{/if}

		{#if listing.highlights?.length}
			<div class="flex flex-wrap gap-2 pt-1">
				{#each listing.highlights as highlight (highlight)}
					<span class="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600">
						{highlight}
					</span>
				{/each}
			</div>
		{/if}
	</div>
</article>
