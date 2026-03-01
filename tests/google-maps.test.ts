import assert from 'node:assert/strict';
import test from 'node:test';
import { createGoogleRoutesProvider } from '../src/lib/server/google-maps';

test('createGoogleRoutesProvider falls back to estimated cells after repeated 429 responses', async () => {
	const originalApiKey = process.env.GOOGLE_API_KEY;
	const originalFetch = global.fetch;

	process.env.GOOGLE_API_KEY = 'test-key';

	let fetchCalls = 0;
	global.fetch = async () => {
		fetchCalls += 1;

		return new Response(JSON.stringify({ error: { message: 'Too Many Requests' } }), {
			status: 429,
			headers: {
				'content-type': 'application/json',
				'retry-after': '0'
			}
		});
	};

	try {
		const provider = createGoogleRoutesProvider();
		const cells = await provider.computeRouteMatrix({
			origins: [
				{
					id: 'origin-1',
					location: { lat: 33.6802, lng: -117.8202 }
				}
			],
			destinations: [
				{
					id: 'destination-1',
					location: { lat: 33.681, lng: -117.8201 }
				}
			],
			travelMode: 'walk'
		});

		assert.equal(fetchCalls, 3);
		assert.equal(cells.length, 1);
		assert.equal(cells[0]?.origin_id, 'origin-1');
		assert.equal(cells[0]?.destination_id, 'destination-1');
		assert.ok((cells[0]?.minutes ?? 0) > 0);
	} finally {
		global.fetch = originalFetch;

		if (originalApiKey === undefined) {
			delete process.env.GOOGLE_API_KEY;
		} else {
			process.env.GOOGLE_API_KEY = originalApiKey;
		}
	}
});
