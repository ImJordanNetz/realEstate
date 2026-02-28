<script lang="ts">
	import { getContext } from "svelte";
	import MapLibreGL from "maplibre-gl";

	interface Props {
		/** GeoJSON FeatureCollection of Points with a numeric "intensity" property */
		data: GeoJSON.FeatureCollection<GeoJSON.Point>;
		/** Property name that holds the intensity value (default: "intensity") */
		intensityProperty?: string;
		/** Maximum intensity value for normalization (default: 100) */
		maxIntensity?: number;
		/** Heatmap radius in pixels (default: 30) */
		radius?: number;
		/** Overall heatmap opacity 0–1 (default: 0.6) */
		opacity?: number;
	}

	let {
		data,
		intensityProperty = "intensity",
		maxIntensity = 100,
		radius = 30,
		opacity = 0.6,
	}: Props = $props();

	const mapCtx = getContext<{
		getMap: () => MapLibreGL.Map | null;
		isStyleReady: () => boolean;
	}>("map");

	const id = crypto.randomUUID();
	const sourceId = `heatmap-source-${id}`;
	const layerId = `heatmap-layer-${id}`;

	// Add source and layer when map style is ready
	$effect(() => {
		const map = mapCtx.getMap();
		const ready = mapCtx.isStyleReady();
		if (!ready || !map) return;

		// Clean up any previous instances
		try {
			if (map.getLayer(layerId)) map.removeLayer(layerId);
			if (map.getSource(sourceId)) map.removeSource(sourceId);
		} catch {
			// ignore
		}

		map.addSource(sourceId, {
			type: "geojson",
			data,
		});

		map.addLayer(
			{
				id: layerId,
				type: "heatmap",
				source: sourceId,
				paint: {
					// Weight each point by its normalized intensity
					"heatmap-weight": [
						"interpolate",
						["linear"],
						["get", intensityProperty],
						0, 0,
						maxIntensity, 1,
					],
					// Increase radius with zoom
					"heatmap-radius": [
						"interpolate",
						["linear"],
						["zoom"],
						10, radius * 0.5,
						13, radius,
						16, radius * 2,
					],
					// Color ramp: transparent → blue → cyan → green → yellow → red
					"heatmap-color": [
						"interpolate",
						["linear"],
						["heatmap-density"],
						0, "rgba(0,0,0,0)",
						0.1, "rgba(0,0,255,0.15)",
						0.3, "rgba(0,255,255,0.3)",
						0.5, "rgba(0,255,0,0.4)",
						0.7, "rgba(255,255,0,0.5)",
						1, "rgba(255,0,0,0.6)",
					],
					"heatmap-opacity": opacity,
				},
			},
			// Insert below labels / symbol layers so markers stay on top
			findFirstSymbolLayer(map),
		);

		return () => {
			try {
				if (map.getLayer(layerId)) map.removeLayer(layerId);
				if (map.getSource(sourceId)) map.removeSource(sourceId);
			} catch {
				// ignore
			}
		};
	});

	// Update source data reactively
	$effect(() => {
		const map = mapCtx.getMap();
		const ready = mapCtx.isStyleReady();
		if (!ready || !map) return;

		const source = map.getSource(sourceId) as MapLibreGL.GeoJSONSource | undefined;
		if (source) {
			source.setData(data);
		}
	});

	function findFirstSymbolLayer(map: MapLibreGL.Map): string | undefined {
		const layers = map.getStyle().layers;
		if (!layers) return undefined;
		for (const layer of layers) {
			if (layer.type === "symbol") return layer.id;
		}
		return undefined;
	}
</script>
