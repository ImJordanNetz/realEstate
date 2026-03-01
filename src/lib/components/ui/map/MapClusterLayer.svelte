<script lang="ts" generics="P extends GeoJSON.GeoJsonProperties">
	import { getContext } from "svelte";
	import MapLibreGL from "maplibre-gl";
	import { theme } from "$lib/theme";

	interface Props {
		/** GeoJSON FeatureCollection data or URL to fetch GeoJSON from */
		data: string | GeoJSON.FeatureCollection<GeoJSON.Point, P>;
		/** Maximum zoom level to cluster points on (default: 14) */
		clusterMaxZoom?: number;
		/** Radius of each cluster when clustering points in pixels (default: 50) */
		clusterRadius?: number;
		/** Colors for cluster circles: [small, medium, large] based on point count (default: ["#22c55e", "#eab308", "#ef4444"]) */
		clusterColors?: [string, string, string];
		/** Point count thresholds for color/size steps: [medium, large] (default: [100, 750]) */
		clusterThresholds?: [number, number];
		/** Color for unclustered individual points (default: "#3b82f6") */
		pointColor?: string;
		/** Currently selected unclustered point id */
		selectedPointId?: string | null;
		/** Callback when an unclustered point is clicked */
		onpointclick?: (
			feature: GeoJSON.Feature<GeoJSON.Point, P>,
			coordinates: [number, number]
		) => void;
		/** Callback when a cluster is clicked. If not provided, zooms into the cluster */
		onclusterclick?: (clusterId: number, coordinates: [number, number], pointCount: number) => void;
	}

	let {
		data,
		clusterMaxZoom = 14,
		clusterRadius = 50,
		clusterColors = ["#22c55e", "#eab308", "#ef4444"],
		clusterThresholds = [100, 750],
		pointColor = "#3b82f6",
		selectedPointId = null,
		onpointclick,
		onclusterclick,
	}: Props = $props();

	let currentTheme: 'light' | 'dark' = $state('light');
	const isDark = $derived(currentTheme === 'dark');

	const mapCtx = getContext<{
		getMap: () => MapLibreGL.Map | null;
		isStyleReady: () => boolean;
	}>("map");

	const id = crypto.randomUUID();
	const sourceId = $derived(`cluster-source-${id}`);
	const clusterLayerId = $derived(`clusters-${id}`);
	const clusterCountLayerId = $derived(`cluster-count-${id}`);
	const unclusteredLayerId = $derived(`unclustered-point-${id}`);
	const selectedPointLayerId = $derived(`selected-point-${id}`);
	const selectedSourceId = $derived(`selected-source-${id}`);
	const pinImageId = $derived(`pin-icon-${id}`);

	const styleProps = $derived({
		clusterColors,
		clusterThresholds,
		pointColor,
		selectedPointId,
	});

	// Subscribe to theme
	$effect(() => {
		const unsub = theme.subscribe((v) => (currentTheme = v));
		return unsub;
	});

	// Update stroke colors when theme changes
	$effect(() => {
		const map = mapCtx.getMap();
		const loaded = mapCtx.isStyleReady();
		if (!loaded || !map) return;

		const strokeColor = isDark ? "#1a1a2e" : "#ffffff";

		if (map.getLayer(clusterLayerId)) {
			map.setPaintProperty(clusterLayerId, "circle-stroke-color", strokeColor);
		}
		if (map.getLayer(unclusteredLayerId)) {
			map.setPaintProperty(unclusteredLayerId, "circle-stroke-color", strokeColor);
		}
	});

	// Add source and layers when map is ready
	$effect(() => {
		const map = mapCtx.getMap();
		const loaded = mapCtx.isStyleReady();

		if (!loaded || !map) return;

		// Remove existing layers and source if they exist
		try {
			if (map.getLayer(clusterCountLayerId)) map.removeLayer(clusterCountLayerId);
			if (map.getLayer(selectedPointLayerId)) map.removeLayer(selectedPointLayerId);
			if (map.getLayer(unclusteredLayerId)) map.removeLayer(unclusteredLayerId);
			if (map.getLayer(clusterLayerId)) map.removeLayer(clusterLayerId);
			if (map.getSource(sourceId)) map.removeSource(sourceId);
			if (map.getSource(selectedSourceId)) map.removeSource(selectedSourceId);
			if (map.hasImage(pinImageId)) map.removeImage(pinImageId);
		} catch {
			// ignore
		}

		// Create pin icon if it doesn't exist
		if (!map.hasImage(pinImageId)) {
			const size = 48;
			const canvas = document.createElement("canvas");
			canvas.width = size;
			canvas.height = size;
			const ctx = canvas.getContext("2d")!;

			// Pin body
			ctx.beginPath();
			ctx.arc(size / 2, 18, 14, Math.PI, 0);
			ctx.quadraticCurveTo(size / 2 + 14, 26, size / 2, size - 4);
			ctx.quadraticCurveTo(size / 2 - 14, 26, size / 2 - 14, 18);
			ctx.fillStyle = pointColor;
			ctx.fill();
			ctx.strokeStyle = isDark ? "#1a1a2e" : "#ffffff";
			ctx.lineWidth = 2.5;
			ctx.stroke();

			// Inner dot
			ctx.beginPath();
			ctx.arc(size / 2, 18, 5, 0, Math.PI * 2);
			ctx.fillStyle = isDark ? "#1a1a2e" : "#ffffff";
			ctx.fill();

			const imageData = ctx.getImageData(0, 0, size, size);
			map.addImage(pinImageId, {
				width: size,
				height: size,
				data: new Uint8Array(imageData.data.buffer),
			});
		}

		// Add clustered GeoJSON source
		// Use clusterProperties to track whether the selected point is inside a cluster
		const clusterProps: Record<string, MapLibreGL.ExpressionSpecification> = {};
		if (selectedPointId) {
			clusterProps["has_selected"] = [
				"any",
				["==", ["get", "id"], selectedPointId],
			] as unknown as MapLibreGL.ExpressionSpecification;
		}
		map.addSource(sourceId, {
			type: "geojson",
			data,
			cluster: true,
			clusterMaxZoom,
			clusterRadius,
			clusterProperties: clusterProps,
		});

		// Add cluster circles layer
		map.addLayer({
			id: clusterLayerId,
			type: "circle",
			source: sourceId,
			filter: ["has", "point_count"],
			paint: {
				"circle-color": [
					"step",
					["get", "point_count"],
					clusterColors[0],
					clusterThresholds[0],
					clusterColors[1],
					clusterThresholds[1],
					clusterColors[2],
				],
				"circle-radius": [
					"step",
					["get", "point_count"],
					20,
					clusterThresholds[0],
					30,
					clusterThresholds[1],
					40,
				],
				"circle-stroke-width": 1,
				"circle-stroke-color": "#fff",
				"circle-opacity": selectedPointId ? 0 : 0.85,
				"circle-stroke-opacity": selectedPointId ? 0 : 1,
			},
		});

		// Add cluster count text layer
		map.addLayer({
			id: clusterCountLayerId,
			type: "symbol",
			source: sourceId,
			filter: ["has", "point_count"],
			layout: {
				"text-field": "{point_count_abbreviated}",
				"text-font": ["Open Sans Regular", "Noto Sans Regular"],
				"text-size": 12,
			},
			paint: {
				"text-color": "#fff",
				"text-opacity": selectedPointId ? 0 : 1,
			},
		});

		// Add unclustered point layer
		map.addLayer({
			id: unclusteredLayerId,
			type: "circle",
			source: sourceId,
			filter: ["!", ["has", "point_count"]],
			paint: {
				"circle-color": pointColor,
				"circle-radius": 5,
				"circle-opacity": selectedPointId ? 0 : 1,
				"circle-stroke-width": 2,
				"circle-stroke-color": "#fff",
				"circle-stroke-opacity": selectedPointId ? 0 : 1,
			},
		});

		// Separate non-clustered source for the selected pin so it shows at every zoom
		const selectedFeature = selectedPointId
			? (typeof data !== "string" ? data.features.find((f) => f.properties?.id === selectedPointId) : null)
			: null;
		map.addSource(selectedSourceId, {
			type: "geojson",
			data: selectedFeature
				? { type: "FeatureCollection", features: [selectedFeature] }
				: { type: "FeatureCollection", features: [] },
		});

		map.addLayer({
			id: selectedPointLayerId,
			type: "symbol",
			source: selectedSourceId,
			layout: {
				"icon-image": pinImageId,
				"icon-size": 1,
				"icon-anchor": "bottom",
				"icon-allow-overlap": true,
				"icon-ignore-placement": true,
			},
		});

		return () => {
			try {
				if (map.getLayer(clusterCountLayerId)) map.removeLayer(clusterCountLayerId);
				if (map.getLayer(selectedPointLayerId)) map.removeLayer(selectedPointLayerId);
				if (map.getLayer(unclusteredLayerId)) map.removeLayer(unclusteredLayerId);
				if (map.getLayer(clusterLayerId)) map.removeLayer(clusterLayerId);
				if (map.getSource(sourceId)) map.removeSource(sourceId);
				if (map.getSource(selectedSourceId)) map.removeSource(selectedSourceId);
				if (map.hasImage(pinImageId)) map.removeImage(pinImageId);
			} catch {
				// ignore
			}
		};
	});

	// Update source data when data prop changes (only for non-URL data)
	$effect(() => {
		const map = mapCtx.getMap();
		const loaded = mapCtx.isStyleReady();

		if (!loaded || !map || typeof data === "string") return;

		const source = map.getSource(sourceId) as MapLibreGL.GeoJSONSource | undefined;
		if (source) {
			source.setData(data);
		}
	});

	// Update layer styles when props change
	$effect(() => {
		const map = mapCtx.getMap();
		const loaded = mapCtx.isStyleReady();

		if (!loaded || !map) return;

		const prev = styleProps;
		const colorsChanged =
			prev.clusterColors !== clusterColors || prev.clusterThresholds !== clusterThresholds;
		const selectedChanged = prev.selectedPointId !== selectedPointId;

		// Update cluster layer colors and sizes
		if (map.getLayer(clusterLayerId) && colorsChanged) {
			map.setPaintProperty(clusterLayerId, "circle-color", [
				"step",
				["get", "point_count"],
				clusterColors[0],
				clusterThresholds[0],
				clusterColors[1],
				clusterThresholds[1],
				clusterColors[2],
			]);
			map.setPaintProperty(clusterLayerId, "circle-radius", [
				"step",
				["get", "point_count"],
				20,
				clusterThresholds[0],
				30,
				clusterThresholds[1],
				40,
			]);
		}
		if (map.getLayer(clusterLayerId) && selectedChanged) {
			map.setPaintProperty(
				clusterLayerId,
				"circle-opacity",
				selectedPointId ? 0 : 0.85,
			);
			map.setPaintProperty(
				clusterLayerId,
				"circle-stroke-opacity",
				selectedPointId ? 0 : 1,
			);
		}
		if (map.getLayer(clusterCountLayerId) && selectedChanged) {
			map.setPaintProperty(
				clusterCountLayerId,
				"text-opacity",
				selectedPointId ? 0 : 1,
			);
		}

		// Update unclustered point layer
		if (map.getLayer(unclusteredLayerId) && prev.pointColor !== pointColor) {
			map.setPaintProperty(unclusteredLayerId, "circle-color", pointColor);
		}
		if (map.getLayer(unclusteredLayerId) && selectedChanged) {
			map.setPaintProperty(unclusteredLayerId, "circle-opacity", selectedPointId ? 0 : 1);
			map.setPaintProperty(unclusteredLayerId, "circle-stroke-opacity", selectedPointId ? 0 : 1);
		}
		// Update selected pin source data
		if (selectedChanged) {
			const source = map.getSource(selectedSourceId) as MapLibreGL.GeoJSONSource | undefined;
			if (source && typeof data !== "string") {
				const feature = selectedPointId
					? data.features.find((f) => f.properties?.id === selectedPointId)
					: null;
				source.setData(
					feature
						? { type: "FeatureCollection", features: [feature] }
						: { type: "FeatureCollection", features: [] },
				);
			}
		}
	});

	// Handle click events
	$effect(() => {
		const map = mapCtx.getMap();
		const loaded = mapCtx.isStyleReady();

		if (!loaded || !map) return;

		// Cluster click handler - zoom into cluster
		const handleClusterClick = async (
			e: MapLibreGL.MapMouseEvent & {
				features?: MapLibreGL.MapGeoJSONFeature[];
			}
		) => {
			const features = map.queryRenderedFeatures(e.point, {
				layers: [clusterLayerId],
			});
			if (!features.length) return;

			const feature = features[0];
			const clusterId = feature.properties?.cluster_id as number;
			const pointCount = feature.properties?.point_count as number;
			const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number];

			if (onclusterclick) {
				onclusterclick(clusterId, coordinates, pointCount);
			} else {
				// Default behavior: zoom to cluster expansion zoom
				const source = map.getSource(sourceId) as MapLibreGL.GeoJSONSource;
				const zoom = await source.getClusterExpansionZoom(clusterId);
				map.easeTo({
					center: coordinates,
					zoom,
				});
			}
		};

		// Unclustered point click handler
		const handlePointClick = (
			e: MapLibreGL.MapMouseEvent & {
				features?: MapLibreGL.MapGeoJSONFeature[];
			}
		) => {
			if (!onpointclick || !e.features?.length) return;

			const feature = e.features[0];
			const coordinates = (feature.geometry as GeoJSON.Point).coordinates.slice() as [
				number,
				number,
			];

			// Handle world copies
			while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
				coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
			}

			onpointclick(feature as unknown as GeoJSON.Feature<GeoJSON.Point, P>, coordinates);
		};

		// Cursor style handlers
		const handleMouseEnterCluster = () => {
			map.getCanvas().style.cursor = "pointer";
		};
		const handleMouseLeaveCluster = () => {
			map.getCanvas().style.cursor = "";
		};
		const handleMouseEnterPoint = () => {
			if (onpointclick) {
				map.getCanvas().style.cursor = "pointer";
			}
		};
		const handleMouseLeavePoint = () => {
			map.getCanvas().style.cursor = "";
		};

		map.on("click", clusterLayerId, handleClusterClick);
		map.on("click", unclusteredLayerId, handlePointClick);
		map.on("mouseenter", clusterLayerId, handleMouseEnterCluster);
		map.on("mouseleave", clusterLayerId, handleMouseLeaveCluster);
		map.on("mouseenter", unclusteredLayerId, handleMouseEnterPoint);
		map.on("mouseleave", unclusteredLayerId, handleMouseLeavePoint);

		return () => {
			map.off("click", clusterLayerId, handleClusterClick);
			map.off("click", unclusteredLayerId, handlePointClick);
			map.off("mouseenter", clusterLayerId, handleMouseEnterCluster);
			map.off("mouseleave", clusterLayerId, handleMouseLeaveCluster);
			map.off("mouseenter", unclusteredLayerId, handleMouseEnterPoint);
			map.off("mouseleave", unclusteredLayerId, handleMouseLeavePoint);
		};
	});
</script>
