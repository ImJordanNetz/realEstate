import assert from 'node:assert/strict';
import test from 'node:test';
import {
	extractRapidApiForSaleRows,
	normalizeRapidApiForSalePayload,
	normalizeRapidApiForSaleRow
} from '../src/lib/server/home-inventory';

test('normalizeRapidApiForSaleRow maps the expected home search fields', () => {
	const listing = normalizeRapidApiForSaleRow({
		property_id: 'prop-123',
		listing_id: 'listing-456',
		href: 'https://example.com/homes/prop-123',
		list_price: '1250000',
		is_pending: false,
		is_new_listing: true,
		is_price_reduced: true,
		is_new_construction: false,
		is_garage_present: true,
		address: {
			line: '123 Main St',
			city: 'Irvine',
			state_code: 'CA',
			postal_code: 92602,
			coordinate: {
				lat: 33.7123,
				lon: -117.8011
			}
		},
		primary_photo: {
			href: 'https://cdn.example.com/photo-1.jpg'
		},
		description: {
			beds: '4',
			baths_consolidated: '6.5+',
			sqft: '3200',
			lot_sqft: '5400',
			stories: '2',
			sold_date: '2024-01-02',
			sold_price: '1180000'
		}
	});

	assert.deepEqual(listing, {
		property_id: 'prop-123',
		listing_id: 'listing-456',
		address: '123 Main St, Irvine, CA, 92602',
		city: 'Irvine',
		state_code: 'CA',
		postal_code: '92602',
		lat: 33.7123,
		lng: -117.8011,
		list_price: 1_250_000,
		beds: 4,
		baths: 6.5,
		sqft: 3200,
		lot_sqft: 5400,
		stories: 2,
		sold_date: '2024-01-02',
		sold_price: 1_180_000,
		is_pending: false,
		is_new_listing: true,
		is_price_reduced: true,
		is_new_construction: false,
		has_garage: true,
		photo_url: 'https://cdn.example.com/photo-1.jpg',
		href: 'https://example.com/homes/prop-123'
	});
});

test('extractRapidApiForSaleRows supports nested SearchHomeResult-style payloads', () => {
	const rows = extractRapidApiForSaleRows({
		data: {
			home_search: {
				results: [
					{
						property_id: 'nested-1'
					}
				]
			}
		}
	});

	assert.equal(rows.length, 1);
	assert.equal(rows[0]?.property_id, 'nested-1');
});

test('normalizeRapidApiForSalePayload dedupes by property_id and keeps the richer row', () => {
	const listings = normalizeRapidApiForSalePayload({
		results: [
			{
				property_id: 'shared-id',
				listing_id: 'listing-a',
				address: {
					line: '1 Oak Ave',
					city: 'Tustin',
					state_code: 'CA'
				},
				description: {
					beds: null,
					baths_consolidated: null
				}
			},
			{
				property_id: 'shared-id',
				listing_id: 'listing-b',
				href: 'https://example.com/shared-id',
				list_price: 900000,
				is_garage_present: true,
				address: {
					line: '1 Oak Ave',
					city: 'Tustin',
					state_code: 'CA',
					postal_code: '92780',
					coordinate: {
						lat: 33.742,
						lon: -117.823
					}
				},
				primary_photo: {
					href: 'https://cdn.example.com/home.jpg'
				},
				description: {
					beds: 3,
					baths_consolidated: '2.5',
					sqft: '1800'
				}
			}
		]
	});

	assert.equal(listings.length, 1);
	assert.equal(listings[0]?.property_id, 'shared-id');
	assert.equal(listings[0]?.listing_id, 'listing-b');
	assert.equal(listings[0]?.postal_code, '92780');
	assert.equal(listings[0]?.list_price, 900000);
	assert.equal(listings[0]?.beds, 3);
	assert.equal(listings[0]?.baths, 2.5);
	assert.equal(listings[0]?.sqft, 1800);
	assert.equal(listings[0]?.photo_url, 'https://cdn.example.com/home.jpg');
	assert.equal(listings[0]?.has_garage, true);
});
