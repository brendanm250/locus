// init.js

let REQUIRED_FIELDS = [
        { key: 'time', label: 'Time' },
        { key: 'lat', label: 'Latitude' },
        { key: 'lon', label: 'Longitude' },
        { key: 'alt', label: 'Altitude' }
    ];

window.addEventListener('offline', () => {
    const liveIndicator = document.getElementById('offline-indicator');
    liveIndicator.removeAttribute('hidden');
});

window.addEventListener('online', () => {
    const liveIndicator = document.getElementById('offline-indicator');
    liveIndicator.setAttribute('hidden', '');
});

const TRACE_PALETTE = [
    '#00e5ff', // Cyan
    '#ff5722', // Coral / Red-Orange
    '#b388ff', // Violet / Purple
    '#00e676', // Bright Neon Green
    '#ffd600', // Bright Amber / Gold
    '#ff4081', // Pink / Rose
    '#40c4ff', // Sky Blue
    '#76ff03', // Lime Green
    '#ff9100', // Deep Orange
    '#e040fb'  // Magenta
];

function hexToRgb(hex) {
    const cleanHex = hex.replace('#', '');
    const num = parseInt(cleanHex, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r, g, b) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function getActiveTrace() {
    if (!appState || !appState.traces || appState.traces.length === 0) return null;
    return appState.traces.find(t => t.id === appState.activeTraceId) || appState.traces[0];
}

function getVisibleTraces() {
    if (!appState || !appState.traces) return [];
    return appState.traces.filter(t => t.visible);
}

function getContextTrace() {
    if (!appState || !appState.traces || appState.traces.length === 0) return null;
    if (appState.contextTraceSource && appState.contextTraceSource !== 'active') {
        const found = appState.traces.find(t => t.id === appState.contextTraceSource);
        if (found && found.visible) return found;
    }
    return getActiveTrace();
}

const FALLBACK_SAMPLES = [
    { name: 'Driving', path: 'sample_data/Driving.csv' },
    { name: 'Flying', path: 'sample_data/Flying.csv' },
    { name: 'Skiing', path: 'sample_data/Skiing.csv' }
];

function populateSampleFallback() {
    const select = document.getElementById('sample-data-select');
    if (!select) return;
    select.innerHTML = '';
    FALLBACK_SAMPLES.forEach(file => {
        const option = document.createElement('option');
        option.value = file.path;
        option.textContent = file.name;
        select.appendChild(option);
    });
}

function populateSampleDataDropdown() {
    const owner = 'brendanm250';
    const repo = 'locus';
    const folderPath = 'sample_data';

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${folderPath}`;

    fetch(apiUrl)
        .then(response => {
            if (!response.ok) throw new Error('GitHub API rate limit or repo not found');
            return response.json();
        })
        .then(files => {
            const select = document.getElementById('sample-data-select');
            select.innerHTML = '';

            const csvFiles = files.filter(file => file.name.endsWith('.csv'));

            if (csvFiles.length === 0) {
                populateSampleFallback();
                return;
            }

            csvFiles.forEach(file => {
                const option = document.createElement('option');
                option.value = file.download_url;
                option.textContent = file.name.replace('.csv', '');
                select.appendChild(option);
            });
        })
        .catch(error => {
            console.warn('GitHub API unavailable, using local sample data list:', error);
            populateSampleFallback();
        });
}

function populateShareColumnOptions(headers) {
    const container = document.getElementById('share-column-list');
    if (!container || !headers) return;
    container.innerHTML = '';
    const active = getActiveTrace();
    const mapped = Object.values(active?.mapping || {});
    headers.forEach(h => {
        const div = document.createElement('div');
        div.className = 'checkbox-item';
        const isChecked = mapped.includes(h) || ['Time', 'time', 'Latitude', 'latitude', 'Longitude', 'longitude', 'Altitude', 'alt'].includes(h);
        div.innerHTML = `<label style="display: flex; align-items: center; gap: 6px; cursor: pointer; margin: 0; width: 100%;"><input type="checkbox" class="share-col-cb" value="${h}" ${isChecked ? 'checked' : ''}> <span>${h}</span></label>`;
        container.appendChild(div);
    });
}

function autoDetectMappingForHeaders(headers) {
    const mapping = {};
    REQUIRED_FIELDS.forEach(field => {
        let bestScore = -1;
        let selectedIdx = 0;

        headers.forEach((h, i) => {
            const header = h.toLowerCase();
            const key = field.key.toLowerCase();
            let score = 0;

            if (header.includes(key)) {
                score = 1;
                if (field.key === 'alt') {
                    if (header.includes('gps')) score += 1;
                    if (header.includes('msl') || header.includes('hae')) score += 1;
                    if (header.includes('baro')) score += 0.5;
                }
                if (field.key === 'time') {
                    if (header.includes('time')) score += 1;
                }
            }

            if (score > bestScore) {
                bestScore = score;
                selectedIdx = i;
            }
        });

        mapping[field.key] = headers[selectedIdx];
    });
    return mapping;
}

function autoDetectColumns(trace) {
    const target = trace || getActiveTrace();
    if (!target) return;
    target.mapping = autoDetectMappingForHeaders(target.headers);
}

function processTraceData(trace) {
    let cumDist = 0;
    let distAccumulator = 0;
    let startTime = null;
    let lastLat = null;
    let lastLon = null;

    trace.processedData = trace.rawData.map((row, i) => {
        const rawLat = row[trace.mapping.lat];
        const rawLon = row[trace.mapping.lon];
        let rawAlt = row[trace.mapping.alt] != null ? row[trace.mapping.alt] : 'noAltData';
        let rawTime = row[trace.mapping.time] != null ? row[trace.mapping.time] : 'noTimeData';

        if (rawAlt !== 'noAltData' && typeof rawAlt === 'number') {
            const altUnit = trace.units && trace.units[trace.mapping.alt];
            if (altUnit) rawAlt = convertAltitude(rawAlt, altUnit);
        }
        if (rawTime !== 'noTimeData' && typeof rawTime === 'number') {
            const timeUnit = trace.units && trace.units[trace.mapping.time];
            if (timeUnit) rawTime = convertTime(rawTime, timeUnit);
        }

        if (rawLat == null || rawLon == null || isNaN(rawLat) || isNaN(rawLon)) return null;

        if (lastLat !== null && lastLon !== null) {
            const d = haversineDistance(lastLat, lastLon, rawLat, rawLon);
            distAccumulator += d;
            if (distAccumulator > 0.5) {
                cumDist += distAccumulator;
                distAccumulator = 0;
            }
        }
        lastLat = rawLat;
        lastLon = rawLon;

        let timeSec = 0;
        if (typeof rawTime === 'number') {
            if (startTime === null) startTime = rawTime;
            const isMs = rawTime > 1e11;
            timeSec = isMs ? (rawTime - startTime) / 1000 : (rawTime - startTime);
        } else {
            timeSec = i;
        }

        return {
            ...row,
            _lat: rawLat,
            _lon: rawLon,
            _alt: typeof rawAlt === 'number' ? rawAlt : 0,
            _renderAlt: typeof rawAlt === 'number' ? rawAlt : 0,
            _isLifted: false,
            _distKm: cumDist / 1000,
            _timeSec: timeSec,
            _absTime: typeof rawTime === 'number' ? rawTime : null,
            _rawIndex: i,
            _groundAlt: null,
            _traceId: trace.id
        };
    }).filter(r => r !== null);

    trace.mapPathData = trace.processedData;

    if (trace.processedData.length > 0) {
        const lastPt = trace.processedData[trace.processedData.length - 1];
        const lats = trace.processedData.map(pt => pt._lat);
        const lons = trace.processedData.map(pt => pt._lon);
        trace.stats = {
            totalDuration: lastPt._timeSec,
            totalDistance: lastPt._distKm,
            minLat: Math.min(...lats),
            maxLat: Math.max(...lats),
            minLon: Math.min(...lons),
            maxLon: Math.max(...lons)
        };
        trace.stats.centerCoords = [
            (trace.stats.maxLon + trace.stats.minLon) / 2,
            (trace.stats.maxLat + trace.stats.minLat) / 2
        ];
        trace.cursorPoint = trace.processedData[0];
        trace.cursorIndex = 0;
    } else {
        trace.stats = { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0, centerCoords: [0, 0], totalDuration: 0, totalDistance: 0 };
        trace.cursorPoint = null;
        trace.cursorIndex = 0;
    }
}

function addTraceFromParsedData(name, rawData, headers, units, customMapping = null) {
    const nextIndex = appState.traces.length;
    const hexColor = TRACE_PALETTE[nextIndex % TRACE_PALETTE.length];
    const rgbColor = hexToRgb(hexColor);

    const trace = {
        id: 'trace_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        name: name || `Trace ${nextIndex + 1}`,
        color: rgbColor,
        hexColor: hexColor,
        visible: true,
        rawData: rawData,
        headers: headers,
        units: units || {},
        mapping: customMapping || autoDetectMappingForHeaders(headers),
        processedData: [],
        mapPathData: [],
        liftedSegments: [],
        stats: {},
        cursorPoint: null,
        cursorIndex: 0,
        pathColors: null
    };

    processTraceData(trace);
    appState.traces.push(trace);

    if (!appState.activeTraceId || !appState.traces.some(t => t.id === appState.activeTraceId)) {
        appState.activeTraceId = trace.id;
    }

    return trace;
}

function handleFilesSelected(files) {
    if (!files || files.length === 0) return;
    let pending = files.length;

    Array.from(files).forEach(file => {
        Papa.parse(file, {
            header: true,
            dynamicTyping: true,
            skipEmptyLines: true,
            complete: (results) => {
                const { data: cleanedData, units } = detectAndStripUnits(results);
                const traceName = file.name.replace(/\.[^/.]+$/, "");
                addTraceFromParsedData(traceName, cleanedData, results.meta.fields, units);

                pending--;
                if (pending === 0) {
                    onTracesChanged(true);
                }
            }
        });
    });
}

function loadSelectedSample() {
    const downloadUrl = document.getElementById('sample-data-select').value;
    const select = document.getElementById('sample-data-select');
    const selectedText = select.options[select.selectedIndex]?.textContent || 'Sample';

    if (!downloadUrl) {
        alert("Please select a valid sample file.");
        return;
    }

    const fetchCsv = (url) => fetch(url).then(response => {
        if (!response.ok) throw new Error('Failed to fetch file content');
        return response.text();
    });

    return fetchCsv(downloadUrl)
        .catch(err => {
            if (!downloadUrl.startsWith('http')) {
                const githubFallback = `https://raw.githubusercontent.com/brendanm250/locus/main/${downloadUrl}`;
                return fetchCsv(githubFallback);
            }
            throw err;
        })
        .then(csvText => {
            return new Promise((resolve) => {
                Papa.parse(csvText, {
                    header: true,
                    dynamicTyping: true,
                    skipEmptyLines: true,
                    complete: (results) => {
                        const { data: cleanedData, units } = detectAndStripUnits(results);
                        const trace = addTraceFromParsedData(selectedText, cleanedData, results.meta.fields, units);
                        onTracesChanged(true);
                        resolve(trace);
                    }
                });
            });
        })
        .catch(error => {
            console.error('Error loading sample data:', error);
            alert('Failed to load sample data.');
        });
}

function onTracesChanged(fitBounds = false) {
    const visibleTraces = getVisibleTraces();
    const activeTrace = getActiveTrace();

    // Calculate maximum duration and distance across visible traces
    let maxDur = 0;
    let maxDist = 0;
    visibleTraces.forEach(t => {
        if (t.stats) {
            if (t.stats.totalDuration > maxDur) maxDur = t.stats.totalDuration;
            if (t.stats.totalDistance > maxDist) maxDist = t.stats.totalDistance;
        }
    });
    appState.maxDuration = maxDur;
    appState.maxDistance = maxDist;
    appState.totalDuration = maxDur;

    // Time slider range update
    const slider = document.getElementById('time-slider');
    if (slider) {
        slider.max = maxDur > 0 ? maxDur : 100;
        if (parseFloat(slider.value) > slider.max) {
            slider.value = 0;
            appState.playbackTime = 0;
        }
    }

    // Trace Manager List UI update
    renderTraceList();

    const dataDependentControls = document.getElementById('data-dependent-controls');
    const dataActionBtns = document.getElementById('data-action-btns');
    if (appState.traces.length > 0) {
        if (dataDependentControls) dataDependentControls.style.display = 'block';
        if (dataActionBtns) dataActionBtns.style.display = 'flex';
        if (!appState.hasAutoCollapsedInput) {
            appState.hasAutoCollapsedInput = true;
            const inputSection = document.getElementById('section-input');
            if (inputSection && !inputSection.classList.contains('collapsed')) {
                inputSection.classList.add('collapsed');
            }
        }
    } else {
        if (dataDependentControls) dataDependentControls.style.display = 'none';
        if (dataActionBtns) dataActionBtns.style.display = 'none';
    }

    if (activeTrace) {
        populateShareColumnOptions(activeTrace.headers);
        initColorList();
        if (typeof initChartLists === 'function') initChartLists();
    }

    calculatePathColors();

    if (fitBounds && visibleTraces.length > 0) {
        flyToCenter();
    }

    if (map && map.getSource('mapbox-dem')) {
        map.once('idle', () => applyTerrainCorrection());
    }

    JumpEvent.jumpToSeconds(appState.playbackTime || 0, true);
    renderMapLayers(true);

    if (typeof updateTableTraceSelect === 'function') {
        updateTableTraceSelect();
    }
    if (activeTrace) {
        renderTable(activeTrace.rawData, activeTrace.headers);
    }

    if (appState.traces.length > 0) {
        if (typeof initializeChartUI === 'function') initializeChartUI();
    } else {
        const placeholder = document.getElementById('chart-placeholder');
        const chartDiv = document.getElementById('chart');
        if (placeholder) placeholder.style.display = 'flex';
        if (chartDiv) chartDiv.style.display = 'none';
    }

    if (typeof renderCharts === 'function') {
        renderCharts();
    }

    if (typeof updateScreenCoordsCache === 'function') {
        updateScreenCoordsCache();
    }
}

function launchApp() {
    window.addEventListener('resize', adjustHUDLayout);

    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const sharedDataParam = hashParams.get('share');

    const panelObserver = new ResizeObserver(() => {
        adjustHUDLayout();
    });

    const controlPanel = document.getElementById('control-panel');
    if (controlPanel) panelObserver.observe(controlPanel);

    requestAnimationFrame(adjustHUDLayout);

    appState = {
        traces: [],
        activeTraceId: null,
        mappingTraceId: null,
        colorMode: 'trace',
        playbackTime: 0,
        playbackRate: 1,
        maxDuration: 0,
        maxDistance: 0,
        hasAutoCollapsedInput: false,

        // Single-trace backward-compatibility & globals
        hoverIndex: -1,
        altScale: 1.75,
        isPlaying: false,
        colorBy: 'none',
        currentGradient: 'Turbo',
        activeChartTraces: [],
        activeContextTrace: null,
        contextTraceSource: 'active',
        xAxisMode: 'time',
        chartMouseY: null,
        totalDuration: 0,
        pathColors: null,
        screenCoordsCache: [],
        isCameraMoving: false,
        chartViewRange: null,
        chartZoom: null,
        liftedSegments: [],
        showCorrections: false,
        showGroundTrack: true,
        terrainVersion: 0,
        effectiveScale: null
    };

    // Backward-compatibility getters so existing functions referring to appState.processedData continue working
    Object.defineProperty(appState, 'processedData', {
        get() {
            const active = getActiveTrace();
            return active ? active.processedData : [];
        },
        set(val) {
            const active = getActiveTrace();
            if (active) active.processedData = val;
        }
    });

    Object.defineProperty(appState, 'rawData', {
        get() {
            const active = getActiveTrace();
            return active ? active.rawData : [];
        },
        set(val) {
            const active = getActiveTrace();
            if (active) active.rawData = val;
        }
    });

    Object.defineProperty(appState, 'headers', {
        get() {
            const active = getActiveTrace();
            return active ? active.headers : [];
        },
        set(val) {
            const active = getActiveTrace();
            if (active) active.headers = val;
        }
    });

    Object.defineProperty(appState, 'mapping', {
        get() {
            const active = getActiveTrace();
            return active ? active.mapping : {};
        },
        set(val) {
            const active = getActiveTrace();
            if (active) active.mapping = val;
        }
    });

    Object.defineProperty(appState, 'dataStats', {
        get() {
            const active = getActiveTrace();
            return active ? active.stats : {};
        }
    });

    Object.defineProperty(appState, 'mapPathData', {
        get() {
            const active = getActiveTrace();
            return active ? active.mapPathData : [];
        },
        set(val) {
            const active = getActiveTrace();
            if (active) active.mapPathData = val;
        }
    });

    Object.preventExtensions(appState);

    // --- MAP INITIALIZATION ---
    initializeMap();

    // --- CHART INITIALIZATION ---
    initializeChart();

    // --- FILE INPUT LISTENER ---
    const csvInput = document.getElementById('csv-input');
    if (csvInput) {
        csvInput.addEventListener('change', (e) => {
            handleFilesSelected(e.target.files);
            e.target.value = '';
        });
    }

    if (sharedDataParam) loadSharedData(sharedDataParam);

    attachJumpEvents();
    populateSampleDataDropdown();
    initGradientPicker();
}

function promptColumnMapping(traceId) {
    const targetTrace = traceId ? appState.traces.find(t => t.id === traceId) : getActiveTrace();
    if (!targetTrace) return;

    appState.mappingTraceId = targetTrace.id;
    const container = document.getElementById('mapper-rows');
    container.innerHTML = '';

    const modalTitle = document.querySelector('#mapper-modal h3');
    if (modalTitle) modalTitle.innerText = `Map Columns: ${targetTrace.name}`;

    if (!targetTrace.mapping || Object.keys(targetTrace.mapping).length === 0) {
        autoDetectColumns(targetTrace);
    }

    REQUIRED_FIELDS.forEach(field => {
        const div = document.createElement('div');
        div.style.marginBottom = "10px";

        const label = document.createElement('label');
        label.className = 'ui-label';
        label.htmlFor = `map-${field.key}`;
        label.innerText = field.label;
        label.style.marginBottom = "4px";

        const select = document.createElement('select');
        select.id = `map-${field.key}`;
        select.innerHTML = targetTrace.headers.map(h => `<option value="${h}">${h}</option>`).join('');
        select.value = targetTrace.mapping[field.key] || targetTrace.headers[0];

        div.appendChild(label);
        div.appendChild(select);
        container.appendChild(div);
    });

    document.getElementById('modal-overlay').style.display = 'flex';
}

function closeMapper() {
    document.getElementById('modal-overlay').style.display = 'none';
    appState.mappingTraceId = null;
}

function visualizeData(skipDom = false) {
    const targetTrace = appState.mappingTraceId ?
        appState.traces.find(t => t.id === appState.mappingTraceId) :
        getActiveTrace();

    if (targetTrace) {
        if (!skipDom) {
            REQUIRED_FIELDS.forEach(field => {
                const el = document.getElementById(`map-${field.key}`);
                if (el) targetTrace.mapping[field.key] = el.value;
            });
        }
        processTraceData(targetTrace);
    }

    document.getElementById('modal-overlay').style.display = 'none';
    appState.mappingTraceId = null;

    onTracesChanged(false);
}

function findNearestIndexInTrace(data, key, target) {
    if (!data || data.length === 0) return 0;
    let left = 0, right = data.length - 1;
    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        if (data[mid][key] < target) left = mid + 1;
        else right = mid - 1;
    }
    if (left >= data.length) return data.length - 1;
    if (left <= 0) return 0;
    const d1 = Math.abs(data[left][key] - target);
    const d2 = Math.abs(data[left - 1][key] - target);
    return d1 < d2 ? left : left - 1;
}

// Sync components when active point or playback time changes
const JumpEvent = {
    subscribers: [],
    subscribe(fn) {
        this.subscribers.push(fn);
    },

    jumpToSeconds(seconds, forceUpdate = false, source = null) {
        this.jumpToX(seconds, 'time', forceUpdate, source);
    },

    jumpToDistance(distKm, forceUpdate = false, source = null) {
        this.jumpToX(distKm, 'distance', forceUpdate, source);
    },

    jumpToX(xVal, mode = (appState ? appState.xAxisMode : 'time'), forceUpdate = false, source = null) {
        if (typeof xVal !== 'number' || isNaN(xVal)) return;

        let key = '_timeSec';
        if (mode === 'distance') key = '_distKm';
        else if (mode === 'absTime') key = '_absTime';

        // Update active point on each visible trace based on the selected dimension
        const visible = getVisibleTraces();
        visible.forEach(trace => {
            if (!trace.processedData || trace.processedData.length === 0) return;
            const idx = findNearestIndexInTrace(trace.processedData, key, xVal);
            trace.cursorIndex = idx;
            trace.cursorPoint = trace.processedData[idx];
        });

        const activeTrace = getActiveTrace();
        const activeIdx = activeTrace ? activeTrace.cursorIndex : 0;
        appState.hoverIndex = activeIdx;
        if (activeTrace && activeTrace.cursorPoint && activeTrace.cursorPoint._timeSec != null) {
            appState.playbackTime = activeTrace.cursorPoint._timeSec;
        }

        JumpEvent.publish(activeIdx, activeTrace ? activeTrace.cursorPoint : null, source);
    },

    jumpToTime(index, forceUpdate = false, source = null) {
        const activeTrace = getActiveTrace();
        if (!activeTrace || !activeTrace.processedData[index]) return;
        const pt = activeTrace.processedData[index];
        JumpEvent.jumpToSeconds(pt._timeSec, forceUpdate, source);
    },

    publish(index, point, source = null) {
        this.subscribers.forEach(fn => {
            try {
                fn(index, point, source);
            } catch (err) {
                console.error(`Telemetry Error in ${fn.name || 'subscriber'}:`, err);
            }
        });
    }
};

function attachJumpEvents() {
    // --- GUI Text Updates ---
    JumpEvent.subscribe(function updateGUI(idx, pt) {
        const activeTrace = getActiveTrace();
        const p = pt || (activeTrace && activeTrace.processedData[idx]);
        if (!p) return;

        const dispTime = document.getElementById('disp-time');
        const dispDist = document.getElementById('disp-dist');
        const dispAlt = document.getElementById('disp-alt');
        const traceNameBadge = document.getElementById('hud-active-trace-stat');
        const dispTraceName = document.getElementById('disp-trace-name');

        if (dispTime) dispTime.innerText = formatTime(p._timeSec);
        if (dispDist) dispDist.innerText = formatDistance(p._distKm);
        if (dispAlt) dispAlt.innerText = Math.round(p._alt) + " m";

        if (activeTrace && traceNameBadge && dispTraceName) {
            traceNameBadge.style.display = 'inline-flex';
            dispTraceName.innerText = activeTrace.name;
        } else if (traceNameBadge) {
            traceNameBadge.style.display = 'none';
        }
    });

    // --- ECharts Update ---
    JumpEvent.subscribe(function updateChart(idx, pt, source) {
        if (source === 'chart') return; // Don't re-dispatch when mouse is already interacting with chart
        if (chart && appState.activeChartTraces && appState.activeChartTraces.length > 0) {
            const activeTrace = getActiveTrace();
            const activeIdx = (activeTrace && activeTrace.cursorIndex != null) ? activeTrace.cursorIndex : idx;
            chart.dispatchAction({
                type: 'showTip',
                seriesIndex: 0,
                dataIndex: activeIdx
            });
        }
    });

    // --- Mapbox Update ---
    JumpEvent.subscribe(function updateMap() {
        renderMapLayers();
    });

    // --- Table Update ---
    JumpEvent.subscribe(function updateTable(idx) {
        if (typeof highlightTableRow === 'function') {
            highlightTableRow(idx);
        }
    });

    // Update cache when data loads or camera moves
    JumpEvent.subscribe(function updateScreenCoords(idx) {
        if (idx === 0) updateScreenCoordsCache();
    });
}


    // Detect if the first data row actually contains units (common pattern)
    function detectAndStripUnits(results) {
        const fields = results.meta && results.meta.fields ? results.meta.fields : [];
        const data = results.data || [];
        if (!data || data.length === 0) return { data, units: {} };

        const firstRow = data[0];
        const units = {};
        let unitCount = 0;

        const unitTokens = ['m','meter','metre','meters','metres','km','kilometer','kilometre','ft','feet','foot','s','sec','second','seconds','ms','millisecond','hr','hour','h','min','minute','°','deg','degree','degrees'];

        fields.forEach(h => {
            const val = firstRow[h];
            if (typeof val !== 'string') return;
            const s = val.trim().toLowerCase();
            if (!s || s.length > 20) return;
            if (/\d/.test(s)) return; // probably not a unit if it contains digits

            for (const token of unitTokens) {
                if (s === token || s.includes(token)) {
                    units[h] = s;
                    unitCount++;
                    break;
                }
            }
        });

        // If many columns look like units, treat the first data row as a units row
        if (unitCount >= Math.max(2, Math.floor(fields.length / 2))) {
            return { data: data.slice(1), units };
        }
        return { data, units: {} };
    }

    function normalizeUnit(u) {
        if (!u || typeof u !== 'string') return null;
        const s = u.toLowerCase();
        if (s.includes('meter') || s === 'm') return 'm';
        if (s.includes('kilom') || s === 'km') return 'km';
        if (s.includes('foot') || s.includes('ft') || s.includes('feet')) return 'ft';
        if (s === 'cm' || s.includes('cent')) return 'cm';
        if (s === 'ms' || s.includes('millis')) return 'ms';
        if (s === 's' || s.includes('sec')) return 's';
        if (s.includes('min')) return 'min';
        if (s === 'h' || s.includes('hour') || s.includes('hr')) return 'h';
        return s;
    }

    function convertAltitude(val, unitStr) {
        if (val == null) return val;
        const n = Number(val);
        if (Number.isNaN(n)) return val;
        const u = normalizeUnit(unitStr);
        if (!u) return n;
        if (u === 'm') return n;
        if (u === 'km') return n * 1000;
        if (u === 'ft') return n * 0.3048;
        if (u === 'cm') return n / 100;
        return n; // fallback
    }

    function convertTime(val, unitStr) {
        if (val == null) return val;
        const n = Number(val);
        if (Number.isNaN(n)) return val;
        const u = normalizeUnit(unitStr);
        if (!u) return n;
        if (u === 'ms') return n / 1000;
        if (u === 's') return n;
        if (u === 'min') return n * 60;
        if (u === 'h') return n * 3600;
        return n;
    }