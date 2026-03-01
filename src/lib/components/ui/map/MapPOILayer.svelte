<script lang="ts">
	import { getContext } from "svelte";
	import MapLibreGL from "maplibre-gl";
	import { theme } from "$lib/theme";

	export type POIPoint = {
		id: string;
		name: string;
		lat: number;
		lng: number;
		category: string;
		address?: string | null;
	};

	interface Props {
		pois?: POIPoint[];
	}

	let { pois = [] }: Props = $props();

	let currentTheme = $state(theme.value);
	const isDark = $derived(currentTheme === "dark");

	const mapCtx = getContext<{
		getMap: () => MapLibreGL.Map | null;
		isStyleReady: () => boolean;
	}>("map");

	const uid = crypto.randomUUID();
	const sourceId = `poi-source-${uid}`;
	const circleLayerId = `poi-circles-${uid}`;
	const labelLayerId = `poi-labels-${uid}`;
	const iconLayerId = `poi-icons-${uid}`;

	let activePopup: MapLibreGL.Popup | null = null;

	const CATEGORY_COLORS: Record<string, string> = {
		grocery: "#22c55e",
		nightlife: "#a855f7",
		park: "#16a34a",
		hospital: "#ef4444",
	};

	const CATEGORY_EMOJI: Record<string, string> = {
		grocery: "🛒",
		nightlife: "🍸",
		park: "🌳",
		hospital: "🏥",
	};

	const CATEGORY_LABELS: Record<string, string> = {
		grocery: "Grocery",
		nightlife: "Nightlife",
		park: "Park",
		hospital: "Hospital",
	};

	function googleMapsUrl(placeId: string): string {
		return `https://www.google.com/maps/place/?q=place_id:${placeId}`;
	}

	function buildGeoJSON(
		points: POIPoint[],
	): GeoJSON.FeatureCollection<GeoJSON.Point> {
		return {
			type: "FeatureCollection",
			features: points.map((p) => ({
				type: "Feature" as const,
				geometry: {
					type: "Point" as const,
					coordinates: [p.lng, p.lat],
				},
				properties: {
					id: p.id,
					name: p.name,
					category: p.category,
					address: p.address ?? "",
					color: CATEGORY_COLORS[p.category] ?? "#94a3b8",
					emoji: CATEGORY_EMOJI[p.category] ?? "📍",
					categoryLabel: CATEGORY_LABELS[p.category] ?? p.category,
					mapsUrl: googleMapsUrl(p.id),
				},
			})),
		};
	}

	function buildPopupHTML(props: Record<string, unknown>): string {
		const name = props.name as string;
		const category = props.categoryLabel as string;
		const address = props.address as string;
		const color = props.color as string;
		const emoji = props.emoji as string;
		const mapsUrl = props.mapsUrl as string;
		const nameColor = isDark ? "#e5e7eb" : "#1f2937";
		const addrColor = isDark ? "#9ca3af" : "#6b7280";

		return `<div style="font-family: system-ui, -apple-system, sans-serif; min-width: 180px; max-width: 240px;">
			<div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
				<span style="font-size: 16px;">${emoji}</span>
				<span style="font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: ${color};">${category}</span>
			</div>
			<div style="font-size: 13px; font-weight: 600; color: ${nameColor}; line-height: 1.3;">${name}</div>
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

	function closePopup() {
		if (activePopup) {
			activePopup.remove();
			activePopup = null;
		}
	}

	function handlePOIClick(map: MapLibreGL.Map, e: MapLibreGL.MapMouseEvent & { features?: MapLibreGL.GeoJSONFeature[] }) {
		const feature = e.features?.[0];
		if (!feature || feature.geometry.type !== "Point") return;

		closePopup();

		const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
		const props = feature.properties ?? {};

		activePopup = new MapLibreGL.Popup({
			offset: 16,
			closeButton: true,
			maxWidth: "260px",
			className: "poi-popup",
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

	// Update colors when theme changes
	$effect(() => {
		const map = mapCtx.getMap();
		const ready = mapCtx.isStyleReady();
		if (!ready || !map) return;

		const haloColor = isDark ? "#1a1a2e" : "#ffffff";
		const strokeColor = isDark ? "#1a1a2e" : "#ffffff";

		if (map.getLayer(labelLayerId)) {
			map.setPaintProperty(labelLayerId, "text-halo-color", haloColor);
		}
		if (map.getLayer(circleLayerId)) {
			map.setPaintProperty(circleLayerId, "circle-stroke-color", strokeColor);
		}
	});

	// Add sources and layers
	$effect(() => {
		const map = mapCtx.getMap();
		const ready = mapCtx.isStyleReady();

		if (!ready || !map) return;

		// Clean up existing
		try {
			closePopup();
			if (map.getLayer(labelLayerId)) map.removeLayer(labelLayerId);
			if (map.getLayer(iconLayerId)) map.removeLayer(iconLayerId);
			if (map.getLayer(circleLayerId)) map.removeLayer(circleLayerId);
			if (map.getSource(sourceId)) map.removeSource(sourceId);
		} catch {
			// ignore
		}

		map.addSource(sourceId, {
			type: "geojson",
			data: buildGeoJSON(pois),
		});

		// Small faded circles
		map.addLayer({
			id: circleLayerId,
			type: "circle",
			source: sourceId,
			paint: {
				"circle-radius": 5,
				"circle-color": ["get", "color"],
				"circle-opacity": 0.45,
				"circle-stroke-width": 1.5,
				"circle-stroke-color": isDark ? "#1a1a2e" : "#ffffff",
				"circle-stroke-opacity": 0.6,
			},
		});

		// Emoji icon as text
		map.addLayer({
			id: iconLayerId,
			type: "symbol",
			source: sourceId,
			layout: {
				"text-field": ["get", "emoji"],
				"text-size": 14,
				"text-offset": [0, -1.4],
				"text-anchor": "bottom",
				"text-allow-overlap": true,
			},
			paint: {
				"text-opacity": 0.7,
			},
		});

		// Small name label
		map.addLayer({
			id: labelLayerId,
			type: "symbol",
			source: sourceId,
			minzoom: 13,
			layout: {
				"text-field": ["get", "name"],
				"text-size": 10,
				"text-offset": [0, 0.8],
				"text-anchor": "top",
				"text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
				"text-max-width": 8,
			},
			paint: {
				"text-color": ["get", "color"],
				"text-opacity": 0.5,
				"text-halo-color": isDark ? "#1a1a2e" : "#ffffff",
				"text-halo-width": 1,
			},
		});

		// Click handlers — listen on both circle and icon layers
		const onClick = (e: MapLibreGL.MapMouseEvent & { features?: MapLibreGL.GeoJSONFeature[] }) =>
			handlePOIClick(map, e);

		map.on("click", circleLayerId, onClick);
		map.on("click", iconLayerId, onClick);

		// Cursor change on hover
		const onEnter = () => {
			map.getCanvas().style.cursor = "pointer";
		};
		const onLeave = () => {
			map.getCanvas().style.cursor = "";
		};

		map.on("mouseenter", circleLayerId, onEnter);
		map.on("mouseleave", circleLayerId, onLeave);
		map.on("mouseenter", iconLayerId, onEnter);
		map.on("mouseleave", iconLayerId, onLeave);

		return () => {
			closePopup();
			map.off("click", circleLayerId, onClick);
			map.off("click", iconLayerId, onClick);
			map.off("mouseenter", circleLayerId, onEnter);
			map.off("mouseleave", circleLayerId, onLeave);
			map.off("mouseenter", iconLayerId, onEnter);
			map.off("mouseleave", iconLayerId, onLeave);

			try {
				if (map.getLayer(labelLayerId)) map.removeLayer(labelLayerId);
				if (map.getLayer(iconLayerId)) map.removeLayer(iconLayerId);
				if (map.getLayer(circleLayerId)) map.removeLayer(circleLayerId);
				if (map.getSource(sourceId)) map.removeSource(sourceId);
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

		// Close any open popup when POI data changes
		closePopup();

		const source = map.getSource(sourceId) as
			| MapLibreGL.GeoJSONSource
			| undefined;
		if (source) {
			source.setData(buildGeoJSON(pois));
		}
	});
</script>

<style>
	:global(.poi-popup .maplibregl-popup-content) {
		border-radius: 12px;
		padding: 12px 14px;
		box-shadow:
			0 4px 6px -1px rgb(0 0 0 / 0.1),
			0 2px 4px -2px rgb(0 0 0 / 0.1);
		background: var(--card);
		color: var(--foreground);
	}

	:global(.poi-popup .maplibregl-popup-close-button) {
		font-size: 16px;
		padding: 2px 6px;
		color: var(--muted-foreground);
	}

	:global(.poi-popup .maplibregl-popup-close-button:hover) {
		color: var(--foreground);
		background: transparent;
	}
</style>
