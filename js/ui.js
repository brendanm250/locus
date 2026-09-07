// ui.js

// --- STANDARD UI FUNCTIONS ---
function initChartLists() {
    const visibleTraces = getVisibleTraces();
    const active = getActiveTrace();

    if (!visibleTraces.length) {
        const list = document.getElementById('trace-list');
        if (list) list.innerHTML = '';
        const select = document.getElementById('context-trace');
        if (select) select.innerHTML = '<option value="none">None</option>';
        return;
    }

    // Collect all numeric columns across visible traces
    const allNumericCols = new Set();
    visibleTraces.forEach(t => {
        if (t.headers && t.rawData && t.rawData[0]) {
            t.headers.forEach(h => {
                if (typeof t.rawData[0][h] === 'number') {
                    allNumericCols.add(h);
                }
            });
        }
    });
    const numericCols = Array.from(allNumericCols);

    // If activeChartTraces has no entries or columns no longer present, initialize with defaults
    if (!appState.activeChartTraces || appState.activeChartTraces.length === 0) {
        appState.activeChartTraces = [];
        if (active?.mapping?.alt && numericCols.includes(active.mapping.alt)) {
            appState.activeChartTraces.push(active.mapping.alt);
        }
        for (const col of numericCols) {
            if (active && Object.values(active.mapping || {}).includes(col)) continue;
            appState.activeChartTraces.push(col);
            if (appState.activeChartTraces.length >= 2) break;
        }
        if (appState.activeChartTraces.length === 0 && numericCols.length > 0) {
            appState.activeChartTraces.push(numericCols[0]);
        }
    } else {
        // Retain selected columns that exist
        const valid = appState.activeChartTraces.filter(c => numericCols.includes(c));
        if (valid.length > 0) {
            appState.activeChartTraces = valid;
        } else if (numericCols.length > 0) {
            appState.activeChartTraces = [numericCols[0]];
        }
    }

    const list = document.getElementById('trace-list');
    if (list) {
        list.innerHTML = '';
        numericCols.forEach(col => {
            const div = document.createElement('div');
            div.className = 'checkbox-item';
            div.innerHTML = `<label style="display: flex; align-items: center; gap: 6px; cursor: pointer; margin: 0; width: 100%;"><input type="checkbox" onchange="toggleChartTraces('${col}')" ${appState.activeChartTraces.includes(col) ? 'checked' : ''}> <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${col}">${col}</span></label>`;
            list.appendChild(div);
        });
    }

    // Initialize Context Trace
    // Initialize Context Trace Source Selector
    const sourceSelect = document.getElementById('context-source-select');
    if (sourceSelect) {
        sourceSelect.innerHTML = '<option value="active">Active Trace (Auto)</option>';
        visibleTraces.forEach(t => {
            sourceSelect.innerHTML += `<option value="${t.id}">${t.name}</option>`;
        });
        if (appState.contextTraceSource && (appState.contextTraceSource === 'active' || visibleTraces.some(t => t.id === appState.contextTraceSource))) {
            sourceSelect.value = appState.contextTraceSource;
        } else {
            appState.contextTraceSource = 'active';
            sourceSelect.value = 'active';
        }
    }

    // Initialize Context Trace Metric
    const select = document.getElementById('context-trace');
    if (select) {
        select.innerHTML = '<option value="none">None</option>';
        numericCols.forEach(h => {
            select.innerHTML += `<option value="${h}">${h}</option>`;
        });

        if (!appState.activeContextTrace || !numericCols.includes(appState.activeContextTrace)) {
            appState.activeContextTrace = appState.activeChartTraces[0] || 'none';
        }
        select.value = appState.activeContextTrace;
    }
}

function updateContextTraceSource(val) {
    appState.contextTraceSource = val;
    renderCharts();
}

function initColorList() {
    const select = document.getElementById('color-select');
    if (!select) return;
    const active = getActiveTrace();
    select.innerHTML = '<option value="none">None</option>';
    if (active && active.headers) {
        active.headers.forEach(h => {
            if (active.rawData && active.rawData[0] && typeof active.rawData[0][h] === 'number') {
                select.innerHTML += `<option value="${h}">${h}</option>`;
            }
        });
    }
    if (appState.colorBy) {
        select.value = appState.colorBy;
    }
}

function initGradientPicker() {
    const container = document.getElementById('gradient-picker');
    if (!container) return;
    container.innerHTML = '';
    Object.keys(GRADIENTS).forEach(name => {
        const btn = document.createElement('div'); btn.className = 'gradient-btn';
        btn.style.background = GRADIENTS[name];
        btn.onclick = () => selectGradient(name);
        if (name === appState.currentGradient) btn.classList.add('active');
        container.appendChild(btn);
    });
}

function selectGradient(name) {
    appState.currentGradient = name;
    document.querySelectorAll('.gradient-btn').forEach(b => b.classList.remove('active'));
    calculatePathColors();
    renderMapLayers(true);
}

function getGradientColor(t) {
    let stops = [];
    if (appState.currentGradient === 'Turbo') stops = [[0,0,255], [0,255,255], [0,255,0], [255,255,0], [255,0,0]];
    else if (appState.currentGradient === 'Thermal') stops = [[0,0,0], [100,0,0], [255,255,0], [255,255,255]];
    else if (appState.currentGradient === 'Ocean') stops = [[0,0,100], [0,100,255], [200,255,255]];
    else stops = [[0,100,0], [255,255,255]];
    const segmentCount = stops.length - 1;
    const segment = Math.floor(t * segmentCount);
    const i = Math.min(segment, segmentCount - 1);
    const localT = (t * segmentCount) - i;
    const c1 = stops[i];
    const c2 = stops[i+1];
    return [ Math.round(c1[0] + (c2[0] - c1[0]) * localT), Math.round(c1[1] + (c2[1] - c1[1]) * localT), Math.round(c1[2] + (c2[2] - c1[2]) * localT) ];
}

function setXAxisMode(mode) {
    appState.xAxisMode = mode;
    appState.chartZoom = null;
    appState.chartViewRange = null;
    renderCharts();
    renderMapLayers(true);
}

function toggleChartTraces(col) {
    if (appState.activeChartTraces.includes(col)) appState.activeChartTraces = appState.activeChartTraces.filter(c => c !== col);
    else appState.activeChartTraces.push(col);
    renderCharts();
}

function updateChartContextTrace(val) {
    appState.activeContextTrace = val;
    renderCharts();
}

function setPathColorMode(mode) {
    appState.colorMode = mode;
    const metricContainer = document.getElementById('metric-color-container');
    if (metricContainer) {
        metricContainer.style.display = mode === 'metric' ? 'block' : 'none';
    }
    calculatePathColors();
    renderMapLayers(true);
}

function updateColorBy(val) {
    appState.colorBy = val;
    const gradContainer = document.getElementById('gradient-container');
    if (gradContainer) {
        gradContainer.style.display = val === 'none' ? 'none' : 'block';
    }
    calculatePathColors();
    renderMapLayers(true);
}

// Multi-trace list rendering & management
function renderTraceList() {
    const container = document.getElementById('trace-list-container');
    const countBadge = document.getElementById('trace-count');
    const clearBtn = document.getElementById('btn-clear-traces');
    if (!container) return;

    const traces = appState.traces || [];
    if (countBadge) countBadge.innerText = traces.length;
    if (clearBtn) clearBtn.style.display = traces.length > 0 ? 'inline-block' : 'none';

    if (traces.length === 0) {
        container.innerHTML = `<div id="trace-empty-hint" style="font-size: 0.75rem; color: var(--text-muted); font-style: italic; padding: 8px 0; text-align: center;">No traces loaded. Add a CSV or sample track.</div>`;
        return;
    }

    container.innerHTML = '';
    traces.forEach(trace => {
        const isActive = trace.id === appState.activeTraceId;
        const div = document.createElement('div');
        div.className = `trace-card ${isActive ? 'active-trace' : ''}`;
        div.id = `trace-card-${trace.id}`;

        const durStr = trace.stats && trace.stats.totalDuration ? formatTime(trace.stats.totalDuration) : '--';
        const distStr = trace.stats && trace.stats.totalDistance ? formatDistance(trace.stats.totalDistance) : '--';
        const ptCount = trace.processedData ? trace.processedData.length : 0;

        div.innerHTML = `
            <input type="checkbox" class="trace-card-visibility" title="Toggle visibility" ${trace.visible ? 'checked' : ''} onchange="toggleTraceVisibility('${trace.id}')">
            <div class="trace-color-picker-wrapper" style="background: ${trace.hexColor};" title="Click to change trace color">
                <input type="color" class="trace-color-input" value="${trace.hexColor}" onchange="updateTraceColor('${trace.id}', this.value)">
            </div>
            <div class="trace-info" onclick="setActiveTrace('${trace.id}')" title="Click to set as active trace">
                <div class="trace-name">
                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${trace.name}</span>
                    ${isActive ? '<span class="trace-active-badge">Active</span>' : ''}
                </div>
                <div class="trace-meta">${ptCount} pts • ${durStr} • ${distStr}</div>
            </div>
            <div class="trace-actions">
                <button type="button" class="trace-action-btn" title="Remap CSV columns" onclick="promptColumnMapping('${trace.id}')">Map</button>
                <button type="button" class="trace-action-btn btn-remove" title="Remove trace" onclick="removeTrace('${trace.id}')">✕</button>
            </div>
        `;
        container.appendChild(div);
    });
}

function setActiveTrace(traceId) {
    if (appState.activeTraceId === traceId) return;
    appState.activeTraceId = traceId;
    const active = getActiveTrace();

    renderTraceList();
    initColorList();
    if (typeof initChartLists === 'function') initChartLists();

    if (active) {
        populateShareColumnOptions(active.headers);
        renderTable(active.rawData, active.headers);
    }

    updateTableTraceSelect();
    if (typeof updateScreenCoordsCache === 'function') {
        updateScreenCoordsCache();
    }
    JumpEvent.jumpToSeconds(appState.playbackTime || 0, true);
    renderMapLayers(true);
}

function toggleTraceVisibility(traceId) {
    const trace = appState.traces.find(t => t.id === traceId);
    if (!trace) return;
    trace.visible = !trace.visible;

    onTracesChanged(false);
}

function removeTrace(traceId) {
    appState.traces = appState.traces.filter(t => t.id !== traceId);
    if (appState.activeTraceId === traceId) {
        appState.activeTraceId = appState.traces[0]?.id || null;
    }
    onTracesChanged(false);
}

function clearAllTraces() {
    appState.traces = [];
    appState.activeTraceId = null;
    appState.playbackTime = 0;
    onTracesChanged(false);
}

function updateTraceColor(traceId, newHexColor) {
    const trace = appState.traces.find(t => t.id === traceId);
    if (!trace) return;
    trace.hexColor = newHexColor;
    trace.color = hexToRgb(newHexColor);

    const card = document.getElementById(`trace-card-${traceId}`);
    if (card) {
        const swatch = card.querySelector('.trace-color-picker-wrapper');
        if (swatch) swatch.style.background = newHexColor;
    }

    calculatePathColors();
    renderMapLayers(true);
    if (typeof renderCharts === 'function') renderCharts();
}

function updateTableTraceSelect() {
    const select = document.getElementById('table-trace-select');
    if (!select) return;
    const traces = appState.traces || [];
    if (traces.length <= 1) {
        select.style.display = 'none';
        return;
    }
    select.style.display = 'inline-block';
    select.innerHTML = traces.map(t => `<option value="${t.id}" ${t.id === appState.activeTraceId ? 'selected' : ''}>${t.name}</option>`).join('');
}

function onTableTraceChanged(traceId) {
    setActiveTrace(traceId);
}

function calculatePathColors() {
    const visibleTraces = getVisibleTraces();
    if (!visibleTraces.length) return;

    visibleTraces.forEach(trace => {
        if (!trace.mapPathData || !trace.mapPathData.length) return;

        if (appState.colorMode === 'trace' || appState.colorBy === 'none') {
            trace.pathColors = Array(trace.mapPathData.length).fill(trace.color);
            return;
        }

        const values = trace.mapPathData.map(d => typeof d[appState.colorBy] === 'number' ? d[appState.colorBy] : null);
        const validValues = values.filter(v => v !== null);

        if (validValues.length === 0) {
            trace.pathColors = Array(trace.mapPathData.length).fill(trace.color);
            return;
        }

        const min = Math.min(...validValues);
        const range = Math.max(...validValues) - min || 1;

        trace.pathColors = trace.mapPathData.map(d => {
            const val = d[appState.colorBy];
            if (val == null || typeof val !== 'number') return trace.color;
            const norm = (val - min) / range;
            return getGradientColor(norm);
        });
    });

    const active = getActiveTrace();
    appState.pathColors = active?.pathColors || null;
}

function updateScale(val) {
    appState.altScale = parseFloat(val);
    appState.effectiveScale = getEffectiveScale();
    const scaleVal = document.getElementById('scale-val');
    if (scaleVal) scaleVal.innerText = appState.altScale.toFixed(2) + "x";
    updateScreenCoordsCache();
    syncTerrainToPitch();
    renderMapLayers();
    updateChartHighlight();
}

let lastPlayTimestamp = null;
function togglePlay() {
    if (!appState.traces || appState.traces.length === 0) return;
    appState.isPlaying = !appState.isPlaying;
    const playBtn = document.getElementById('play-btn');
    if (playBtn) playBtn.innerText = appState.isPlaying ? '⏸' : '▶';
    if (appState.isPlaying) {
        lastPlayTimestamp = performance.now();
        requestAnimationFrame(playLoop);
    } else {
        lastPlayTimestamp = null;
    }
}

function playLoop(timestamp) {
    if (!appState.isPlaying) return;
    if (!lastPlayTimestamp) lastPlayTimestamp = timestamp || performance.now();
    const now = timestamp || performance.now();
    const dt = Math.min((now - lastPlayTimestamp) / 1000, 0.1);
    lastPlayTimestamp = now;

    const maxDur = appState.maxDuration || 10;
    const baseSpeed = Math.max(1, maxDur / 60);
    const speed = baseSpeed * (appState.playbackRate || 1);

    let nextTime = (appState.playbackTime || 0) + dt * speed;
    if (nextTime >= maxDur) {
        nextTime = 0;
    }

    JumpEvent.jumpToSeconds(nextTime, true);

    const slider = document.getElementById('time-slider');
    if (slider) slider.value = nextTime;

    requestAnimationFrame(playLoop);
}

function toggleTable() {
    const tablePanel = document.getElementById('table-panel');
    if (!tablePanel) return;
    tablePanel.style.display = tablePanel.style.display === 'flex' ? 'none' : 'flex';
    highlightTableRow(appState.hoverIndex);
    updateTableTraceSelect();
    requestAnimationFrame(adjustHUDLayout);
}

// --- NEW UI INTERACTION LOGIC ---

/**
 * Toggles the entire control panel visibility
 */
function togglePanel() {
    const panel = document.getElementById('control-panel');
    const btn = document.getElementById('minimize-panel');
    const isMinimized = panel.classList.toggle('minimized');
    btn.innerText = isMinimized ? '+' : '−';
}

/**
 * Toggles individual sections within the panel
 */
function toggleSection(headerElement) {
    const section = headerElement.parentElement;
    section.classList.toggle('collapsed');
}

/**
 * Call this inside finishMapping() to reveal data-dependent controls
 */
function revealDataControls() {
    const dataControls = document.getElementById('data-dependent-controls');
    dataControls.style.display = 'block';
    document.getElementById('data-action-btns').style.display = 'flex';
}

function toggleChart() {
    const container = document.getElementById('chart-container');
    const btn = document.getElementById('minimize-chart');
    const isMinimized = container.classList.toggle('minimized');

    btn.innerText = isMinimized ? '+' : '−';

    // Crucial: ECharts needs to know if its container changed size
    setTimeout(() => {
        if (chart) chart.resize();
    }, 250);
}

function toggleChartSidebar() {
    const sidebar = document.getElementById('chart-sidebar');
    sidebar.classList.toggle('collapsed');
    const toggleBtn = document.getElementById('sidebar-toggle');
    if (toggleBtn) toggleBtn.classList.toggle('active', !sidebar.classList.contains('collapsed'));

    // As the sidebar collapses, the chart div expands.
    // We resize multiple times during the transition for smoothness.
    let count = 0;
    const interval = setInterval(() => {
        if (chart) chart.resize();
        count++;
        if (count > 30) clearInterval(interval);
    }, 10);
}

// Update initializeChartUI to handle the new structure
function initializeChartUI() {
    document.getElementById('chart-placeholder').style.display = 'none';
    const chartDiv = document.getElementById('chart');
    chartDiv.style.display = 'block';

    requestAnimationFrame(() => {
        if (chart) chart.resize();
    });
}

function collapseSetupSections() {
    const sectionsToHide = ['section-input', 'section-map'];

    sectionsToHide.forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('collapsed')) {
            el.classList.add('collapsed');
        }
    });
}

function adjustHUDLayout() {
    const hud = document.getElementById('playback-hud');
    const controlPanel = document.getElementById('control-panel');
    const tablePanel = document.getElementById('table-panel');

    if (!hud) return;

    // 1. Find Left Boundary (Data Controls)
    let leftBoundary = 20;
    if (controlPanel && controlPanel.offsetWidth > 0) {
        leftBoundary = controlPanel.getBoundingClientRect().right + 20; // 20px padding
    }

    // 2. Find Right Boundary (Table Panel OR Top-Right Mapbox Controls)
    let rightBoundary = window.innerWidth - 20;

    if (tablePanel && tablePanel.offsetWidth > 0) {
        rightBoundary = Math.min(rightBoundary, tablePanel.getBoundingClientRect().left - 20); // 20px padding
    }

    // FIX: Only check TOP RIGHT controls. This ignores the wide Mapbox attribution text at the bottom.
    const rightControls = document.querySelectorAll('.mapboxgl-ctrl-top-right .mapboxgl-ctrl');
    rightControls.forEach(ctrl => {
        if (ctrl.offsetWidth > 0) {
            rightBoundary = Math.min(rightBoundary, ctrl.getBoundingClientRect().left - 20); // 20px padding
        }
    });

    // 3. Calculate Space & Clamp Center
    const hudWidth = 500;
    const availableWidth = rightBoundary - leftBoundary;

    if (availableWidth < hudWidth) {
        // Squish mode
        hud.style.transform = 'none';
        hud.style.left = `${leftBoundary}px`;
        hud.style.width = `${Math.max(300, availableWidth)}px`;
    } else {
        // Centered mode
        hud.style.width = `${hudWidth}px`;
        hud.style.transform = 'translateX(-50%)';

        let targetCenter = window.innerWidth / 2;
        const minSafeCenter = leftBoundary + (hudWidth / 2);
        const maxSafeCenter = rightBoundary - (hudWidth / 2);

        targetCenter = Math.max(minSafeCenter, Math.min(targetCenter, maxSafeCenter));
        hud.style.left = `${targetCenter}px`;
    }
}