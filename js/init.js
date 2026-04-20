// init.js

let REQUIRED_FIELDS = null;

window.addEventListener('offline', () => {
    const liveIndicator = document.getElementById('offline-indicator');
    liveIndicator.removeAttribute('hidden');
});

window.addEventListener('online', () => {
    const liveIndicator = document.getElementById('offline-indicator');
    liveIndicator.setAttribute('hidden', '');
});

// Run this right away inside your launchApp() function so the list is ready
function populateSampleDataDropdown() {
    const owner = 'brendanm250'; // e.g., 'vcervewrv'
    const repo = 'locus';       // e.g., 'flight-path-map'
    const folderPath = 'sample_data';           // The folder where your CSVs live

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${folderPath}`;

    fetch(apiUrl)
        .then(response => {
            if (!response.ok) throw new Error('GitHub API rate limit or repo not found');
            return response.json();
        })
        .then(files => {
            const select = document.getElementById('sample-data-select');
            select.innerHTML = ''; // Clear the "Loading..." text

            // Filter out anything that isn't a CSV
            const csvFiles = files.filter(file => file.name.endsWith('.csv'));

            if (csvFiles.length === 0) {
                select.innerHTML = '<option value="">No samples found</option>';
                return;
            }

            // Populate the dropdown
            csvFiles.forEach(file => {
                const option = document.createElement('option');
                // The API provides a 'download_url' which gives us the raw CSV text
                option.value = file.download_url;
                option.textContent = file.name.replace('.csv', ''); // Make it look cleaner
                select.appendChild(option);
            });
        })
        .catch(error => {
            console.error('Error fetching file list:', error);
            document.getElementById('sample-data-select').innerHTML = '<option value="">Failed to load list</option>';
        });
}

// Attach this to your new Load button
function loadSelectedSample() {
    const downloadUrl = document.getElementById('sample-data-select').value;

    if (!downloadUrl) {
        alert("Please select a valid sample file.");
        return;
    }

    fetch(downloadUrl)
        .then(response => {
            if (!response.ok) throw new Error('Failed to fetch file content');
            return response.text();
        })
        .then(csvText => {
            Papa.parse(csvText, {
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true,
                complete: (results) => {
                    appState.rawData = results.data;
                    appState.headers = results.meta.fields;

                    // You can call visualizeData() directly here if you want to bypass the mapping modal
                    promptColumnMapping();
                }
            });
        })
        .catch(error => {
            console.error('Error loading sample data:', error);
            alert('Failed to load sample data.');
        });
}

function launchApp() {
    // Run when the window changes size
    window.addEventListener('resize', adjustHUDLayout);

    // Run a ResizeObserver on the control panel.
    // This is critical because it will fire smoothly as the panel transitions
    // between expanded and minimized states, keeping the HUD locked to its edge.
    const panelObserver = new ResizeObserver(() => {
        adjustHUDLayout();
    });

    const controlPanel = document.getElementById('control-panel');
    if (controlPanel) panelObserver.observe(controlPanel);

    // Ensure it runs once on startup
    requestAnimationFrame(adjustHUDLayout);

    appState = {
        rawData: [],
        processedData: [],
        mapPathData: [],
        dataStats: {},
        headers: [],
        mapping: {},
        hoverIndex: -1,
        altScale: 1.75,
        isPlaying: false,
        colorBy: 'none',
        currentGradient: 'Turbo',
        activeChartTraces: [],
        activeContextTrace: null,
        xAxisMode: 'time',
        chartMouseY: null,
        totalDuration: 0,
        pathColors: null,
        screenCoordsCache: [],
        isCameraMoving: false,
        chartViewRange: null,
        highlightedDataCache: [],
        liftedSegments: [],
        showCorrections: true,
        showGroundTrack: true,
        terrainVersion: 0,
        effectiveScale: null
    };
    Object.preventExtensions(appState); // Make sure I centrally manage app state properties

    // --- MAP INITIALIZATION ---
    initializeMap();

    // --- CHART INITIALIZATION ---
    initializeChart();

    // --- STATE ---
    document.getElementById('csv-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        Papa.parse(file, {
            header: true,
            dynamicTyping: true,
            skipEmptyLines: true,
            complete: (results) => {
                appState.rawData = results.data;
                appState.headers = results.meta.fields;
                promptColumnMapping();
            }
        });
    });

    attachJumpEvents();
    populateSampleDataDropdown();
}

function promptColumnMapping() {
    const container = document.getElementById('mapper-rows');
    container.innerHTML = '';

    REQUIRED_FIELDS = [
        { key: 'time', label: 'Time' },
        { key: 'lat', label: 'Latitude' },
        { key: 'lon', label: 'Longitude' },
        { key: 'alt', label: 'Altitude' }
    ];
    REQUIRED_FIELDS.forEach(field => { //TODO allow for data without time or altitude
        const div = document.createElement('div');
        div.style.marginBottom = "10px";
        const label = document.createElement('div');
        label.innerText = field.label;
        label.style.color="#aaa";

        const select = document.createElement('select');
        select.id = `map-${field.key}`;

        let selectedIdx = 0;
        if (appState.mapping[field.key]) {
            selectedIdx = appState.headers.indexOf(appState.mapping[field.key]);
        } else {
            let bestScore = -1;
            appState.headers.forEach((h, i) => {
                const header = h.toLowerCase();
                const key = field.key.toLowerCase();
                let score = 0;

                if (header.includes(key)) {
                    score = 1; // Base match (e.g., "alt")

                    // "Nudge" the altitude logic
                    if (field.key === 'alt') {
                        if (header.includes('gps')) score += 1;
                        if (header.includes('msl') || header.includes('hae')) score += 1;
                        if (header.includes('baro')) score += 0.5; // Deprioritize baro if others exist
                    }

                    // "Nudge" the time logic
                    if (field.key === 'time') {
                        if (header.includes('time')) score += 1;
                    }
                }

                if (score > bestScore) {
                    bestScore = score;
                    selectedIdx = i;
                }
            });
        }

        select.innerHTML = appState.headers.map(h => `<option value="${h}">${h}</option>`).join('');
        select.selectedIndex = Math.max(0, selectedIdx);
        div.appendChild(label);
        div.appendChild(select);
        container.appendChild(div);
    });
    document.getElementById('modal-overlay').style.display = 'flex';
}

function visualizeData() {
    REQUIRED_FIELDS.forEach(field => {
        appState.mapping[field.key] = document.getElementById(`map-${field.key}`).value;
    });
    document.getElementById('modal-overlay').style.display = 'none';

    let cumDist = 0;
    let distAccumulator = 0;
    let startTime = null;
    let lastLat = null;
    let lastLon = null;

    appState.processedData = appState.rawData.map((row, i) => {
        const rawLat = row[appState.mapping.lat];
        const rawLon = row[appState.mapping.lon];
        const rawAlt = row[appState.mapping.alt] || 'noAltData';
        const rawTime = row[appState.mapping.time] || 'noTimeData';

        if (!rawLat || !rawLon) return null;

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
            if (i === 0) startTime = rawTime;
            const isMs = rawTime > 1e11;
            timeSec = isMs ? (rawTime - startTime) / 1000 : (rawTime - startTime);
        }

        return {
            ...row,
            _lat: rawLat, _lon: rawLon, _alt: rawAlt,
            _renderAlt: rawAlt, // Default to raw for initial rendering
            _isLifted: false,
            _distKm: cumDist / 1000,
            _timeSec: timeSec,
            _rawIndex: i, // Store original index for reference when path is later split into segments
            _groundAlt: null
        };
    }).filter(r => r !== null);


    if (appState.processedData.length > 0) {
        appState.totalDuration = appState.processedData[appState.processedData.length - 1]._timeSec;
    }

    initChartLists();
    initColorList();
    initGradientPicker();


    document.getElementById('time-slider').max = appState.processedData.length - 1;

    lats = Array.from(appState.processedData, (pt) => pt._lat)
    lons = Array.from(appState.processedData, (pt) => pt._lon)
    appState.dataStats.maxLat = Math.max(...lats)
    appState.dataStats.minLat = Math.min(...lats)
    appState.dataStats.maxLon = Math.max(...lons)
    appState.dataStats.minLon = Math.min(...lons)
    appState.dataStats.centerCoords = [
        (appState.dataStats.maxLon + appState.dataStats.minLon)/2,
        (appState.dataStats.maxLat + appState.dataStats.minLat)/2,
    ]

    if (appState.processedData.length > 0) {
        flyToCenter({
        padding: {top: 50, bottom: 50, left: 100, right: 50},
        bearing: 20,
        pitch: 45,
        curve: 3,
        // duration: 8000
    });
    }
    map.once('idle', () => applyTerrainCorrection());

    // Simplify Data for Map Trace
    appState.mapPathData = appState.processedData;
    appState.chartViewRange = [0, appState.processedData.length]

    renderTable(appState.rawData, appState.headers);
    calculatePathColors();
    renderMapLayers();

    revealDataControls();
    initializeChartUI()
    renderCharts();
    collapseSetupSections();
}

// Sync components when active point changes
const JumpEvent = {
    subscribers: [],
    subscribe(fn) {
        this.subscribers.push(fn);
    },

    jumpToTime(index, forceUpdate = false) {
        // 1. Data Validation (Sanitization)
        if (!appState.processedData[index]) return;

        // 2. Prevent Redundant Processing (The Infinite Loop Fix)
        if (!forceUpdate && appState.hoverIndex === index) return;

        // 3. State Update
        appState.hoverIndex = index;

        // 4. Notify everyone that the time has changed
        JumpEvent.publish(index);
    },

    publish(index) {
        this.subscribers.forEach(fn => {
            try {
                fn(index);
            } catch (err) {
                console.error(`Telemetry Error in ${fn.name || 'subscriber'}:`, err);
            }
        });
    }
};

function attachJumpEvents() {
     // --- GUI Text Updates ---
    JumpEvent.subscribe(function updateGUI(idx) {
        const pt = appState.processedData[idx];
        document.getElementById('disp-time').innerText = formatTime(pt._timeSec);
        document.getElementById('disp-dist').innerText = formatDistance(pt._distKm);
        document.getElementById('disp-alt').innerText = Math.round(pt._alt) + " m";
    });

    // --- ECharts Update ---
    JumpEvent.subscribe(function updateChart(idx) {
        chart.dispatchAction({
            type: 'showTip',
            seriesIndex: 0,
            dataIndex: idx
        });
    });

    // --- Mapbox Update ---
    JumpEvent.subscribe(function updateMap(idx) {
        renderMapLayers();
    });

    // --- Table Update ---
    JumpEvent.subscribe(function updateTable(idx) {
        highlightTableRow(idx); // if table is displayed
    });

    // Update cache when data loads or camera moves
    JumpEvent.subscribe(function updateScreenCoords(idx) {
        if(idx === 0) updateScreenCoordsCache() // Initial load
    });
}

