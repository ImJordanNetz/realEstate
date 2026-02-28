<script lang="ts">
	import type { ApartmentPreferenceExtractionResponse } from '$lib/server/apartment-preferences';

	let { data } = $props();

	type ExtractionError = {
		message: string;
		status: number;
	};

	function getErrorMessage(payload: unknown): string {
		if (
			payload &&
			typeof payload === 'object' &&
			'message' in payload &&
			typeof payload.message === 'string'
		) {
			return payload.message;
		}

		return 'Failed to extract listing preferences.';
	}

	let query = $state(data.prompt);
	let result = $state<ApartmentPreferenceExtractionResponse | null>(null);
	let apiError = $state<ExtractionError | null>(null);
	let isLoading = $state(false);
	let activePrompt = $state(data.prompt);

	const hasPrompt = $derived(data.prompt.length > 0);
	const formattedResponse = $derived(result ? JSON.stringify(result.preferences, null, 2) : '');

	$effect(() => {
		query = data.prompt;
		activePrompt = data.prompt;

		if (!data.prompt) {
			result = null;
			apiError = null;
			isLoading = false;
			return;
		}

		const controller = new AbortController();
		isLoading = true;
		result = null;
		apiError = null;

		void (async () => {
			try {
				const response = await fetch('/api/preferences/extract', {
					method: 'POST',
					headers: {
						'content-type': 'application/json'
					},
					body: JSON.stringify({ prompt: data.prompt }),
					signal: controller.signal
				});

				const payload: unknown = await response.json().catch(() => null);

				if (controller.signal.aborted) {
					return;
				}

				if (!response.ok) {
					apiError = {
						message: getErrorMessage(payload),
						status: response.status
					};
					return;
				}

				result = payload as ApartmentPreferenceExtractionResponse;
			} catch (error) {
				if (controller.signal.aborted) {
					return;
				}

				apiError = {
					message: error instanceof Error ? error.message : 'Failed to extract listing preferences.',
					status: 500
				};
			} finally {
				if (!controller.signal.aborted) {
					isLoading = false;
				}
			}
		})();

		return () => controller.abort();
	});
</script>

<svelte:head>
	<title>Listings</title>
</svelte:head>

<section class="min-h-[calc(100vh-5rem)] bg-[radial-gradient(circle_at_top,_color-mix(in_oklab,var(--color-primary)_12%,transparent),transparent_38%),linear-gradient(180deg,color-mix(in_oklab,var(--color-background)_82%,white)_0%,var(--color-background)_100%)] px-6 py-10">
	<div class="mx-auto flex w-full max-w-6xl flex-col gap-8">
		<div class="flex flex-col gap-4">
			<p class="text-xs font-semibold uppercase tracking-[0.28em] text-primary/70">
				Listings Workspace
			</p>
			<div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
				<div class="max-w-3xl">
					<h1 class="font-serif text-4xl tracking-tight text-foreground md:text-5xl">
						Turn a lifestyle prompt into ranking inputs.
					</h1>
					<p class="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
						The prompt stays in the URL so the page is reloadable and shareable. Extraction
						now starts after the page renders, so you can land here immediately and watch the
						results load in.
					</p>
				</div>
				<a
					href="/"
					class="inline-flex items-center justify-center rounded-full border border-border/80 bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:border-primary/40 hover:text-primary"
				>
					Write a new prompt
				</a>
			</div>
		</div>

		<form
			action="/listings"
			method="GET"
			class="rounded-[2rem] border border-border/70 bg-background/85 p-4 shadow-lg shadow-black/5 backdrop-blur-sm md:p-5"
		>
			<label
				class="block text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground/80"
				for="prompt"
			>
				Prompt
			</label>
			<div class="mt-3 flex flex-col gap-3 md:flex-row">
				<textarea
					id="prompt"
					name="prompt"
					rows="3"
					bind:value={query}
					class="min-h-28 flex-1 rounded-[1.5rem] border border-border/70 bg-muted/30 px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
				></textarea>
				<button
					type="submit"
					class="inline-flex items-center justify-center rounded-[1.4rem] bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 md:self-stretch"
				>
					Run extraction
				</button>
			</div>
		</form>

		{#if !hasPrompt}
			<div class="rounded-[2rem] border border-dashed border-border/80 bg-background/70 p-10 text-center">
				<h2 class="font-serif text-2xl text-foreground">No prompt yet</h2>
				<p class="mt-3 text-sm text-muted-foreground">
					Start on the home page or enter a prompt above. This page expects a
					<code class="rounded bg-muted px-1.5 py-0.5 text-xs">prompt</code> query parameter.
				</p>
			</div>
		{:else if isLoading}
			<div class="rounded-[2rem] border border-border/70 bg-background/85 p-6 shadow-lg shadow-black/5">
				<p class="text-xs font-semibold uppercase tracking-[0.22em] text-primary/70">
					Loading extraction
				</p>
				<h2 class="mt-2 text-xl font-semibold text-foreground">
					Preparing listings for your prompt
				</h2>
				<p class="mt-2 max-w-2xl text-sm text-muted-foreground">
					Your prompt is already here:
				</p>
				<p class="mt-4 rounded-[1.5rem] border border-border/70 bg-muted/30 px-4 py-3 text-sm leading-6 text-foreground">
					{activePrompt}
				</p>
			</div>
		{:else if apiError}
			<div class="rounded-[2rem] border border-destructive/30 bg-destructive/8 p-6">
				<p class="text-xs font-semibold uppercase tracking-[0.22em] text-destructive/80">
					Extraction failed
				</p>
				<h2 class="mt-2 text-xl font-semibold text-foreground">
					{apiError.status}: {apiError.message}
				</h2>
				<p class="mt-2 max-w-2xl text-sm text-muted-foreground">
					Check your API configuration, then resubmit the prompt.
				</p>
			</div>
		{:else if result}
			<div class="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
				<div class="rounded-[2rem] border border-border/70 bg-background/85 p-6 shadow-lg shadow-black/5">
					<div class="flex flex-wrap items-center gap-3">
						<p class="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground/80">
							Extraction status
						</p>
						<span class="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
							{result.preferences.status}
						</span>
						<span class="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
							{result.model}
						</span>
					</div>

					<h2 class="mt-4 font-serif text-3xl text-foreground">Clarifying questions</h2>
					{#if result.preferences.clarification_questions.length > 0}
						<div class="mt-5 space-y-4">
							{#each result.preferences.clarification_questions as question (question.id)}
								<div class="rounded-[1.5rem] border border-border/70 bg-muted/30 p-4">
									<div class="flex flex-wrap items-center gap-2">
										<span class="rounded-full bg-background px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
											{question.response_type}
										</span>
										<span class="rounded-full bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
											{question.field_path}
										</span>
									</div>
									<p class="mt-3 text-base font-medium text-foreground">{question.question}</p>
									<p class="mt-2 text-sm text-muted-foreground">{question.why_asked}</p>

									{#if question.options}
										<div class="mt-3 flex flex-wrap gap-2">
											{#each question.options as option (option.value)}
												<span class="rounded-full border border-border/70 px-3 py-1 text-xs text-foreground">
													{option.label}
												</span>
											{/each}
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{:else}
						<p class="mt-4 text-sm text-muted-foreground">
							No clarification needed. The prompt produced a complete extraction payload.
						</p>
					{/if}
				</div>

				<div class="rounded-[2rem] border border-border/70 bg-[#111113] p-6 text-white shadow-xl shadow-black/15">
					<p class="text-xs font-semibold uppercase tracking-[0.22em] text-white/50">JSON payload</p>
					<pre class="mt-4 overflow-x-auto whitespace-pre-wrap break-words text-xs leading-6 text-white/88">{formattedResponse}</pre>
				</div>
			</div>
		{/if}
	</div>
</section>
