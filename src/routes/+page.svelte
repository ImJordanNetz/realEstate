<script lang="ts">
	import ArrowRight from "@lucide/svelte/icons/arrow-right";

	let query = $state("");

	const suggestions = [
		"Walking distance to UCI",
		"Near a climbing gym",
		"Bikeable neighborhood",
		"Close to parks & trails",
		"Quiet area, good for studying",
		"Near coffee shops",
		"Pet-friendly with dog parks",
		"Short commute to Irvine Spectrum",
	];

	function addSuggestion(text: string) {
		if (query.length > 0 && !query.endsWith(", ") && !query.endsWith(",")) {
			query += ", ";
		}
		query += text.toLowerCase();
	}
</script>

<section class="relative flex min-h-[80vh] flex-col items-center justify-center overflow-hidden px-6 py-24">
	<!-- Grid background with radial fade -->
	<div class="pointer-events-none absolute inset-0" style="
		background-image:
			linear-gradient(to right, var(--foreground) 1px, transparent 1px),
			linear-gradient(to bottom, var(--foreground) 1px, transparent 1px);
		background-size: 36px 36px;
		opacity: 0.08;
		mask-image: radial-gradient(ellipse 60% 55% at 50% 40%, black 25%, transparent 75%);
		-webkit-mask-image: radial-gradient(ellipse 60% 55% at 50% 40%, black 25%, transparent 75%);
	"></div>

	<!-- Heading -->
	<h1 class="relative max-w-4xl bg-gradient-to-br from-foreground via-foreground/90 to-foreground/70 bg-clip-text text-center text-5xl font-bold tracking-tight text-transparent sm:text-6xl md:text-7xl lg:text-8xl">
		Describe Your <span class="font-serif italic font-light text-foreground">Life.</span>
		<br />
		<span class="relative inline-block">
			<span class="absolute -inset-1 rounded-lg bg-primary/10 blur-xl opacity-50"></span>
			<span class="relative text-primary inline-flex items-center gap-2">Find Your Home.</span>
		</span>
	</h1>

	<!-- Subtitle -->
	<p class="relative mt-6 max-w-xl text-center text-lg text-muted-foreground">
		No more filters. No more guessing. Just tell us how you live, and we'll find the apartment that fits.
	</p>

	<!-- ChatGPT-style composer input -->
	<div class="relative mt-10 w-full max-w-lg">
		<div class="relative rounded-[28px] border border-primary/20 bg-background/80 shadow-lg shadow-primary/10 backdrop-blur-sm transition-all focus-within:border-primary/50 focus-within:shadow-primary/20">
			<textarea
				bind:value={query}
				placeholder="I bike everywhere, love climbing, and need to be near UCI..."
				rows="1"
				class="block w-full resize-none bg-transparent px-5 pt-4 pb-14 text-base text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
				oninput={(e) => {
					const target = e.currentTarget;
					target.style.height = 'auto';
					target.style.height = target.scrollHeight + 'px';
				}}
			></textarea>
			<div class="absolute bottom-3 right-3">
				<button
					class="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-all hover:scale-105 hover:bg-primary/90 hover:shadow-primary/40"
				>
					<ArrowRight class="size-4" />
				</button>
			</div>
		</div>
	</div>

	<!-- Suggestion pills -->
	<div class="relative mt-5 flex max-w-lg flex-col items-center gap-3">
		<p class="text-sm text-muted-foreground/70 italic">Try a few — or just say it in your own words</p>
		<div class="flex flex-wrap justify-center gap-2">
			{#each suggestions as suggestion}
				<button
					onclick={() => addSuggestion(suggestion)}
					class="rounded-full border border-border/60 bg-background/60 px-3.5 py-1.5 text-sm text-muted-foreground backdrop-blur-sm transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
				>
					{suggestion}
				</button>
			{/each}
		</div>
	</div>
</section>
