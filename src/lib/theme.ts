import { browser } from '$app/environment';
import { LocalStore } from '$lib/localStore.svelte';

type Theme = 'light' | 'dark';

function getInitialTheme(): Theme {
	if (typeof document === 'undefined') return 'light';
	if (document.documentElement.classList.contains('dark')) return 'dark';
	if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
		return 'dark';
	return 'light';
}

function applyTheme(value: Theme) {
	if (!browser) return;

	document.documentElement.classList.toggle('dark', value === 'dark');
	document.documentElement.classList.toggle('light', value === 'light');
}

export const theme = new LocalStore<Theme>('theme', getInitialTheme());

if (browser) {
	theme.subscribe(applyTheme);
}

export function toggleTheme() {
	theme.update((current) => (current === 'light' ? 'dark' : 'light'));
}
