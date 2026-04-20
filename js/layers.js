// layers.js


// --- Global Properties ---
const defaultWidth = 4;
const defaultMinPixelWidth = 3;
const BEAD_CONFIG = {
    targetPixels: 4.5,
    minSizeMeters: defaultWidth * 3,
    maxSizePixels: 6,
    calculateBeadScale: function() {
        const metersPerPixel = getMetersPerPixel();
        return Math.min(Math.max(this.minSizeMeters, this.targetPixels * metersPerPixel), this.maxSizePixels*metersPerPixel);
    },
    beadGeometry: typeof luma !== 'undefined' ? new luma.SphereGeometry({radius: 1, nlat: 10, nlong: 10}) : null
};

// --- LAYER FACTORIES ---
const LayerFactories = {

    flightPath: (segments, scale, offset) => new deck.PathLayer({
        id: 'flight-path',
        data: segments,
        getPath: d => d.path.map(p => [p._lon, p._lat, (p._renderAlt*scale + offset)]),
        getColor: d => d.colors, // Reads directly from the segment payload
        getWidth: defaultWidth,
        widthMinPixels: defaultMinPixelWidth,
        pickable: false,
        billboard: true,
        jointRounded: true,
        capRounded: true,
        parameters: { depthTest: true },
        updateTriggers: {
            getPath: [scale, offset]
        }
    }),

    groundTrack: (segments, scale, offset) => new deck.PathLayer({
        id: 'ground-track',
        data: segments,
        getPath: d => d.path.map(p => [p._lon, p._lat, ((p._groundAlt+0.1)*scale + offset)]),
        getColor: d => d.colors, // Reads directly from the segment payload
        getWidth: defaultWidth-1,
        widthMinPixels: defaultMinPixelWidth-2,
        pickable: false,
        billboard: false,
        jointRounded: true,
        capRounded: true,
        parameters: { depthTest: false },
        updateTriggers: {
            getPath: [scale, offset]
        }
    }),

    cursorDropline: (pt, scale, offset) => new deck.LineLayer({
        id: 'cursor-dropline',
        data: [pt],
        getSourcePosition: d => [d._lon, d._lat, d._renderAlt * scale + offset],
        getTargetPosition: d => [d._lon, d._lat, d._groundAlt * scale + offset],
        getColor: [0, 255, 255, 150],
        getWidth: 1.5,
        parameters: { depthTest: false },

        updateTriggers: { getSourcePosition: [scale, offset] }
    }),

    cursorBead3D: (pt, scale, offset) => new deck.SimpleMeshLayer({
        id: 'cursor-bead-3d',
        data: [pt],
        mesh: BEAD_CONFIG.beadGeometry,
        getPosition: d => [d._lon, d._lat, d._renderAlt * scale + offset],
        getColor: [0, 255, 255],
        getScale: (d) => {
            const meshScale = BEAD_CONFIG.calculateBeadScale();
            return [meshScale, meshScale, meshScale];
        },
        parameters: { depthTest: true },
        updateTriggers: {
            getPosition: [scale, offset]
        }
    }),

    cursorTarget: (pt, scale, offset) => new deck.ScatterplotLayer({
        id: 'cursor-target',
        data: [pt],
        getPosition: d => [d._lon, d._lat, d._groundAlt * scale + offset],
        getFillColor: [0, 255, 255, 200],
        getRadius: BEAD_CONFIG.minSizeMeters,
        radiusMinPixels: BEAD_CONFIG.targetPixels,
        stroked: true,
        getLineColor: [255, 255, 255],
        getLineWidth: 1,
        pickable: false,
        parameters: { depthTest: true },
        updateTriggers: {
            getPosition: [scale, offset]
        },
        polygonOffset: {
            enabled: true,
            factor: -1, // Push forward
            units: -4
        }

    }),

};


// --- LAYER MANIFEST ---
// Rules are evaluated top-to-bottom. The first rule to return true wins.
const LayerManifest = [
    {
        id: 'groundTrack',
        updateTrigger: () => [
            appState.effectiveScale,
            appState.showGroundTrack ? appState.terrainVersion : 'groundTrackDisabled'
        ],
        getData: (data) => generateRenderSegments(data, [
            {
                id: 'ground-track',
                condition: (pt, index) => {
                    if (!appState.showGroundTrack || !Number.isFinite(pt._renderAlt) || !Number.isFinite(pt._groundAlt)) return false;
                    if (appState.effectiveScale < 0.1) return false;
                    return (pt._renderAlt - pt._groundAlt > 10);
                },
                getColor: (pt, index) => [180, 180, 180, 240]
            }
        ]),
        createLayers: (segments, scale, offset) => [LayerFactories.groundTrack(segments, scale, offset)]
    },
    {
        id: 'mainTrace',
        updateTrigger: () => [
            appState.chartViewRange,
            appState.pathColors,
            appState.showCorrections ? appState.terrainVersion : 'altCorrectionsDisabled'
        ],
        getData: (data) => generateRenderSegments(data, [
            {
                id: 'base-path', //
                condition: (pt ,index) => true,
                getColor: (pt, index) => modifyRGBa(appState.pathColors[index], 0, -0.55, 0, -0.75),
                // getColor: (pt, index) => [ appState.pathColors[index][0], appState.pathColors[index][1], appState.pathColors[index][2], 80]
            },
            {
                id: 'chart-highlight',
                condition: (pt, index) => appState.chartViewRange && index >= appState.chartViewRange[0] && index <= appState.chartViewRange[1],
                getColor: (pt, index) => [appState.pathColors[index][0], appState.pathColors[index][1], appState.pathColors[index][2]]
            },
            {
                id: 'altitude-correction-highlight',
                condition: (pt, index) => pt._isLifted && appState.showCorrections,
                getColor: (pt, index) => [255, 130, 0, 255]
            },

        ]),
        createLayers: (segments, scale, offset) => [LayerFactories.flightPath(segments, scale, offset)]
    },
    {
        id: 'tooltips',
        updateTrigger: () => appState.hoverIndex,
        // Direct index lookup. No searching required.
        getData: (data) => {
            if (appState.hoverIndex >= 0 && appState.hoverIndex < data.length) {
                return [data[appState.hoverIndex]];
            }
            return [];
        },
        createLayers: (points, scale, offset) => {
            if (!points || points.length === 0) return [];
            const pt = points[0];
            return [
                LayerFactories.cursorTarget(pt, scale, offset),
                LayerFactories.cursorBead3D(pt, scale, offset),
                LayerFactories.cursorDropline(pt, scale, offset)
            ];
        }
    }
];


// --- LAYER RENDERING LOGIC ---
function generateRenderSegments(data, rules) {
    if (!data || data.length <= 1 || !rules || rules.length === 0) return [];

    const pointColors = new Array(data.length).fill(null);
    const pointTags = new Array(data.length).fill(null);

    // 1. Evaluate rules Point-First, but Reverse-Rule-Order
    for (let i = 0; i < data.length; i++) {
        // We start from the end of the rules array (the Top layer)
        // and work backward to the beginning (the Bottom layer).
        for (let j = rules.length - 1; j >= 0; j--) {
            const rule = rules[j];
            if (rule.condition(data[i], i)) {
                pointTags[i] = rule.id;
                pointColors[i] = rule.getColor(data[i], i);
                break; // First match (from the top down) wins
            }
        }
    }
    const firstTagIndex = pointTags.findIndex(Boolean);
    const lastTagIndex = pointTags.findLastIndex(Boolean);
    if (firstTagIndex === -1 || firstTagIndex === lastTagIndex) return []; // Zero or one points

    const segments = [];
    let currentSegmentTag = pointTags[firstTagIndex];
    let currentSegmentPath = [data[firstTagIndex]];
    let currentSegmentColors = [pointColors[firstTagIndex]];

    for (let i = firstTagIndex+1; i <= lastTagIndex; i++) {
        const newTag = pointTags[i];
        const newPt = data[i];
        const newColor = pointColors[i];

        if (newTag) {
            currentSegmentPath.push(newPt);
            currentSegmentColors.push(newColor);
        }

        // If the tag changes, finalize the previous segment
        if (newTag !== currentSegmentTag || i == lastTagIndex) {
            if (currentSegmentTag !== null && currentSegmentPath.length > 1) {
                // Add the current point to the OLD segment for the 1-point overlap
                segments.push({
                    tag: currentSegmentTag,
                    path: currentSegmentPath,
                    colors: currentSegmentColors,
                });
            }
            // Start the new segment with the current point and NEW color
            currentSegmentTag = newTag;
            currentSegmentPath = [newPt];
            currentSegmentColors = [newColor];
        }
    }

    return segments;
}



function renderMapLayers(forceRebuild = false) {
    if (!appState.mapPathData || !appState.mapPathData.length) return;

    const effectiveScale = appState.effectiveScale;
    const zoomOffset = getBillboardOffset();
    const layers = [];

    LayerManifest.forEach(manifestEntry => {
        if (!manifestEntry.cache) {
            manifestEntry.cache = {
                triggerState: null,
                data: []
            };
        }
        const cache = manifestEntry.cache;

        const currentTriggerState = JSON.stringify(manifestEntry.updateTrigger());
        if (cache.triggerState !== currentTriggerState || forceRebuild) {
            cache.triggerState = currentTriggerState;
            cache.data = manifestEntry.getData(appState.mapPathData);
        }

        if (cache.data && cache.data.length > 0) {
            const newLayers = manifestEntry.createLayers(cache.data, effectiveScale, zoomOffset);
            layers.push(...newLayers);
        }
    });

    deckOverlay.setProps({ layers: layers });
}

