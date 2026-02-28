# Rentcast API Usage

## Quick Reference

**Run the fetch script:**
```bash
npx tsx scripts/fetch-rentcast.ts
```

- It will **skip** any query already tracked in `src/lib/server/data/rentcast-meta.json`
- To re-fetch a query, delete its entry from `rentcast-meta.json` first
- To add new queries, edit the `queries` array in `scripts/fetch-rentcast.ts` (~line 73)

## API Budget

- **Plan:** Free tier — 50 calls/month
- **Used so far:** 1 (fetched 500 Irvine apartments on 2026-02-28)
- **Remaining:** 49
- **Dashboard:** https://app.rentcast.io/app/api

## File Locations

| File | Purpose |
|------|---------|
| `scripts/fetch-rentcast.ts` | Fetch script — add queries here |
| `src/lib/server/data/rentcast-meta.json` | Tracks which queries have been made |
| `src/lib/server/data/rentcast-raw/` | Raw API responses (1 JSON per query) |

## Adding More Queries

Edit `scripts/fetch-rentcast.ts` and add to the `queries` array:

```ts
const queries: QueryConfig[] = [
  {
    label: 'irvine-apartments',  // already fetched, will be skipped
    params: { city: 'Irvine', state: 'CA', propertyType: 'Apartment' }
  },
  // Add new ones below:
  {
    label: 'costa-mesa-apartments',
    params: { city: 'Costa Mesa', state: 'CA', propertyType: 'Apartment' }
  },
];
```

Then run `npx tsx scripts/fetch-rentcast.ts` — only new queries will use API calls.

## Available Query Params

| Param | Example | Notes |
|-------|---------|-------|
| `city` | `Irvine` | Case-sensitive |
| `state` | `CA` | 2-letter code |
| `zipCode` | `92614` | 5-digit |
| `propertyType` | `Apartment` | Also: Single Family, Condo, Townhouse, Multi-Family |
| `bedrooms` | `2` | Use `0` for studios, supports ranges |
| `bathrooms` | `1` | Supports fractions and ranges |
| `price` | `1000-3000` | Supports ranges |
| `status` | `Active` | Or `Inactive` |
| `limit` | `500` | Max 500 per call (script defaults to 500) |

Full docs: https://developers.rentcast.io/reference/rental-listings-long-term
