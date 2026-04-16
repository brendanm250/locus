// map.js

// Functions
function addTerrain() {
    if (map.getSource('mapbox-dem')) return; // Already exists

    map.addSource('mapbox-dem', {
        'type': 'raster-dem',
        'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
        'tileSize': 512,
        'maxzoom': 14
    });

    // Start at 0 elevation
    map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 0 });

    const checkSource = (e) => {
        // We only care about the terrain source, and only when it's loaded
        if (e.sourceId === 'mapbox-dem' && map.isSourceLoaded('mapbox-dem')) {
            map.off('sourcedata', checkSource); // Remove listener immediately
            startSmoothRise();
        }
    };

    map.on('sourcedata', checkSource);

    function startSmoothRise() {
        const duration = 1500; // ms
        let startTime = null;
        const targetScale = appState.effectiveScale;

        const slider = document.querySelector('input[type="range"][oninput*="updateScale"]');

        function animateTerrain(currentTime) {
            if (!startTime) startTime = currentTime;
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Optional: Add an "Ease-Out" effect so it slows down as it finishes
            // const ease = 1/(1 + Math.exp(-15 * (progress - 0.5))); // Sigmoid easing
            const ease = progress < 0.5 ? 4 * Math.pow(progress, 3) : 1 - Math.pow(-2 * progress + 2, 3) / 2; // Smoothstep easing

            let currentScale = Math.max(0, ease * targetScale);
            updateScale(currentScale);

            // 2. Update the UI Elements
            if (slider) slider.value = currentScale;
            // if (scaleLabel) scaleLabel.innerText = Math.round(currentScale) + "x";

            if (progress < 1) {
                requestAnimationFrame(animateTerrain);
            }
        }

        requestAnimationFrame(animateTerrain);
    }
}

function setBasemap(url) {
    map.setStyle(url);
    map.once('style.load', () => addTerrain());
}

function getEffectiveScale() {
    const pitch = map.getPitch();
    const pitchFactor = Math.min(1, pitch / 45);
    return appState.altScale * pitchFactor;
}

function getMetersPerPixel() {
    const center = map.getCenter();
    const zoom = map.getZoom();
    const latRad = center.lat * Math.PI / 180;
    return (156543.03392 * Math.cos(latRad)) / Math.pow(2, zoom);
}

function getBillboardOffset() {
    const metersPerPixel = getMetersPerPixel();

    // 2. Determine the physical radius of the billboard
    // The path is defined as 4 meters wide, or a minimum of 3 pixels wide.
    const nativeRadiusMeters = 4 / 2;
    const expandedRadiusMeters = (3 / 2) * metersPerPixel;

    // 3. The offset is exactly the radius of the cylinder currently being drawn
    const baseOffset = Math.max(nativeRadiusMeters, expandedRadiusMeters);

    // 4. Terrain LOD Buffer
    // When Mapbox simplifies distant terrain, flat proxy triangles cut slightly above true ground.
    // Adding 1 pixel's worth of physical buffer easily clears this LOD discrepancy.
    const lodBuffer = 1.0 * metersPerPixel;

    return baseOffset + lodBuffer;
}

function syncTerrainToPitch() {
    // Ensure Mapbox is fully loaded before trying to mutate the terrain
    if (map.getStyle() && map.getSource('mapbox-dem')) {
        const pitch = map.getPitch();
        const pitchFactor = Math.min(1, pitch / 45);

        map.setTerrain({
            'source': 'mapbox-dem',
            'exaggeration': appState.effectiveScale
        });
    }
}

function applyTerrainCorrection() {
    // if (appState.processedData.some(pt => pt._groundAlt !== null)) return; // Already calculated all points
    if (!appState.processedData || !map.getSource('mapbox-dem')) return; // No data to correct or terrain not ready

    const currentExaggeration = map.getTerrain().exaggeration;
    if (currentExaggeration == null || currentExaggeration <= 0) return; // Terrain not yet active or no scale applied

    appState.liftedSegments = [];
    let pointsCorrected = 0;

    // 1. Calculate the lifted points
    appState.processedData.forEach(pt => {
        // if (pt._groundAlt !== null) return; // Already calculated

        const exaggeratedGroundAlt = map.queryTerrainElevation([pt._lon, pt._lat]);
        if (exaggeratedGroundAlt == null) return;

        pt._groundAlt = exaggeratedGroundAlt / currentExaggeration; // Scale out exaggeration to true altitude

        if (pt._alt <= pt._groundAlt) {
            pt._renderAlt = pt._groundAlt; // buffer above ground
            pt._isLifted = true;
            pointsCorrected++;
        } else {
            pt._renderAlt = pt._alt;
            pt._isLifted = false;
        }
    });

    // 2. Build continuous segments for the visual cue
    let currentSegment = null;

    for (let i = 0; i < appState.processedData.length; i++) {
        const pt = appState.processedData[i];

        if (pt._isLifted) {
            if (!currentSegment) {
                currentSegment = [];
                // Anchor the start of the line to the previous unlifted point
                if (i > 0) currentSegment.push(appState.processedData[i-1]);
            }
            currentSegment.push(pt);
        } else {
            if (currentSegment) {
                // Anchor the end of the line to this first unlifted point
                currentSegment.push(pt);
                appState.liftedSegments.push(currentSegment);
                currentSegment = null;
            }
        }
    }
    // Catch a segment if the flight path ends while still lifted
    if (currentSegment) appState.liftedSegments.push(currentSegment);

    appState.liftedSegments = appState.liftedSegments.filter(seg => seg.length >= 2);

    if (pointsCorrected > 0) {
        appState.terrainVersion += 1;
        renderMapLayers();
    }
}

function toggleCorrections(isVisible) {
    appState.showCorrections = isVisible;
    renderMapLayers();
}

function getCurrentViewport() {
    return new deck.WebMercatorViewport({
        width: map.getCanvas().clientWidth,
        height: map.getCanvas().clientHeight,
        longitude: map.getCenter().lng,
        latitude: map.getCenter().lat,
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing()
    });
}

function updateScreenCoordsCache() {
    if (!appState.processedData.length) return;

    const viewport = getCurrentViewport();
    const bounds = map.getBounds();
    const pad = 0.002;

    // FIX 1: Hoist function calls OUTSIDE the loop!
    const w = bounds.getWest() - pad;
    const e = bounds.getEast() + pad;
    const s = bounds.getSouth() - pad;
    const n = bounds.getNorth() + pad;

    // Map the 3D data to 2D screen pixels once
    appState.screenCoordsCache = appState.processedData.map(pt => {
        // Cull points outside the viewport before projecting
        if (pt._lon < w || pt._lon > e || pt._lat < s || pt._lat > n) {
            return null; // Mark as null for easy filtering later
        }
        return viewport.project([pt._lon, pt._lat, pt._renderAlt * appState.effectiveScale]);
    });
}

function flyToCenter(options) {
    if(appState.processedData.length == 0) return;

    map.fitBounds(
        [[appState.dataStats.minLon, appState.dataStats.minLat], // Southwest corner
        [appState.dataStats.maxLon, appState.dataStats.maxLat]], // Northeast corner
        options
    );
}

function initializeMap() {

    if (typeof CONFIG === 'undefined' || !CONFIG.MAPBOX_TOKEN) {
        alert("Error: config.js not found or MAPBOX_TOKEN missing."); // Popup
    }

    mapboxgl.accessToken = CONFIG.MAPBOX_TOKEN;

    map = new mapboxgl.Map({
        container: 'map',
        style: defaultMapStyle,
        center: [-119.5, 37.7],
        zoom: 11,
        pitch: 60,
        bearing: -20,
        projection: 'mercator',
        antialias: true
    });

    // Register listeners only after the map object exists
    setupMapEventListeners();

    // Add custom controls to the map
    map.addControl(new MapInfoControl(), 'top-right');
    map.addControl(new CustomCompassControl(), 'top-right');
    map.addControl(new CustomZoomControl(), 'top-right');
    map.addControl(new CustomCenterControl(), 'top-right');

    // Initialize deck
    deckOverlay = new deck.MapboxOverlay({
        layers: [],
        interleaved: true,
    });
    map.addControl(deckOverlay);
}

function setupMapEventListeners() {
    map.on('load', () => {
        appState.effectiveScale = getEffectiveScale();
        addTerrain()
    });
    map.on('pitch', () => {
        appState.effectiveScale = getEffectiveScale();
        applyTerrainCorrection();
        syncTerrainToPitch();
        renderMapLayers();
    });
    map.on('move', () => {
        appState.isCameraMoving = true;
        updateChartHighlight();
    });
    map.on('moveend', () => {
        applyTerrainCorrection()
        appState.isCameraMoving = false;
        updateScreenCoordsCache();
        renderMapLayers();
    });
    map.on('zoom', () => {
        applyTerrainCorrection()
        renderMapLayers();

    });
    map.on('mousemove', (e) => {
        // Skip calculations if the data isn't ready or we are actively dragging the map
        if (!appState.processedData || appState.isCameraMoving || !appState.screenCoordsCache.length) return;

        const mouseX = e.point.x;
        const mouseY = e.point.y;

        let minDistSq = Infinity;
        let winnerIndex = -1;
        const hoverThreshold = 50; // pixels
        const thresholdSq = hoverThreshold * hoverThreshold;

        for (let i = 0; i < appState.screenCoordsCache.length; i++) {
            const screenPos = appState.screenCoordsCache[i];

            if (!screenPos) continue;

            const dx = screenPos[0] - mouseX;
            const dy = screenPos[1] - mouseY;
            if (Math.abs(dx) > hoverThreshold || Math.abs(dy) > hoverThreshold) continue; // Quick check to skip distant points

            const dSq = (dx * dx) + (dy * dy);

            if (dSq < minDistSq) {
                minDistSq = dSq;
                winnerIndex = i;
            }
        }

        if (winnerIndex !== -1 && minDistSq < thresholdSq && winnerIndex !== appState.hoverIndex) {
            JumpEvent.jumpToTime(winnerIndex, false);
        }
    });
    window.addEventListener('resize', () => { map.resize(); chart.resize(); });
}

/// UI Elements
class CustomZoomControl {
    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group map-ctrl-glass map-ctrl-zoom';
        this._container.style.width = '44px';

        this._container.innerHTML = `
            <div id="zoom-in" class="map-ctrl-btn zoom-btn">+</div>
            <div id="zoom-out" class="map-ctrl-btn zoom-btn">−</div>
        `;

        this._container.querySelector('#zoom-in').onclick = () => this._map.zoomIn();
        this._container.querySelector('#zoom-out').onclick = () => this._map.zoomOut();

        return this._container;
    }
    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }
}

class CustomCompassControl {
    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group map-ctrl-glass map-ctrl-compass map-ctrl-btn';

        this._container.innerHTML = `
            <svg id="ring-2d" style="grid-area: 1 / 1;" viewBox="0 0 40 40" width="70" height="70">
                <circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" opacity="0.4" stroke-width="1.2"></circle>
                <polygon points="20 0 24 7 16 7" fill="#ff4444"></polygon>
            </svg>
            <svg id="dart-3d" style="grid-area: 1 / 1;" viewBox="0 0 40 40" width="45" height="45">
                <polygon points="20 4 30 32 20 26 10 32" fill="none" stroke="var(--accent-blue)" stroke-width="2.5" stroke-linejoin="round"></polygon>
            </svg>
        `;

        this._container.onclick = () => this._map.resetNorthPitch({ duration: 1000 });

        this._syncCamera = () => {
            const bearing = this._map.getBearing();
            const pitch = this._map.getPitch();
            const ring = this._container.querySelector('#ring-2d');
            const dart = this._container.querySelector('#dart-3d');
            if (ring) ring.style.transform = `rotateZ(${-bearing}deg)`;
            if (dart) dart.style.transform = `rotateX(${pitch}deg) rotateZ(${-bearing}deg)`;
        };

        this._map.on('rotate', this._syncCamera);
        this._map.on('pitch', this._syncCamera);
        this._syncCamera();

        return this._container;
    }
    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map.off('rotate', this._syncCamera);
        this._map.off('pitch', this._syncCamera);
        this._map = undefined;
    }
}

class MapInfoControl {
    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group map-ctrl-glass map-ctrl-info';

        // Update function
        this._syncCameraInfo = () => {
            const z = this._map.getZoom().toFixed(2);
            const p = this._map.getPitch().toFixed(1);

            // Normalize bearing to 0-360 for easier reading
            let h = this._map.getBearing();
            if (h < 0) h += 360;
            h = h.toFixed(1);

            this._container.innerHTML = `
                <div style="display: flex; justify-content: space-between;">
                    <span class="map-ctrl-label">ZOM</span>
                    <span class="map-ctrl-value">${z}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span class="map-ctrl-label">PIT</span>
                    <span class="map-ctrl-value">${p}°</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span class="map-ctrl-label">HDG</span>
                    <span class="map-ctrl-value">${h}°</span>
                </div>
            `;
        };

        // Bind to map movement
        this._map.on('move', this._syncCameraInfo);

        // Initial render
        this._syncCameraInfo();

        return this._container;
    }

    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map.off('move', this._syncCameraInfo);
        this._map = undefined;
    }
}

class CustomCenterControl {
    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group map-ctrl-glass map-ctrl-btn';
        this._container.style.width = '44px';
        this._container.style.height = '44px';

        // In CustomCenterControl innerHTML
        this._container.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="6"></circle>
                <line x1="12" y1="0" x2="12" y2="26"></line>
                <line x1="0" y1="12" x2="26" y2="12"></line>
            </svg>
        `;

        this._container.onclick = () => {
            flyToCenter({
            padding: {top: 50, bottom: 50, left: 100, right: 50},
            bearing: this._map.getBearing(),
            pitch: this._map.getPitch(),
            curve: 1,
            duration: 2000
        });
        }

        return this._container;
    }
    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }
}