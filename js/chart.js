// chart.js

var theme = window.theme || {
    get: (varName) => getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
};
window.theme = theme;

var METRIC_PALETTE = window.METRIC_PALETTE || [
    '#00d2ff', // cyan
    '#ff7a00', // orange
    '#10b981', // emerald green
    '#a855f7', // purple
    '#f43f5e', // rose
    '#eab308', // gold
    '#ec4899', // pink
    '#06b6d4'  // teal
];
window.METRIC_PALETTE = METRIC_PALETTE;

let mapOverlayTimer = null;

function initializeChart() {
    const el = document.getElementById('chart');
    if (!el) return;
    chart = echarts.init(el);
    initializeChartListeners();
}

function initializeChartListeners() {
    chart.getZr().on('mousemove', (params) => {
        appState.chartMouseY = params.offsetY;

        const pointInPixel = [params.offsetX, params.offsetY];

        // Check specifically against the main grid (gridIndex 0)
        if (chart.containPixel({ gridIndex: 0 }, pointInPixel)) {
            const logicalCoords = chart.convertFromPixel({ gridIndex: 0 }, pointInPixel);

            if (logicalCoords && !isNaN(logicalCoords[0])) {
                const xVal = logicalCoords[0];
                JumpEvent.jumpToX(xVal, appState.xAxisMode, false, 'chart');
            }
        }
    });

    chart.off('dataZoom');

    chart.on('dataZoom', (params) => {
        const batch = params.batch ? params.batch[0] : params;
        const startPct = batch.start != null ? batch.start : 0;
        const endPct = batch.end != null ? batch.end : 100;
        const isZoomed = (startPct > 0.5 || endPct < 99.5);

        let startX = batch.startValue;
        let endX = batch.endValue;

        const visible = getVisibleTraces();
        const key = appState.xAxisMode === 'distance' ? '_distKm' : (appState.xAxisMode === 'absTime' ? '_absTime' : '_timeSec');

        if (startX == null || endX == null) {
            let minX = Infinity;
            let maxX = -Infinity;
            visible.forEach(t => {
                if (t.processedData && t.processedData.length) {
                    const first = t.processedData[0][key];
                    const last = t.processedData[t.processedData.length - 1][key];
                    if (first != null && first < minX) minX = first;
                    if (last != null && last > maxX) maxX = last;
                }
            });
            if (minX !== Infinity && maxX !== -Infinity) {
                const span = maxX - minX;
                startX = minX + (startPct / 100) * span;
                endX = minX + (endPct / 100) * span;
            }
        }

        appState.chartZoom = {
            isZoomed,
            startPct,
            endPct,
            startX,
            endX,
            xAxisMode: appState.xAxisMode
        };
        appState.chartViewRange = [startX, endX];

        renderMapLayers();
    });
}

function formatXAxisValue(val) {
    if (typeof val !== 'number' || isNaN(val)) return '--';
    if (appState.xAxisMode === 'distance') {
        return formatDistance(val);
    }
    if (appState.xAxisMode === 'absTime') {
        try {
            const ms = val > 1e11 ? val : val * 1000;
            const d = new Date(ms);
            return isNaN(d.getTime()) ? val : d.toLocaleTimeString();
        } catch (e) {
            return val;
        }
    }
    return formatTime(val);
}

function buildChartLayout(xAxisMode, metricCount) {
    // --- LAYOUT VARIABLES ---
    const leftMargin = 45;
    const AXIS_SLOT_WIDTH = 75;
    let rightMarginMain = 35;
    if (metricCount > 1) {
        rightMarginMain = 35 + (metricCount - 1) * AXIS_SLOT_WIDTH;
    }
    const rightMarginContext = rightMarginMain;
    if (metricCount === 2) {
        rightMarginMain = 55;
    } else if (metricCount > 2) {
        rightMarginMain = (metricCount - 1) * 55;
    }
    const topMargin = 4;        // % from top of chart canvas
    const mainHeight = 70;      // % height of the main chart
    const gap = 8;              // % empty space for X-axis labels and context badge
    const contextHeight = 12;   // % height of the bottom mini-chart

    const mainGridTopStr = `${topMargin}%`;
    const mainGridHeightStr = `${mainHeight}%`;
    const contextGridTopStr = `${topMargin + mainHeight + gap}%`;
    const contextGridHeightStr = `${contextHeight}%`;

    const gridConfig = [
        // Grid 0: Main View
        {
            left: leftMargin,
            right: rightMarginMain,
            top: mainGridTopStr,
            height: mainGridHeightStr,
            containLabel: true
        },
        // Grid 1: Context Strip
        {
            left: leftMargin,
            right: rightMarginContext,
            top: contextGridTopStr,
            height: contextGridHeightStr
        }
    ];

    const xAxisConfig = [
        { // Main chart
            type: 'value',
            gridIndex: 0,
            nameLocation: 'middle',
            nameGap: 35,
            axisLabel: { formatter: formatXAxisValue, color: '#aaa' },
            splitLine: { show: false },
            min: 'dataMin',
            max: 'dataMax'
        },
        { // Context chart
            type: 'value',
            gridIndex: 1,
            show: false,
            min: 'dataMin',
            max: 'dataMax'
        }
    ];

    const dataZoom = {
        type: 'slider',
        xAxisIndex: 0,
        left: leftMargin,
        right: rightMarginContext,
        top: contextGridTopStr,
        height: contextGridHeightStr,
        bottom: 'auto',
        borderColor: 'transparent',
        backgroundColor: 'transparent',
        fillerColor: 'rgba(100, 149, 237, 0.2)',
        handleSize: '100%',
        showDetail: false,
        realtime: true,
        showDataShadow: false,
        brushSelect: false
    };

    return {
        gridConfig: gridConfig,
        xAxisConfig: xAxisConfig,
        dataZoom: dataZoom
    };
}

function buildTraces(xAxisMode, data) {
    const yAxisConfig = [];
    const series = [];
    let xAxisKey = '_timeSec';
    if (appState.xAxisMode === 'distance') {
        xAxisKey = '_distKm';
    } else if (appState.xAxisMode === 'absTime') {
        xAxisKey = '_absTime';
    }

    const textMuted = theme.get('--text-muted');
    const textMain = theme.get('--text-main');
    const visibleTraces = getVisibleTraces();

    // Sort visible traces so that the active trace comes first.
    // This ensures seriesIndex 0 is ALWAYS the active trace for tooltip and jump actions.
    const sortedTraces = [...visibleTraces].sort((a, b) => {
        if (a.id === appState.activeTraceId) return -1;
        if (b.id === appState.activeTraceId) return 1;
        return 0;
    });

    const isSingleDataset = visibleTraces.length <= 1;

    (appState.activeChartTraces || []).forEach((col, metricIdx) => {
        const metricColor = METRIC_PALETTE[metricIdx % METRIC_PALETTE.length];
        const axisColor = isSingleDataset ? metricColor : textMain;
        const axisBorder = isSingleDataset ? metricColor : theme.get('--panel-border');
        const axisTextColor = isSingleDataset ? metricColor : textMuted;

        yAxisConfig.push({
            type: 'value',
            gridIndex: 0,
            name: col,
            nameLocation: 'middle',
            nameGap: 35,
            nameGap: 38,
            position: metricIdx === 0 ? 'left' : 'right',
            offset: metricIdx > 1 ? (metricIdx - 1) * 60 : 0,
            offset: metricIdx > 1 ? (metricIdx - 1) * 75 : 0,
            splitLine: { show: false },
            axisLine: { show: true, lineStyle: { color: theme.get('--panel-border') } },
            axisLine: { show: true, lineStyle: { color: axisBorder } },
            axisLabel: {
                color: textMain,
                color: axisColor,
                fontSize: 10,
                formatter: (val) => {
                    try { return formatMagnitude(val, 3); } catch (e) { return val; }
                }
            },
            nameTextStyle: {
                color: axisTextColor,
                fontSize: 11,
                fontWeight: isSingleDataset ? 'bold' : 'normal'
            }
        });

        // Line dash style per metric so multiple metrics are visually distinguishable:
        // Metric 0: solid, Metric 1: dashed, Metric 2: dotted
        const lineType = metricIdx === 0 ? 'solid' : (metricIdx === 1 ? 'dashed' : 'dotted');

        sortedTraces.forEach(trace => {
            if (!trace.processedData || !trace.processedData.length) return;

            let targetCol = col;
            const firstPt = trace.processedData[0];
            if (firstPt[targetCol] === undefined) {
                if (trace.mapping && trace.mapping[col]) {
                    targetCol = trace.mapping[col];
                }
            }
            if (firstPt[targetCol] === undefined) return;

            const isActive = trace.id === appState.activeTraceId;
            const seriesName = visibleTraces.length > 1 ? `[${trace.name}] ${col}` : col;

            const seriesData = [];
            for (let k = 0; k < trace.processedData.length; k++) {
                const pt = trace.processedData[k];
                const xVal = pt[xAxisKey];
                const yVal = pt[targetCol];
                if (xVal != null && yVal != null && !isNaN(xVal) && !isNaN(yVal)) {
                    seriesData.push([xVal, yVal]);
                }
            }

            let lineColor;
            let lineType;
            let lineWidth;
            let lineOpacity;

            if (isSingleDataset) {
                lineColor = metricColor;
                lineType = 'solid';
                lineWidth = 2.2;
                lineOpacity = 1.0;
            } else {
                lineColor = trace.hexColor;
                const patterns = [
                    'solid',
                    [8, 4],
                    [2, 4],
                    [12, 4, 3, 4],
                    [4, 4]
                ];
                lineType = patterns[metricIdx % patterns.length];
                const isDotted = metricIdx % patterns.length === 2;
                lineWidth = isActive ? (isDotted ? 3.2 : 2.5) : (isDotted ? 2.4 : 1.8);
                lineOpacity = isActive ? 1.0 : 0.75;
            }

            series.push({
                name: seriesName,
                id: `trace_${trace.id}_${col}`,
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: metricIdx,
                showSymbol: false,
                lineStyle: {
                    color: lineColor,
                    width: lineWidth,
                    type: lineType,
                    opacity: lineOpacity
                },
                itemStyle: {
                    color: lineColor
                },
                data: seriesData,
                markArea: isActive && metricIdx === 0 ? {
                    silent: true,
                    itemStyle: { color: theme.get('--chart-highlight') },
                    data: []
                } : undefined
            });
        });
    });

    // --- CONTEXT TRACE (Grid 1) ---
    yAxisConfig.push({
        type: 'value',
        gridIndex: 1,
        show: false
    });

    const contextCol = appState.activeContextTrace;
    const contextTrace = (typeof getContextTrace === 'function') ? getContextTrace() : getActiveTrace();
    if (contextCol && contextCol !== 'none' && contextTrace && contextTrace.processedData && contextTrace.processedData.length) {
        let targetContextCol = contextCol;
        const firstPt = contextTrace.processedData[0];
        if (firstPt && firstPt[targetContextCol] === undefined && contextTrace.mapping && contextTrace.mapping[contextCol]) {
            targetContextCol = contextTrace.mapping[contextCol];
        }

        const contextData = [];
        if (firstPt && firstPt[targetContextCol] !== undefined) {
            for (let k = 0; k < contextTrace.processedData.length; k++) {
                const pt = contextTrace.processedData[k];
                const xVal = pt[xAxisKey];
                const yVal = pt[targetContextCol];
                if (xVal != null && yVal != null && !isNaN(xVal) && !isNaN(yVal)) {
                    contextData.push([xVal, yVal]);
                }
            }
        }

        series.push({
            id: 'context-trace',
            name: `[${contextTrace.name}] ${contextCol}`,
            type: 'line',
            xAxisIndex: 1,
            yAxisIndex: yAxisConfig.length - 1,
            showSymbol: false,
            data: contextData,
            lineStyle: { color: contextTrace.hexColor, width: 1.2 },
            itemStyle: { color: contextTrace.hexColor, opacity: 0.6 },
            silent: true,
            markArea: {
                silent: true,
                itemStyle: { color: theme.get('--chart-highlight') },
                data: []
            }
        });
    }

    return {
        config: yAxisConfig,
        series: series
    };
}

function buildTooltip() {
    return {
        trigger: 'axis',
        axisPointer: {
            type: 'cross',
            snap: false,
            label: { show: false },
            lineStyle: { color: theme.get('--border-strong'), type: 'dashed' },
            crossStyle: { color: theme.get('--border-strong'), type: 'dashed' },
            animation: false
        },
        transitionDuration: 0.0,
        backgroundColor: theme.get('--bg-surface'),
        borderColor: theme.get('--border-strong'),
        padding: 10,
        textStyle: { color: theme.get('--text-main'), fontSize: 12 },
        confine: true,

        position: function (pos, params, dom, rect, size) {
            const x = pos[0];
            const y = pos[1];
            const w = size.contentSize[0];
            const h = size.contentSize[1];

            let finalX = x + 15;
            let finalY = y + 15;

            if (finalX + w > size.viewSize[0] - 75) finalX = x - w - 15;
            if (finalY + h > size.viewSize[1]) finalY = y - h - 15;

            return [finalX, finalY];
        },

        formatter: (params) => {
            if (!params || params.length === 0) return '';

            let xVal = null;
            const validParam = params.find(p => p.seriesId !== 'context-trace' && p.value && !isNaN(p.value[0])) ||
                               params.find(p => p.axisValue != null && !isNaN(p.axisValue));

            if (validParam) {
                xVal = (validParam.value && !isNaN(validParam.value[0])) ? validParam.value[0] : Number(validParam.axisValue);
            }
            if (xVal == null || isNaN(xVal)) return '';

            const visibleTraces = getVisibleTraces();
            const metrics = appState.activeChartTraces || [];
            if (!visibleTraces.length || !metrics.length) return '';

            let xAxisKey = '_timeSec';
            if (appState.xAxisMode === 'distance') xAxisKey = '_distKm';
            else if (appState.xAxisMode === 'absTime') xAxisKey = '_absTime';

            // Sort so active trace is on top
            const sortedTraces = [...visibleTraces].sort((a, b) => {
                if (a.id === appState.activeTraceId) return -1;
                if (b.id === appState.activeTraceId) return 1;
                return 0;
            });

            const rows = [];
            const mouseY = appState.chartMouseY || 0;

            metrics.forEach((metricCol, metricIdx) => {
                sortedTraces.forEach(trace => {
                    if (!trace.processedData || !trace.processedData.length) return;
                    const idx = findNearestIndexInTrace(trace.processedData, xAxisKey, xVal);
                    const pt = trace.processedData[idx];
                    if (!pt) return;

                    let targetCol = metricCol;
                    if (pt[targetCol] === undefined && trace.mapping && trace.mapping[metricCol]) {
                        targetCol = trace.mapping[metricCol];
                    }
                    if (pt[targetCol] === undefined) return;

                    const val = pt[targetCol];
                    let valStr = '--';
                    try { valStr = formatMagnitude(val, 4); } catch (e) {}

                    const seriesName = visibleTraces.length > 1 ? `[${trace.name}] ${metricCol}` : metricCol;

                    let pixelY = null;
                    try {
                        const pixelPos = chart.convertToPixel({ yAxisIndex: metricIdx, gridIndex: 0 }, [xVal, val]);
                        if (pixelPos) pixelY = pixelPos[1];
                    } catch (e) {}

                    const isSingleDataset = visibleTraces.length <= 1;
                    const metricColor = METRIC_PALETTE[metricIdx % METRIC_PALETTE.length];
                    const bulletColor = isSingleDataset ? metricColor : trace.hexColor;

                    rows.push({
                        seriesName,
                        color: trace.hexColor,
                        color: bulletColor,
                        valStr,
                        pixelY
                    });
                });
            });

            if (rows.length === 0) return '';

            let closestIndex = 0;
            let minDiff = Infinity;
            rows.forEach((r, idx) => {
                if (r.pixelY != null) {
                    const diff = Math.abs(r.pixelY - mouseY);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closestIndex = idx;
                    }
                }
            });

            let content = `<div style="font-size:11px; color:#aaa; margin-bottom:4px; font-weight:bold;">${formatXAxisValue(xVal)}</div>`;
            content += '<table style="width:100%; border-collapse:collapse;">';

            rows.forEach((r, i) => {
                const isClosest = (i === closestIndex);
                const style = isClosest ?
                    'font-weight:bold; color:#fff; font-size:13px;' :
                    'color:#ccc; font-size:12px;';

                content += `
                <tr style="${style}">
                    <td style="padding-right:15px; padding-top:2px; padding-bottom:2px;">
                        <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${r.color}; margin-right:6px;"></span>
                        ${r.seriesName}
                    </td>
                    <td style="text-align:right; font-family:monospace; padding-left:10px;">${r.valStr}</td>
                </tr>`;
            });

            content += '</table>';
            return content;
        }
    };
}

function renderCharts() {
    if (!chart) return;
    const visibleTraces = getVisibleTraces();
    if (!visibleTraces.length || !appState.activeChartTraces || !appState.activeChartTraces.length) {
        chart.clear();
        const badge = document.getElementById('context-trace-badge');
        if (badge) badge.style.display = 'none';
        return;
    }

    const layout = buildChartLayout(appState.xAxisMode, appState.activeChartTraces.length);
    const yTraces = buildTraces(appState.xAxisMode, null);

    const option = {
        backgroundColor: 'transparent',
        tooltip: buildTooltip(),
        grid: layout.gridConfig,
        xAxis: layout.xAxisConfig,
        yAxis: yTraces.config,
        series: yTraces.series,
        dataZoom: layout.dataZoom
    };
    chart.setOption(option, true);

    // Update Context Trace floating badge
    const badge = document.getElementById('context-trace-badge');
    if (badge) {
        const contextTrace = (typeof getContextTrace === 'function') ? getContextTrace() : getActiveTrace();
        if (appState.activeContextTrace && appState.activeContextTrace !== 'none' && contextTrace) {
            badge.style.display = 'inline-flex';
            badge.innerHTML = `<span class="badge-dot" style="background-color: ${contextTrace.hexColor}"></span><span class="badge-name">[${contextTrace.name}]</span> <span>${appState.activeContextTrace}</span>`;
        } else {
            badge.style.display = 'none';
        }
    }
}

function updateChartHighlight() {
    const active = getActiveTrace();
    if (!active || !active.processedData || !active.processedData.length || !chart) return;

    if (mapOverlayTimer) return;

    mapOverlayTimer = setTimeout(() => {
        const container = typeof map !== 'undefined' && map ? map.getContainer() : null;
        if (!container) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        const xAxisKey = appState.xAxisMode === 'distance' ? '_distKm' : (appState.xAxisMode === 'absTime' ? '_absTime' : '_timeSec');

        const effectiveScale = appState.effectiveScale || 1;
        const viewport = getCurrentViewport();

        const ranges = [];
        let inRegion = false;
        let startVal = null;
        let lastVal = null;

        const targetSamples = 3000;
        const step = Math.max(1, Math.floor(active.processedData.length / targetSamples));

        for (let i = 0; i < active.processedData.length; i += step) {
            const pt = active.processedData[i];
            const screenPos = viewport.project([pt._lon, pt._lat, (pt._renderAlt || 0) * effectiveScale]);

            const isInside = screenPos &&
                screenPos[0] >= 0 &&
                screenPos[0] <= w &&
                screenPos[1] >= 0 &&
                screenPos[1] <= h;

            if (isInside) {
                if (!inRegion) {
                    inRegion = true;
                    startVal = pt[xAxisKey];
                }
                lastVal = pt[xAxisKey];
            } else if (inRegion) {
                if (startVal != null && lastVal != null) {
                    ranges.push([{ xAxis: startVal }, { xAxis: lastVal }]);
                }
                inRegion = false;
            }
        }

        if (inRegion && startVal != null && lastVal != null) {
            ranges.push([{ xAxis: startVal }, { xAxis: lastVal }]);
        }

        if (appState.activeChartTraces && appState.activeChartTraces.length > 0) {
            const currentOption = chart.getOption();
            if (currentOption && currentOption.series && currentOption.series.length > 0) {
                const seriesUpdates = [
                    { seriesIndex: 0, markArea: { data: ranges } }
                ];
                const hasContext = currentOption.series.some(s => s.id === 'context-trace');
                if (hasContext) {
                    seriesUpdates.push({ id: 'context-trace', markArea: { data: ranges } });
                }
                chart.setOption({ series: seriesUpdates });
            }
        }

        mapOverlayTimer = null;
    }, 20);
}

function findNearestIndexByDistance(targetDist) {
    const active = getActiveTrace();
    const data = active?.processedData || [];
    if (!data.length) return 0;
    let left = 0, right = data.length - 1;
    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        if (data[mid]._distKm < targetDist) left = mid + 1;
        else right = mid - 1;
    }
    if (left >= data.length) return data.length - 1;
    if (left <= 0) return 0;
    const d1 = Math.abs(data[left]._distKm - targetDist);
    const d2 = Math.abs(data[left - 1]._distKm - targetDist);
    return d1 < d2 ? left : left - 1;
}

