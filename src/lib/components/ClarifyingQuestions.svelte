<script lang="ts">
	import type {
		ClarificationAnswerMap,
		ClarificationQuestion
	} from '$lib/listings/preferences';

	interface Props {
		questions: ClarificationQuestion[];
		onsubmit?: (answers: ClarificationAnswerMap) => void;
	}

	let { questions, onsubmit }: Props = $props();

	let answers = $state<ClarificationAnswerMap>({});
	let currentIndex = $state(0);

	const currentQuestion = $derived(questions[currentIndex]);
	const isFirst = $derived(currentIndex === 0);
	const isLast = $derived(currentIndex === questions.length - 1);
	const isCurrentAnswered = $derived(
		currentQuestion ? currentQuestion.id in answers : false,
	);
	const answeredCount = $derived(Object.keys(answers).length);
	const allAnswered = $derived(answeredCount === questions.length);

	function goNext() {
		if (currentIndex < questions.length - 1) {
			currentIndex++;
		}
	}

	function goBack() {
		if (currentIndex > 0) {
			currentIndex--;
		}
	}

	function selectOption(questionId: string, value: string) {
		answers[questionId] = value;
	}

	function setBooleanAnswer(questionId: string, value: boolean) {
		answers[questionId] = value;
	}

	function setNumberAnswer(questionId: string, value: string) {
		const num = parseFloat(value);
		if (!isNaN(num)) {
			answers[questionId] = num;
		}
	}
</script>

<div class="flex h-full flex-col">
	<!-- Question carousel area -->
	{#if currentQuestion}
		<div class="flex flex-1 flex-col items-center justify-center">
			<!-- Step dots -->
			<div class="mb-4 flex items-center gap-1.5">
				{#each questions as _, i (questions[i].id)}
					<button
						type="button"
						aria-label="Go to question {i + 1}"
						onclick={() => (currentIndex = i)}
					>
						<div
							class="h-1.5 rounded-full transition-all duration-300 {i ===
							currentIndex
								? 'w-6 bg-primary'
								: questions[i].id in answers
									? 'w-1.5 bg-emerald-400'
									: 'w-1.5 bg-gray-300'}"
						></div>
					</button>
				{/each}
				<p class="text-xs text-gray-400">
					{currentIndex + 1} / {questions.length}
				</p>
			</div>

			<!-- Question text -->
			<h3
				class="text-center font-serif text-xl leading-snug tracking-tight text-gray-900 md:text-2xl"
			>
				{currentQuestion.question}
			</h3>
			<p
				class="mx-auto mt-2 max-w-md text-center text-xs leading-relaxed text-gray-400"
			>
				{currentQuestion.why_asked}
			</p>

			<!-- Answer area -->
			<div class="mt-6 w-full max-w-md">
				<!-- Boolean -->
				{#if currentQuestion.response_type === "boolean"}
					<div class="flex gap-3">
						<button
							type="button"
							onclick={() =>
								setBooleanAnswer(currentQuestion.id, true)}
							class="flex-1 rounded-2xl border-2 px-6 py-3.5 text-sm font-semibold transition-all {answers[
								currentQuestion.id
							] === true
								? 'border-primary bg-primary/5 text-primary shadow-md shadow-primary/10'
								: 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'}"
						>
							Yes
						</button>
						<button
							type="button"
							onclick={() =>
								setBooleanAnswer(currentQuestion.id, false)}
							class="flex-1 rounded-2xl border-2 px-6 py-3.5 text-sm font-semibold transition-all {answers[
								currentQuestion.id
							] === false
								? 'border-primary bg-primary/5 text-primary shadow-md shadow-primary/10'
								: 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'}"
						>
							No
						</button>
					</div>

					<!-- Number -->
				{:else if currentQuestion.response_type === "number"}
					<div class="flex items-center gap-3">
						<!-- svelte-ignore a11y_autofocus -->
						<input
							type="number"
							autofocus
							oninput={(e) =>
								setNumberAnswer(
									currentQuestion.id,
									e.currentTarget.value,
								)}
							value={currentQuestion.id in answers
								? answers[currentQuestion.id]
								: ""}
							placeholder="Enter a number"
							class="flex-1 rounded-2xl border-2 border-gray-200 bg-white px-6 py-3.5 text-center text-lg font-semibold text-gray-900 outline-none transition-colors placeholder:text-gray-300 focus:border-primary focus:shadow-md focus:shadow-primary/10"
						/>
						{#if currentQuestion.unit}
							<span class="text-sm font-medium text-gray-400"
								>{currentQuestion.unit}</span
							>
						{/if}
					</div>

					<!-- Single select -->
				{:else if currentQuestion.response_type === "single_select" && currentQuestion.options}
					<div class="flex flex-wrap justify-center gap-2">
						{#each currentQuestion.options as option (option.value)}
							<button
								type="button"
								onclick={() =>
									selectOption(
										currentQuestion.id,
										option.value,
									)}
								class="rounded-2xl border-2 px-5 py-3 text-sm font-semibold transition-all {answers[
									currentQuestion.id
								] === option.value
									? 'border-primary bg-primary/5 text-primary shadow-md shadow-primary/10'
									: 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'}"
							>
								{option.label}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Navigation -->
	<div
		class="flex items-center justify-between border-t border-gray-100 pt-4"
	>
		<button
			type="button"
			onclick={goBack}
			disabled={isFirst}
			class="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors {isFirst
				? 'cursor-not-allowed text-gray-300'
				: 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}"
		>
			<svg
				class="h-4 w-4"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M15.75 19.5L8.25 12l7.5-7.5"
				/>
			</svg>
			Back
		</button>

		{#if allAnswered && onsubmit}
			<button
				type="button"
				onclick={() => onsubmit?.(answers)}
				class="rounded-2xl bg-primary px-8 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition hover:bg-primary/90"
			>
				Continue
			</button>
		{:else}
			<button
				type="button"
				onclick={goNext}
				disabled={isLast}
				class="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors {isLast
					? 'cursor-not-allowed text-gray-300'
					: 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}"
			>
				{#if isCurrentAnswered}
					Next
				{:else}
					Skip
				{/if}
				<svg
					class="h-4 w-4"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M8.25 4.5l7.5 7.5-7.5 7.5"
					/>
				</svg>
			</button>
		{/if}
	</div>
</div>
