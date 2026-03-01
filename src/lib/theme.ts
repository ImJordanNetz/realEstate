import { writable } from 'svelte/store';

function getInitialTheme(): 'light' | 'dark' {
	if (typeof document === 'undefined') return 'light';
	if (document.documentElement.classList.contains('dark')) return 'dark';
	if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
		return 'dark';
	return 'light';
}

export const theme = writable<'light' | 'dark'>(getInitialTheme());

export function toggleTheme() {
	theme.update((current) => {
		const next = current === 'light' ? 'dark' : 'light';
		document.documentElement.classList.toggle('dark', next === 'dark');
		document.documentElement.classList.toggle('light', next === 'light');
		return next;
	});
}
