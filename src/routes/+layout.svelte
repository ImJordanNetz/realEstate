<script lang="ts">
	import "./layout.css";
	import favicon from "$lib/assets/favicon.svg";
	import Navbar from "$lib/components/navbar.svelte";

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<div
	class="fixed top-4 left-0 right-0 z-50 flex items-center justify-between px-6"
>
	<Navbar />
</div>
{@render children()}
