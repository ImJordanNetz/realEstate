<script lang="ts">
	import ArrowRight from "@lucide/svelte/icons/arrow-right";

	type Props = {
		/** Current query text (two-way bindable) */
		value?: string;
		placeholder?: string;
		disabled?: boolean;
		/** Called when the user submits the query */
		onsubmit?: (query: string) => void;
	};

	let {
		value = $bindable(""),
		placeholder = "Refine your search...",
		disabled = false,
		onsubmit,
	}: Props = $props();

	const canSubmit = $derived(value.trim().length > 0 && !disabled);

	function handleSubmit(e: Event) {
		e.preventDefault();
		if (!canSubmit) return;
		onsubmit?.(value.trim());
		value = "";
	}

</script>

<form onsubmit={handleSubmit} class="w-full">
	<div
		class="relative flex items-center rounded-full border border-primary/20 bg-background/80 shadow-lg shadow-primary/10 backdrop-blur-sm transition-all focus-within:border-primary/50 focus-within:shadow-primary/20"
	>
		<input
			type="text"
			bind:value
			{placeholder}
			{disabled}
			class="block w-full truncate bg-transparent py-3 pl-5 pr-12 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
		/>
		<div class="absolute right-2">
			<button
				type="submit"
				disabled={!canSubmit}
				class="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-all hover:scale-105 hover:bg-primary/90 hover:shadow-primary/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
				aria-label="Submit"
			>
				<ArrowRight class="size-3.5" />
			</button>
		</div>
	</div>
</form>
