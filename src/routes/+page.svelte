<script lang="ts">
	import ArrowRight from "@lucide/svelte/icons/arrow-right";
	import Search from "@lucide/svelte/icons/search";

	let query = $state("");
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

	<!-- Pill-shaped input -->
	<div class="relative mt-10 flex w-full max-w-lg items-center">
		<div class="relative flex w-full items-center rounded-full border border-primary/20 bg-background/50 shadow-lg shadow-primary/10 backdrop-blur-sm transition-all focus-within:border-primary/50 focus-within:shadow-primary/20">
			<Search class="ml-5 size-5 shrink-0 text-muted-foreground" />
			<input
				type="text"
				bind:value={query}
				placeholder="I bike everywhere, love climbing, and need to be near UCI..."
				class="h-14 w-full bg-transparent px-4 text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
			/>
			<button
				class="mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-all hover:scale-105 hover:bg-primary/90 hover:shadow-primary/40"
			>
				<ArrowRight class="size-4" />
			</button>
		</div>
	</div>
</section>
