// map.js

// Functions
function addTerrain() {
    if (!map || map.getSource('mapbox-dem')) return; // Already exists or map not ready

    map.addSource('mapbox-dem', {
        'type': 'raster-dem',
        'url': 'mapbox://mapbox.terrain-rgb',
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

        const slider = document.getElementById('scale-slider');

        function animateTerrain(currentTime) {
            if (!startTime) startTime = currentTime;
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const ease = progress < 0.5 ? 4 * Math.pow(progress, 3) : 1 - Math.pow(-2 * progress + 2, 3) / 2; // Smoothstep easing

            let currentScale = Math.max(0, ease * targetScale);
            updateScale(currentScale);

            if (slider) slider.value = currentScale;

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


    const nativeRadiusMeters = 4 / 2;
    const expandedRadiusMeters = (3 / 2) * metersPerPixel;

    const baseOffset = Math.max(nativeRadiusMeters, expandedRadiusMeters);

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
    if (!map || !map.getSource('mapbox-dem')) return;

    const currentExaggeration = map.getTerrain() ? map.getTerrain().exaggeration : 0;
    if (currentExaggeration == null || currentExaggeration <= 0) return;

    let pointsCorrected = 0;
    const visibleTraces = getVisibleTraces();

    visibleTraces.forEach(trace => {
        trace.liftedSegments = [];
        let currentSegment = null;

        trace.processedData.forEach((pt, i) => {
            const exaggeratedGroundAlt = map.queryTerrainElevation([pt._lon, pt._lat]);
            if (exaggeratedGroundAlt == null) return;

            pt._groundAlt = exaggeratedGroundAlt / currentExaggeration;
            if (pt._alt <= pt._groundAlt) {
                pt._renderAlt = pt._groundAlt;
                pt._isLifted = true;
                pointsCorrected++;
            } else {
                pt._renderAlt = pt._alt;
                pt._isLifted = false;
            }

            if (pt._isLifted) {
                if (!currentSegment) {
                    currentSegment = [];
                    if (i > 0) currentSegment.push(trace.processedData[i - 1]);
                }
                currentSegment.push(pt);
            } else {
                if (currentSegment) {
                    currentSegment.push(pt);
                    trace.liftedSegments.push(currentSegment);
                    currentSegment = null;
                }
            }
        });

        if (currentSegment) trace.liftedSegments.push(currentSegment);
        trace.liftedSegments = trace.liftedSegments.filter(seg => seg.length >= 2);
    });

    const active = getActiveTrace();
    appState.liftedSegments = active?.liftedSegments || [];

    if (pointsCorrected > 0) {
        appState.terrainVersion += 1;
        updateScreenCoordsCache();
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
    const activeTrace = getActiveTrace();
    if (!activeTrace || !activeTrace.visible || !activeTrace.processedData || !activeTrace.processedData.length) {
        appState.screenCoordsCache = [];
        return;
    }

    const viewport = getCurrentViewport();
    const canvas = map.getCanvas();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const pad = 50;

    appState.screenCoordsCache = activeTrace.processedData.map(pt => {
        const screenPos = viewport.project([pt._lon, pt._lat, (pt._renderAlt || 0) * (appState.effectiveScale || 1)]);

        if (screenPos[0] < -pad || screenPos[0] > w + pad ||
            screenPos[1] < -pad || screenPos[1] > h + pad) {
            return null;
        }
        return screenPos;
    });
}

function flyToCenter(options) {
    const visibleTraces = getVisibleTraces();
    if (visibleTraces.length === 0) return;

    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    visibleTraces.forEach(t => {
        if (t.stats && t.stats.minLat != null && isFinite(t.stats.minLat)) {
            minLat = Math.min(minLat, t.stats.minLat);
            maxLat = Math.max(maxLat, t.stats.maxLat);
            minLon = Math.min(minLon, t.stats.minLon);
            maxLon = Math.max(maxLon, t.stats.maxLon);
        }
    });

    if (!isFinite(minLat) || !isFinite(maxLat)) return;

    const defaultOptions = {
        padding: { top: 50, bottom: 50, left: 100, right: 50 },
        bearing: 20,
        pitch: 45,
        curve: 3
    };

    map.fitBounds(
        [[minLon, minLat], [maxLon, maxLat]],
        options || defaultOptions
    );
}

function getMapboxToken() {
    if (typeof CONFIG_LOCAL !== 'undefined' && CONFIG_LOCAL.MAPBOX_TOKEN && CONFIG_LOCAL.MAPBOX_TOKEN.trim()) {
        return CONFIG_LOCAL.MAPBOX_TOKEN.trim();
    }
    if (typeof CONFIG !== 'undefined' && CONFIG.MAPBOX_TOKEN && CONFIG.MAPBOX_TOKEN.trim()) {
        return CONFIG.MAPBOX_TOKEN.trim();
    }
    return '';
}

function initializeMap() {
    const token = getMapboxToken();

    if (!token) {
        alert("Error: No Mapbox access token found. Please configure a token in config.js or config.local.js.");
        return;
    }

    mapboxgl.accessToken = token;

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
        addTerrain();
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
        applyTerrainCorrection();
        appState.isCameraMoving = false;
        updateScreenCoordsCache();
        renderMapLayers();
    });
    map.on('rotate', () => {
        renderMapLayers();
    });
    map.on('rotateend', () => {
        updateScreenCoordsCache();
        renderMapLayers();
    });
    map.on('zoom', () => {
        applyTerrainCorrection();
        renderMapLayers();
    });
    map.on('zoomend', () => {
        updateScreenCoordsCache();
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
    window.addEventListener('resize', () => {
        if (typeof map !== 'undefined' && map) map.resize();
        if (typeof chart !== 'undefined' && chart) chart.resize();
    });
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
        };

        return this._container;
    }
    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }
}