function generateShareURL() {
    generateShareURLFromUI();
}

function loadSharedData(compressedString) {
    try {
        let parsed = null;
        // Detect prefix: 'p:' => pako, 'l:' => lz
        if (compressedString.startsWith('p:')) {
            const body = compressedString.slice(2);
            const json = decompressWithPako(body);
            parsed = JSON.parse(json);
        } else if (compressedString.startsWith('l:')) {
            const body = compressedString.slice(2);
            const decompressed = LZString.decompressFromEncodedURIComponent(body);
            parsed = JSON.parse(decompressed);
        } else {
            // legacy: assume LZ encoded string
            const decompressed = LZString.decompressFromEncodedURIComponent(compressedString);
            parsed = JSON.parse(decompressed);
        }

        // New schema: { headers: [...], units: {...}, rows: [ [v1,v2,...], ... ] }
        if (parsed && parsed.headers && Array.isArray(parsed.rows)) {
            appState.headers = parsed.headers.slice();
            appState.units = parsed.units || {};

            appState.rawData = parsed.rows.map(rowArr => {
                const row = {};
                for (let i = 0; i < parsed.headers.length; i++) {
                    row[parsed.headers[i]] = rowArr[i];
                }
                return row;
            });

            // Try to auto-map common names
            autoDetectColumns();
            visualizeData(true);
            return;
        }

        // Fallback for old-style shared payloads (array of objects)
        const parsedArray = Array.isArray(parsed) ? parsed : null;
        if (parsedArray) {
            appState.rawData = parsedArray.map(pt => {
                let row = {};
                row['Time'] = pt.t;
                row['Latitude'] = pt.la;
                row['Longitude'] = pt.lo;
                row['Altitude'] = pt.al;
                return row;
            });
            appState.headers = ['Time', 'Latitude', 'Longitude', 'Altitude'];
            appState.mapping = { time: 'Time', lat: 'Latitude', lon: 'Longitude', alt: 'Altitude' };
            visualizeData(true);
            return;
        }

        throw new Error('Unsupported share format');
    } catch (e) {
        console.error('Failed to load shared data:', e);
        alert('The shared link is invalid or corrupted.');
    }
}

function generateShareURLFromUI() {
    // Read options from DOM
    const keepEvery = Math.max(1, parseInt(document.getElementById('share-downsample').value || '10'));
    const select = document.getElementById('share-columns');
    const selected = Array.from(select && select.selectedOptions ? select.selectedOptions : []).map(o => o.value);
    const compressMethod = (document.getElementById('share-compress') && document.getElementById('share-compress').value) || 'lz';
    const simplifyEps = Math.max(0, parseFloat(document.getElementById('share-simplify-eps').value || '0'));
    const reducePrecision = !!document.getElementById('share-reduce-precision') && document.getElementById('share-reduce-precision').checked;

    if (!appState.processedData || appState.processedData.length === 0) {
        alert('No processed data to share.');
        return;
    }

    const headers = selected && selected.length > 0 ? selected.slice() : appState.headers.slice();

    // Decide which indices to include
    let indices = [];
    if (simplifyEps > 0) {
        // Convert coordinates to meters using mean latitude to make epsilon meters intuitive
        const meanLat = appState.processedData.reduce((s, p) => s + p._lat, 0) / appState.processedData.length;
        const meanLatRad = meanLat * Math.PI / 180;
        const metersPerDegLat = 111132.92; // approx
        const metersPerDegLon = 111319.49 * Math.cos(meanLatRad);

        const ptsMeters = appState.processedData.map(pt => [pt._lon * metersPerDegLon, pt._lat * metersPerDegLat]);
        const simplifiedIdx = rdpIndices(ptsMeters, simplifyEps);
        indices = simplifiedIdx.slice();
        // Optionally further decimate the simplified set
        if (keepEvery > 1) indices = indices.filter((_, i) => i % keepEvery === 0);
    } else {
        // Uniform downsample
        for (let i = 0; i < appState.processedData.length; i += keepEvery) indices.push(i);
    }

    // Build rows from chosen indices
    let rows = indices.map(idx => {
        const pt = appState.processedData[idx];
        return headers.map(h => {
            if (pt[h] !== undefined) return pt[h];
            if (h === appState.mapping.time) return pt[appState.mapping.time];
            if (h === appState.mapping.lat) return pt._lat;
            if (h === appState.mapping.lon) return pt._lon;
            if (h === appState.mapping.alt) return pt._alt;
            return pt[h];
        });
    });

    if (reducePrecision) rows = reducePrecisionRows(headers, rows);

    const payload = { headers, units: appState.units || {}, rows };
    const jsonString = JSON.stringify(payload);

    let compressed = '';
    let prefix = 'l:';
    if (compressMethod === 'pako') {
        compressed = compressWithPako(jsonString);
        prefix = 'p:';
    } else {
        compressed = LZString.compressToEncodedURIComponent(jsonString);
        prefix = 'l:';
    }

    const baseUrl = window.location.href.split('#')[0];
    const shareUrl = `${baseUrl}#share=${prefix}${compressed}`;

    // Output to UI
    const urlInput = document.getElementById('share-url');
    if (urlInput) urlInput.value = shareUrl;

    // Render QR only when payload is reasonably small
    const qrEl = document.getElementById('qr-container');
    if (qrEl) {
        qrEl.innerHTML = '';
        try {
            if (compressed.length < 1200) {
                new QRCode(qrEl, { text: shareUrl, width: 128, height: 128 });
            } else {
                qrEl.textContent = 'Payload too large for QR';
            }
        } catch (e) {
            console.warn('QR generation failed', e);
            qrEl.textContent = 'QR error';
        }
    }

    // Update share status indicator
    try {
        const statusEl = document.getElementById('share-status');
        if (statusEl) {
            const urlLen = shareUrl.length;
            const compressedLen = compressed.length;
            const qrOk = compressedLen < 1200;
            let cls = 'status-good';
            let msg = `Compressed: ${compressedLen} chars · URL: ${urlLen} chars.`;
            if (!qrOk) msg += ' QR: too large.';

            // thresholds
            if (urlLen <= 2000) {
                cls = 'status-good';
                msg += ' URL size: good.';
            } else if (urlLen <= 8000) {
                cls = 'status-warning';
                msg += ' URL size: may be long for some clients.';
            } else {
                cls = 'status-bad';
                msg += ' URL size: very large — consider more downsampling, increasing epsilon, or disabling columns.';
            }

            statusEl.className = cls;
            statusEl.innerText = msg;
        }
    } catch (e) {
        console.warn('Failed to update share status UI', e);
    }

    console.log('Share URL length:', shareUrl.length);
}

function copyShareURL() {
    const urlInput = document.getElementById('share-url');
    if (!urlInput || !urlInput.value) return;
    try {
        navigator.clipboard.writeText(urlInput.value);
        // small visual feedback
        const old = urlInput.value;
        urlInput.value = 'Copied!';
        setTimeout(() => { urlInput.value = old; }, 1200);
    } catch (e) {
        console.warn('Clipboard copy failed', e);
        // fallback: select the input so user can copy manually
        urlInput.select();
        alert('Press Ctrl+C to copy the link');
    }
}

// Pako (gzip) helpers with URL-safe base64
function uint8ToBase64Url(u8) {
    let binary = '';
    for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
    const b64 = btoa(binary);
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToUint8(s) {
    let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    // pad
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
}

function compressWithPako(str) {
    const deflated = pako.deflate(str);
    return uint8ToBase64Url(deflated);
}

function decompressWithPako(b64url) {
    const u8 = base64UrlToUint8(b64url);
    const inflated = pako.inflate(u8, { to: 'string' });
    return inflated;
}

// Geometric simplification: Ramer-Douglas-Peucker on [lon,lat] array
function rdp(points, epsilon) {
    if (points.length < 3) return points.slice();
    const sq = (p, q) => {
        const dx = p[0] - q[0];
        const dy = p[1] - q[1];
        return dx*dx + dy*dy;
    };

    function perpendicularDistance(point, lineStart, lineEnd) {
        const x0 = point[0], y0 = point[1];
        const x1 = lineStart[0], y1 = lineStart[1];
        const x2 = lineEnd[0], y2 = lineEnd[1];
        const num = Math.abs((y2 - y1)*x0 - (x2 - x1)*y0 + x2*y1 - y2*x1);
        const den = Math.hypot(y2 - y1, x2 - x1);
        return den === 0 ? Math.hypot(x0 - x1, y0 - y1) : num / den;
    }

    function recurse(pts) {
        let maxDist = 0;
        let index = -1;
        const start = pts[0];
        const end = pts[pts.length - 1];
        for (let i = 1; i < pts.length - 1; i++) {
            const d = perpendicularDistance(pts[i], start, end);
            if (d > maxDist) { maxDist = d; index = i; }
        }
        if (maxDist > epsilon) {
            const left = recurse(pts.slice(0, index + 1));
            const right = recurse(pts.slice(index));
            return left.slice(0, -1).concat(right);
        } else {
            return [start, end];
        }
    }

    return recurse(points);
}

// Return indices of points to keep after RDP (points are [x,y] in meters)
function rdpIndices(points, epsilon) {
    const n = points.length;
    if (n < 3) return Array.from({length: n}, (_, i) => i);

    function perpendicularDistanceIdx(idx, startIdx, endIdx) {
        const point = points[idx];
        const lineStart = points[startIdx];
        const lineEnd = points[endIdx];
        const x0 = point[0], y0 = point[1];
        const x1 = lineStart[0], y1 = lineStart[1];
        const x2 = lineEnd[0], y2 = lineEnd[1];
        const num = Math.abs((y2 - y1)*x0 - (x2 - x1)*y0 + x2*y1 - y2*x1);
        const den = Math.hypot(y2 - y1, x2 - x1);
        return den === 0 ? Math.hypot(x0 - x1, y0 - y1) : num / den;
    }

    const keep = new Uint8Array(n); // 0/1

    function recurse(startIdx, endIdx) {
        let maxDist = 0;
        let index = -1;
        for (let i = startIdx + 1; i < endIdx; i++) {
            const d = perpendicularDistanceIdx(i, startIdx, endIdx);
            if (d > maxDist) { maxDist = d; index = i; }
        }
        if (maxDist > epsilon && index !== -1) {
            recurse(startIdx, index);
            recurse(index, endIdx);
        } else {
            // nothing to add
        }
    }

    // Always keep endpoints
    keep[0] = 1;
    keep[n-1] = 1;
    recurse(0, n-1);

    // Collect indices in order
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
    return out;
}

function reducePrecisionRows(headers, rows) {
    const latIdx = headers.findIndex(h => /lat/i.test(h));
    const lonIdx = headers.findIndex(h => /lon/i.test(h));
    const altIdx = headers.findIndex(h => /alt/i.test(h));
    const timeIdx = headers.findIndex(h => /time/i.test(h));

    return rows.map(r => r.map((v, i) => {
        if (typeof v !== 'number') return v;
        if (i === latIdx || i === lonIdx) return Math.round(v * 1e6) / 1e6;
        if (i === altIdx) return Math.round(v * 10) / 10;
        if (i === timeIdx) return Math.round(v * 1000) / 1000;
        return v;
    }));
}