<script lang="ts">
	import { theme, toggleTheme } from '$lib/theme';
</script>

<nav class="flex items-center justify-between gap-8 rounded-full border border-border/50 bg-background/70 px-6 py-2.5 shadow-lg backdrop-blur-xl">
	<a href="/" class="text-2xl font-bold text-primary tracking-tight">
		Real eLife
	</a>
	<button
		onclick={toggleTheme}
		class="cursor-pointer rounded-full border border-transparent p-2 text-muted-foreground transition-all duration-200 hover:scale-105 hover:border-primary/25 hover:bg-primary hover:text-primary-foreground hover:shadow-md hover:shadow-primary/30"
		aria-label="Toggle dark mode"
	>
		{#if $theme === 'light'}
			<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
		{:else}
			<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
		{/if}
	</button>
</nav>
