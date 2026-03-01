<script lang="ts">
	import { getContext, onDestroy } from "svelte";
	import MapLibreGL from "maplibre-gl";
	import { theme } from "$lib/theme";

	export type RouteLine = {
		id: string;
		coordinates: [number, number][]; // [lng, lat][]
	};

	export type RouteMarker = {
		id: string;
		name: string;
		lng: number;
		lat: number;
		minutes: number | null;
		placeId?: string | null;
		address?: string | null;
	};

	interface Props {
		routes?: RouteLine[];
		destinations?: RouteMarker[];
	}

	let { routes = [], destinations = [] }: Props = $props();

	let currentTheme = $state(theme.value);
	const isDark = $derived(currentTheme === "dark");

	const mapCtx = getContext<{
		getMap: () => MapLibreGL.Map | null;
		isStyleReady: () => boolean;
	}>("map");

	const id = crypto.randomUUID();
	const routeSourceId = `route-lines-${id}`;
	const routeLayerId = `route-lines-layer-${id}`;
	const destSourceId = `route-dests-${id}`;
	const destCircleLayerId = `route-dest-circles-${id}`;
	const destLabelLayerId = `route-dest-labels-${id}`;

	function buildLineGeoJSON(
		lines: RouteLine[],
	): GeoJSON.FeatureCollection<GeoJSON.LineString> {
		return {
			type: "FeatureCollection",
			features: lines.map((line) => ({
				type: "Feature" as const,
				geometry: {
					type: "LineString" as const,
					coordinates: line.coordinates,
				},
				properties: { id: line.id },
			})),
		};
	}

	let activePopup: MapLibreGL.Popup | null = null;

	function closePopup() {
		if (activePopup) {
			activePopup.remove();
			activePopup = null;
		}
	}

	function buildDestGeoJSON(
		markers: RouteMarker[],
	): GeoJSON.FeatureCollection<GeoJSON.Point> {
		return {
			type: "FeatureCollection",
			features: markers.map((m) => ({
				type: "Feature" as const,
				geometry: {
					type: "Point" as const,
					coordinates: [m.lng, m.lat],
				},
				properties: {
					id: m.id,
					name: m.name,
					address: m.address ?? "",
					minutes: m.minutes != null ? Math.round(m.minutes) : -1,
					label:
						m.minutes != null
							? `${m.name} (${Math.round(m.minutes)} min)`
							: m.name,
					mapsUrl: m.placeId
						? `https://www.google.com/maps/place/?q=place_id:${m.placeId}`
						: `https://www.google.com/maps/search/?api=1&query=${m.lat},${m.lng}`,
				},
			})),
		};
	}

	function buildPopupHTML(props: Record<string, unknown>): string {
		const name = props.name as string;
		const address = props.address as string;
		const minutes = props.minutes as number;
		const mapsUrl = props.mapsUrl as string;
		const nameColor = isDark ? "#e5e7eb" : "#1f2937";
		const addrColor = isDark ? "#9ca3af" : "#6b7280";

		return `<div style="font-family: system-ui, -apple-system, sans-serif; min-width: 180px; max-width: 240px;">
			<div style="font-size: 13px; font-weight: 600; color: ${nameColor}; line-height: 1.3;">${name}</div>
			${minutes >= 0 ? `<div style="font-size: 11px; color: #7c3aed; font-weight: 500; margin-top: 3px;">${minutes} min away</div>` : ""}
			${address ? `<div style="font-size: 11px; color: ${addrColor}; margin-top: 3px; line-height: 1.3;">${address}</div>` : ""}
			<a href="${mapsUrl}" target="_blank" rel="noopener noreferrer"
				style="display: inline-flex; align-items: center; gap: 4px; margin-top: 8px; font-size: 11px; font-weight: 500; color: #4285f4; text-decoration: none;"
				onmouseover="this.style.textDecoration='underline'"
				onmouseout="this.style.textDecoration='none'">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
				View on Google Maps
			</a>
		</div>`;
	}

	function handleDestClick(map: MapLibreGL.Map, e: MapLibreGL.MapMouseEvent & { features?: MapLibreGL.GeoJSONFeature[] }) {
		const feature = e.features?.[0];
		if (!feature || feature.geometry.type !== "Point") return;

		// Prevent the click from reaching POI layers below
		e.originalEvent.stopPropagation();

		closePopup();

		const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
		const props = feature.properties ?? {};

		activePopup = new MapLibreGL.Popup({
			offset: 16,
			closeButton: true,
			maxWidth: "260px",
			className: "route-dest-popup",
		})
			.setLngLat(coords)
			.setHTML(buildPopupHTML(props))
			.addTo(map);
	}

	// Subscribe to theme
	$effect(() => {
		const unsub = theme.subscribe((v) => (currentTheme = v));
		return unsub;
	});

	// Update label colors when theme changes
	$effect(() => {
		const map = mapCtx.getMap();
		const ready = mapCtx.isStyleReady();
		if (!ready || !map) return;

		const haloColor = isDark ? "#1a1a2e" : "#ffffff";
		const textColor = isDark ? "#c4b5fd" : "#4c1d95";

		if (map.getLayer(destLabelLayerId)) {
			map.setPaintProperty(destLabelLayerId, "text-color", textColor);
			map.setPaintProperty(destLabelLayerId, "text-halo-color", haloColor);
		}
		if (map.getLayer(destCircleLayerId)) {
			map.setPaintProperty(destCircleLayerId, "circle-stroke-color", isDark ? "#1a1a2e" : "#ffffff");
		}
	});

	// Add sources and layers
	$effect(() => {
		const map = mapCtx.getMap();
		const ready = mapCtx.isStyleReady();

		if (!ready || !map) return;

		// Clean up any existing
		try {
			closePopup();
			if (map.getLayer(destLabelLayerId))
				map.removeLayer(destLabelLayerId);
			if (map.getLayer(destCircleLayerId))
				map.removeLayer(destCircleLayerId);
			if (map.getLayer(routeLayerId)) map.removeLayer(routeLayerId);
			if (map.getSource(routeSourceId)) map.removeSource(routeSourceId);
			if (map.getSource(destSourceId)) map.removeSource(destSourceId);
		} catch {
			// ignore
		}

		// Route lines source + layer
		map.addSource(routeSourceId, {
			type: "geojson",
			data: buildLineGeoJSON(routes),
		});

		map.addLayer({
			id: routeLayerId,
			type: "line",
			source: routeSourceId,
			layout: {
				"line-join": "round",
				"line-cap": "round",
			},
			paint: {
				"line-color": "#7c3aed",
				"line-width": 4,
				"line-opacity": 0.7,
				// solid line (no dasharray)
			},
		});

		// Destination markers source + layers
		map.addSource(destSourceId, {
			type: "geojson",
			data: buildDestGeoJSON(destinations),
		});

		map.addLayer({
			id: destCircleLayerId,
			type: "circle",
			source: destSourceId,
			paint: {
				"circle-radius": 7,
				"circle-color": "#7c3aed",
				"circle-stroke-width": 2,
				"circle-stroke-color": isDark ? "#1a1a2e" : "#ffffff",
			},
		});

		map.addLayer({
			id: destLabelLayerId,
			type: "symbol",
			source: destSourceId,
			layout: {
				"text-field": ["get", "label"],
				"text-size": 12,
				"text-offset": [0, -1.5],
				"text-anchor": "bottom",
				"text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
			},
			paint: {
				"text-color": isDark ? "#c4b5fd" : "#4c1d95",
				"text-halo-color": isDark ? "#1a1a2e" : "#ffffff",
				"text-halo-width": 1.5,
			},
		});

		// Click handlers for destination markers
		const onClick = (e: MapLibreGL.MapMouseEvent & { features?: MapLibreGL.GeoJSONFeature[] }) =>
			handleDestClick(map, e);

		map.on("click", destCircleLayerId, onClick);
		map.on("click", destLabelLayerId, onClick);

		const onEnter = () => {
			map.getCanvas().style.cursor = "pointer";
		};
		const onLeave = () => {
			map.getCanvas().style.cursor = "";
		};

		map.on("mouseenter", destCircleLayerId, onEnter);
		map.on("mouseleave", destCircleLayerId, onLeave);
		map.on("mouseenter", destLabelLayerId, onEnter);
		map.on("mouseleave", destLabelLayerId, onLeave);

		return () => {
			closePopup();
			map.off("click", destCircleLayerId, onClick);
			map.off("click", destLabelLayerId, onClick);
			map.off("mouseenter", destCircleLayerId, onEnter);
			map.off("mouseleave", destCircleLayerId, onLeave);
			map.off("mouseenter", destLabelLayerId, onEnter);
			map.off("mouseleave", destLabelLayerId, onLeave);

			try {
				if (map.getLayer(destLabelLayerId))
					map.removeLayer(destLabelLayerId);
				if (map.getLayer(destCircleLayerId))
					map.removeLayer(destCircleLayerId);
				if (map.getLayer(routeLayerId))
					map.removeLayer(routeLayerId);
				if (map.getSource(routeSourceId))
					map.removeSource(routeSourceId);
				if (map.getSource(destSourceId))
					map.removeSource(destSourceId);
			} catch {
				// ignore
			}
		};
	});

	// Update data reactively
	$effect(() => {
		const map = mapCtx.getMap();
		const ready = mapCtx.isStyleReady();

		if (!ready || !map) return;

		closePopup();

		const lineSource = map.getSource(
			routeSourceId,
		) as MapLibreGL.GeoJSONSource | undefined;
		if (lineSource) {
			lineSource.setData(buildLineGeoJSON(routes));
		}

		const destSource = map.getSource(
			destSourceId,
		) as MapLibreGL.GeoJSONSource | undefined;
		if (destSource) {
			destSource.setData(buildDestGeoJSON(destinations));
		}
	});
</script>

<style>
	:global(.route-dest-popup .maplibregl-popup-content) {
		border-radius: 12px;
		padding: 12px 14px;
		box-shadow:
			0 4px 6px -1px rgb(0 0 0 / 0.1),
			0 2px 4px -2px rgb(0 0 0 / 0.1);
		background: var(--card);
		color: var(--foreground);
	}

	:global(.route-dest-popup .maplibregl-popup-close-button) {
		font-size: 16px;
		padding: 2px 6px;
		color: var(--muted-foreground);
	}

	:global(.route-dest-popup .maplibregl-popup-close-button:hover) {
		color: var(--foreground);
		background: transparent;
	}
</style>
