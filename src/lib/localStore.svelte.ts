import { browser } from '$app/environment';
import { toStore, type Subscriber, type Unsubscriber, type Updater, type Writable } from 'svelte/store';

export class LocalStore<T> implements Writable<T> {
	value = $state<T>() as T;
	key = '';
	#store: Writable<T>;

	constructor(key: string, value: T) {
		this.key = key;
		this.value = value;

		if (browser) {
			const item = localStorage.getItem(key);
			if (item) this.value = this.deserialize(item);
		}

		this.#store = toStore(
			() => this.value,
			(next) => {
				this.value = next;

				if (browser) {
					localStorage.setItem(this.key, this.serialize(next));
				}
			}
		);
	}

	subscribe(run: Subscriber<T>): Unsubscriber {
		return this.#store.subscribe(run);
	}

	set(value: T): void {
		this.#store.set(value);
	}

	update(updater: Updater<T>): void {
		this.set(updater(this.value));
	}

	serialize(value: T): string {
		return JSON.stringify(value);
	}

	deserialize(value: string): T {
		return JSON.parse(value) as T;
	}
}
