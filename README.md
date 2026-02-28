# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
npx sv create --template minimal --types ts --add tailwindcss="plugins:none" --install npm realEstate
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Enriching Google Place IDs

To attach Google `placeId`s to the saved RentCast listings, set `GOOGLE_API_KEY` in `.env` and run:

```sh
npm run places:enrich
```

The script reads [`src/lib/server/data/rentcast-raw/irvine-apartments.json`](/Users/jordannetz/Desktop/hackathons/irvine2026/realEstate/src/lib/server/data/rentcast-raw/irvine-apartments.json) and writes matches to [`src/lib/server/data/google-place-ids.json`](/Users/jordannetz/Desktop/hackathons/irvine2026/realEstate/src/lib/server/data/google-place-ids.json). The normalized inventory loader then exposes each match as `place_id` on the listing objects.

## Precomputing the nightlife grid

To build the static 500m nightlife artifact used by ranking, set `GOOGLE_API_KEY` in `.env` and run:

```sh
npm run nightlife:grid
```

The script reads the active Irvine listing region and writes the generated grid to [`src/lib/server/data/irvine-nightlife-grid-500m.json`](/Users/jordannetz/Desktop/hackathons/irvine2026/realEstate/src/lib/server/data/irvine-nightlife-grid-500m.json). Runtime search loads this file directly instead of querying Google Places on each request.

## Crawling Orange County homes for sale

Before using RapidAPI from this repo, rotate any key that was pasted into chat or another shared surface, then update `.env` with `RAPIDAPI_KEY` and `RAPIDAPI_HOST`.

To crawl seeded Orange County cities, cache the raw responses, and build the deduped local inventory artifact, run:

```sh
npm run homes:fetch
```

Useful overrides:

```sh
npm run homes:fetch -- --cities=Irvine,Tustin --pages=5 --limit=200
npm run homes:fetch -- --force
```

The crawler writes raw responses to `src/lib/server/data/rapidapi-for-sale-raw/*.json`, crawl metadata to `src/lib/server/data/rapidapi-for-sale-meta.json`, and the normalized deduped artifact to `src/lib/server/data/orange-county-homes.json`.

Normalization lives in `src/lib/server/home-inventory.ts`. It defensively parses SearchHomeResult-style rows, deduplicates by `property_id`, preserves richer duplicates, and exposes `loadOrangeCountyHomes()` for the future buyer search path.

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
