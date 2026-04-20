// chart.js

const theme = {
    get: (varName) => getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
};

let mapOverlayTimer = null;

function initializeChart() {
    chart = echarts.init(document.getElementById('chart'));
    initializeChartListeners();
}

function initializeChartListeners() {
    chart.getZr().on('mousemove', (params) => {
        appState.chartMouseY = params.offsetY;

        const pointInPixel = [params.offsetX, params.offsetY];

        // Check specifically against the main grid
        if (chart.containPixel({ gridIndex: 0 }, pointInPixel)) {
            // Use the working gridIndex method
            const logicalCoords = chart.convertFromPixel({ gridIndex: 0 }, pointInPixel);

            // Safety check to ensure the math succeeded
            if (logicalCoords && !isNaN(logicalCoords[0])) {
                const xVal = logicalCoords[0];

                const idx = appState.xAxisMode === 'distance' ?
                    findNearestIndexByDistance(xVal) :
                    appState.processedData.findIndex(d => d._timeSec >= xVal);

                if (idx !== -1 && appState.hoverIndex !== idx) {
                    JumpEvent.jumpToTime(Math.max(0, idx), false);
                }
            }
        }
    });


    chart.off('dataZoom');

    chart.on('dataZoom', (params) => {
        if (appState.isUpdating) return;
        const batch = params.batch ? params.batch[0] : params;

        // ECharts slider startValue/endValue often correspond to the index
        // in the data array if the axis is set up linearly.
        if (batch.startValue !== undefined) {
            appState.chartViewRange = [Math.floor(batch.startValue), Math.ceil(batch.endValue)];
        } else {
            // Fallback for percentage-based zooms
            const total = appState.processedData.length - 1;
            appState.chartViewRange = [
                Math.floor((batch.start / 100) * total),
                Math.floor((batch.end / 100) * total)
            ];
        }

        renderMapLayers();
    });
}

function formatXAxisValue(val) {
    return appState.xAxisMode === 'distance' ? formatDistance(val) : formatTime(val);
}

function buildChartLayout(xAxisMode, traceCount) {
    // --- LAYOUT VARIABLES ---
    const leftMargin = 40;
    let rightMarginMain = 30;
    const rightMarginContext = rightMarginMain;
    if (traceCount === 2) {
        rightMarginMain = 40;
    } else if (traceCount > 2) {
        rightMarginMain = (traceCount - 1) * 35;
    }
    const topMargin = 5;        // % from top of container
    const mainHeight = 75;      // % height of the main chart
    const gap = 5;             // % empty space for X-axis labels (Increase this if overlap persists)
    const contextHeight = 10;   // % height of the bottom mini-chart

    // Calculated Positions (Do not edit manually)
    const mainGridTopStr = `${topMargin}%`;
    const mainGridHeightStr = `${mainHeight}%`;
    const contextGridTopStr = `${topMargin + mainHeight + gap}%`; // Automatically pushes down
    const contextGridHeightStr = `${contextHeight}%`;
    // -------------------------------------

    // --- 1. SETUP GRIDS & AXES ---
    const gridConfig = [
        // Grid 0: Main View (Uses variables)
        {
            left: leftMargin,
            right: rightMarginMain,
            top: mainGridTopStr,
            height: mainGridHeightStr,
            containLabel: true

        },
        // Grid 1: Context Strip (Uses calculated variables)
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
            // name: appState.xAxisMode === 'distance' ? 'Distance (km)' : 'Time',
            nameLocation: 'middle',
            nameGap: 35,
            axisLabel: { formatter: formatXAxisValue, color: '#aaa' },
            splitLine: { show: false },
            min: 'dataMin',
            max: 'dataMax'
        },
        { // Contact chart
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
    }
}

function buildTraces(xAxisMode, data) {
    const yAxisConfig = [];
    const series = [];
    const xAxisKey = appState.xAxisMode === 'distance' ? '_distKm' : '_timeSec';

    const textMuted = theme.get('--text-muted');
    const textMain = theme.get('--text-main');

    appState.activeChartTraces.forEach((col, i) => {
        yAxisConfig.push({
            type: 'value',
            gridIndex: 0,
            name: col,
            nameLocation: 'middle',
            nameGap: 35,
            position: i === 0 ? 'left' : 'right',
            offset: i > 1 ? (i - 1) * 60: 0,
            splitLine: { show: false },
            axisLine: { show: true, lineStyle: { color: theme.get('--panel-border') } },
            axisLabel: {
                color: textMain,
                formatter: (val) => {
                    try { return formatMagnitude(val, 3); } catch (e) { return val; }
                }
            },
            nameTextStyle: { color: textMuted, fontSize: 11 },
        });

        series.push({
            name: col,
            type: 'line',
            xAxisIndex: 0,
            yAxisIndex: i,
            showSymbol: false,
            data: appState.processedData.map(d => [d[xAxisKey], d[col]]),
            markArea: {
                silent: true,
                itemStyle: { color: theme.get('--chart-highlight') },
                data: []
            }
        });
    });

    // --- GENERATE CONTEXT TRACE ---
    yAxisConfig.push({
        type: 'value',
        gridIndex: 1,
        show: false
    });

    const contextCol = appState.activeContextTrace;
    series.push({
        id: 'context-trace',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: yAxisConfig.length - 1,
        showSymbol: false,
        data: appState.processedData.map(d => [d[xAxisKey], d[contextCol]]),
        lineStyle: { color: textMuted, width: 1 },
        itemStyle: { opacity: 0.5 },
        silent: true,
        markArea: {
            silent: true,
            itemStyle: { color: theme.get('--chart-highlight')},
            data: []
        }
    });

    return {
        config: yAxisConfig,
        series: series
    }
}

function buildTooltip() {
    return {
        trigger: 'axis',
        // Snap to the X interval, but let the crosshair follow the mouse freely
        axisPointer: {
            type: 'cross',
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

        // 1. Follow the Mouse (Grafana Style)
        position: function (pos, params, dom, rect, size) {
            const x = pos[0];
            const y = pos[1];
            const w = size.contentSize[0];
            const h = size.contentSize[1];

            // Default: bottom-right of cursor
            let finalX = x + 15;
            let finalY = y + 15;

            // Flip if near edges
            if (finalX + w > size.viewSize[0] - 75) finalX = x - w - 15; // Flip early to not cover right Y axis
            if (finalY + h > size.viewSize[1]) finalY = y - h - 15;

            return [finalX, finalY];
        },

        formatter: (params) => {
            if (!params || params.length === 0) return '';

            const xVal = params[0].value[0];

            // --- BOLDING LOGIC ---
            // 1. Calculate pixel distance for every point
            let closestIndex = -1;
            let minDiff = Infinity;
            const mouseY = appState.chartMouseY || 0;

            params.forEach((p, i) => {
                if (p.seriesId === 'context-trace') return;

                // Convert data point (X, Y) to Screen Pixels (X, Y)
                // We need the seriesIndex to know which Y-axis to use
                const pixelPos = chart.convertToPixel({ seriesIndex: p.seriesIndex }, [p.value[0], p.value[1]]);

                if (pixelPos) {
                    const diff = Math.abs(pixelPos[1] - mouseY);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closestIndex = i;
                    }
                }
            });

            // --- GENERATE HTML ---
            let content = `<div style="font-size:11px; color:#aaa; margin-bottom:4px;">${formatXAxisValue(xVal)}</div>`;
            content += '<table style="width:100%; border-collapse:collapse;">';

            params.forEach((p, i) => {
                if (p.seriesId === 'context-trace') return;

                const isClosest = (i === closestIndex);
                const style = isClosest ?
                    'font-weight:bold; color:#fff; font-size:13px;' :
                    'color:#ccc; font-size:12px;';

                const val = p.value[1];
                let valStr = '--';
                try { valStr = formatMagnitude(val, 4); } catch(e) {}

                content += `
                <tr style="${style}">
                    <td style="padding-right:15px;">
                        <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${p.color}; margin-right:5px;"></span>
                        ${p.seriesName}
                    </td>
                    <td style="text-align:right; font-family:monospace;">${valStr}</td>
                </tr>`;
            });

            content += '</table>';
            return content;
        }
    }
}

function renderCharts() {
    if (!appState.processedData.length || appState.activeChartTraces.length === 0) {
        chart.clear();
        return;
    }

    const layout = buildChartLayout(appState.xAxisMode, appState.activeChartTraces.length);
    const yTraces = buildTraces(appState.xAxisMode, appState.processedData);

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
}

function updateChartHighlight() {
    if (appState.isUpdating || !appState.processedData.length) return;

        if (mapOverlayTimer) return;

        mapOverlayTimer = setTimeout(() => {
            const container = map.getContainer();
            const w = container.clientWidth;
            const h = container.clientHeight;
            const xAxisKey = appState.xAxisMode === 'distance' ? '_distKm' : '_timeSec';

            const effectiveScale = appState.effectiveScale;
            const viewport = getCurrentViewport();

            const ranges = [];
            let inRegion = false;
            let startVal = null;
            let lastVal = null;

            // FIX: Dynamic striding. Cap the loop to ~300 iterations to save CPU,
            // scaling the step size based on the total dataset length.
            const targetSamples = 3000;
            const step = Math.max(1, Math.floor(appState.processedData.length / targetSamples));

            // Iterate using the step value instead of i++
            for (let i = 0; i < appState.processedData.length; i += step) {
                const pt = appState.processedData[i];

                // Project the 3D coordinate (maintaining your high-altitude accuracy)
                const screenPos = viewport.project([pt._lon, pt._lat, pt._alt * effectiveScale]);

                // Strict Screen Check
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
                    ranges.push([{ xAxis: startVal }, { xAxis: lastVal }]);
                    inRegion = false;
                }
            }

            // Catch the end if the last point evaluated was inside
            if (inRegion) {
                ranges.push([{ xAxis: startVal }, { xAxis: lastVal }]);
            }

            // Apply to charts
            if (appState.activeChartTraces.length > 0) {
                chart.setOption({
                    series: [
                        { seriesIndex: 0, markArea: { data: ranges } },
                        { id: 'context-trace', markArea: { data: ranges } }
                    ]
                });
            }

            mapOverlayTimer = null;
        }, 20);
}

// Why is this so different from the time index search?
function findNearestIndexByDistance(targetDist) {
    const data = appState.processedData;
    let left = 0, right = data.length - 1;
    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        if (data[mid]._distKm < targetDist) left = mid + 1;
        else right = mid - 1;
    }
    // Check neighbors to find closest
    if (left >= data.length) return data.length - 1;
    if (left <= 0) return 0;
    const d1 = Math.abs(data[left]._distKm - targetDist);
    const d2 = Math.abs(data[left-1]._distKm - targetDist);
    return d1 < d2 ? left : left - 1;
}

