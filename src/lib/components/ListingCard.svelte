<script lang="ts">
	import type { MapListing } from "../../routes/listings/+page.server";

	interface Props {
		listing: MapListing;
	}

	let { listing }: Props = $props();

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
</script>

<article
	class="group flex shrink-0 flex-row rounded-2xl border border-gray-100 bg-white shadow-sm transition hover:shadow-md overflow-hidden mr-4"
>
	<!-- Photo placeholder -->
	<div
		class="relative w-28 shrink-0 self-stretch bg-gradient-to-br from-gray-100 to-gray-200"
	>
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
	</div>

	<!-- Info -->
	<div class="flex min-w-0 flex-1 flex-col gap-2 p-4">
		<!-- Price row -->
		<div class="flex items-baseline justify-between">
			<p class="text-xl font-semibold tracking-tight text-gray-900">
				{formatPrice(listing.price)}<span
					class="text-sm font-normal text-gray-400">/mo</span
				>
			</p>
			{#if listing.sqft}
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

		<!-- Details -->
		<div
			class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600"
		>
			<span>{formatBedBath(listing.bedrooms, listing.bathrooms)}</span>
			{#if listing.sqft}
				<span class="text-gray-300">|</span>
				<span>{listing.sqft.toLocaleString()} sqft</span>
			{/if}
		</div>

		<!-- Address -->
		<p class="truncate text-xs leading-relaxed text-gray-400">
			{listing.address}
		</p>
	</div>
</article>
