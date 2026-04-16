// ui.js

// --- STANDARD UI FUNCTIONS ---
function initChartLists() {
    const numericCols = appState.headers.filter(h => {
        const val = appState.rawData[0][h];
        return typeof val === 'number';
    });

    // Initialize Visible Chart Traces
    appState.activeChartTraces = [];
    if (appState.mapping.alt) appState.activeChartTraces.push(appState.mapping.alt); // Show alt if available
    for (const col of numericCols) {
        if(Object.values(appState.mapping).includes(col)) continue;
        appState.activeChartTraces.push(col);
        if(appState.activeChartTraces.length >= 2) break;
    }

    const list = document.getElementById('trace-list');
    list.innerHTML = '';
    numericCols.forEach(col => {
        const div = document.createElement('div');
        div.className = 'checkbox-item';
        div.innerHTML = `<input type="checkbox" onchange="toggleChartTraces('${col}')" ${appState.activeChartTraces.includes(col)?'checked':''}> ${col}`;
        list.appendChild(div);
    });

    // Initialize Context Trace

    const select = document.getElementById('context-trace');
    select.innerHTML = '<option value="none">None</option>';
    appState.headers.forEach(h => { if (typeof appState.rawData[0][h] === 'number') select.innerHTML += `<option value="${h}">${h}</option>`; });

    if(appState.activeChartTraces.length > 0) {
        appState.activeContextTrace = appState.activeChartTraces[0];
        select.value = appState.activeContextTrace;
    }

}

function initColorList() {
    const select = document.getElementById('color-select');
    select.innerHTML = '<option value="none">None</option>';
    appState.headers.forEach(h => { if (typeof appState.rawData[0][h] === 'number') select.innerHTML += `<option value="${h}">${h}</option>`; });
}

function initGradientPicker() {
    const container = document.getElementById('gradient-picker'); container.innerHTML = '';
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
    renderMapLayers();
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
    renderCharts();
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

function updateColorBy(val) {
    appState.colorBy = val;
    document.getElementById('gradient-container').style.display = val === 'none' ? 'none' : 'block';
    calculatePathColors();
    renderMapLayers();
}



function calculatePathColors() {
    if (!appState.mapPathData.length) return;

    if (appState.colorBy === 'none') {
        appState.pathColors = Array(appState.processedData.length).fill([255, 100, 100]);
        return;
    }

    const values = appState.mapPathData.map(d => d[appState.colorBy]);
    const min = Math.min(...values);
    const range = Math.max(...values) - min || 1;

    appState.pathColors = appState.mapPathData.map(d => {
        const val = d[appState.colorBy];
        const norm = (val - min) / range;
        return getGradientColor(norm);
    });
}

function updateScale(val) {
    appState.altScale = parseFloat(val);
    appState.effectiveScale = getEffectiveScale()
    document.getElementById('scale-val').innerText = appState.altScale.toFixed(2) + "x";
    syncTerrainToPitch();
    renderMapLayers();
    updateChartHighlight();
}

function togglePlay() {
    appState.isPlaying = !appState.isPlaying;
    document.getElementById('play-btn').innerText = appState.isPlaying ? '⏸' : '▶';
    if (appState.isPlaying) playLoop();
}

function playLoop() {
    if (!appState.isPlaying) return;
    let next = appState.hoverIndex + 1;
    if (next >= appState.processedData.length) next = 0;
    JumpEvent.jumpToTime(next, false);
    document.getElementById('time-slider').value = next;
    requestAnimationFrame(playLoop);
}

function toggleTable() {
    const tablePanel = document.getElementById('table-panel');
    tablePanel.style.display = tablePanel.style.display === 'flex' ? 'none' : 'flex';
    highlightTableRow(appState.hoverIndex);
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
}

function toggleChart() {
    const container = document.getElementById('chart-container');
    const btn = document.getElementById('minimize-chart');
    const isMinimized = container.classList.toggle('minimized');

    btn.innerText = isMinimized ? '+' : '−';

    // Crucial: ECharts needs to know if its container changed size
    setTimeout(() => {
        if (typeof chart !== 'undefined') chart.resize();
    }, 250);
}

function toggleChartSidebar() {
    const sidebar = document.getElementById('chart-sidebar');
    sidebar.classList.toggle('collapsed');

    // As the sidebar collapses, the chart div expands.
    // We resize multiple times during the transition for smoothness.
    let count = 0;
    const interval = setInterval(() => {
        if (typeof chart !== 'undefined') chart.resize();
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
        if (typeof chart !== 'undefined') chart.resize();
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