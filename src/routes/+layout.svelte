<script lang="ts">
	import "./layout.css";
	import favicon from "$lib/assets/favicon.svg";
	import Navbar from "$lib/components/navbar.svelte";

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<div class="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-1/2">
	<Navbar />
</div>
{@render children()}
