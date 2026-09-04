// share.js
let currentShareUrl = '';

// Close QR modal when clicking outside the card on the dialog backdrop
document.addEventListener('DOMContentLoaded', () => {
    const dialog = document.getElementById('qr-dialog');
    if (dialog) {
        dialog.addEventListener('click', (e) => {
            const rect = dialog.getBoundingClientRect();
            const isInDialog = (rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
                rect.left <= e.clientX && e.clientX <= rect.left + rect.width);
            if (!isInDialog) {
                dialog.close();
            }
        });
    }
});

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
    currentShareUrl = shareUrl;

    // Output to UI / modal
    const modalUrlInput = document.getElementById('qr-dialog-url');
    if (modalUrlInput) modalUrlInput.value = shareUrl;

    // Update share status indicator
    try {
        const statusEl = document.getElementById('share-status');
        if (statusEl) {
            const urlLen = shareUrl.length;
            const compressedLen = compressed.length;
            let cls = 'status-good';
            let msg = `Compressed: ${compressedLen} chars · URL: ${urlLen} chars.`;

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
    return shareUrl;
}

function copyShareURL() {
    if (!currentShareUrl) {
        generateShareURLFromUI();
    }
    if (!currentShareUrl) return;

    const copyBtn = document.getElementById('btn-copy-share-url');
    try {
        navigator.clipboard.writeText(currentShareUrl).then(() => {
            if (copyBtn) {
                const old = copyBtn.innerText;
                copyBtn.innerText = 'Copied!';
                setTimeout(() => { copyBtn.innerText = old; }, 1200);
            }
        }).catch(err => {
            console.warn('Clipboard write failed, attempting prompt fallback', err);
            prompt('Copy share URL:', currentShareUrl);
        });
    } catch (e) {
        console.warn('Clipboard copy failed', e);
        prompt('Copy share URL:', currentShareUrl);
    }
}

function generateQRPayloadUrl() {
    if (!appState.processedData || !appState.processedData.length) return null;

    // If current share URL already fits in a QR code (<= 2000 chars), use it directly!
    if (currentShareUrl && currentShareUrl.length <= 2000) {
        return { url: currentShareUrl, isOptimized: false };
    }

    // Otherwise generate a QR-optimized track (~60 points of mapped telemetry columns)
    const mappedCols = Object.values(appState.mapping || {});
    const headers = mappedCols.length > 0 ? mappedCols : appState.headers.slice(0, 4);
    const targetPoints = 60;
    const step = Math.max(1, Math.ceil(appState.processedData.length / targetPoints));

    const rows = [];
    for (let i = 0; i < appState.processedData.length; i += step) {
        const pt = appState.processedData[i];
        rows.push(headers.map(h => {
            let v = pt[h];
            if (typeof v === 'number') {
                if (h === appState.mapping.lat || h === appState.mapping.lon) return Math.round(v * 1e5) / 1e5;
                if (h === appState.mapping.alt) return Math.round(v * 10) / 10;
                if (h === appState.mapping.time) return Math.round(v);
            }
            return v;
        }));
    }

    const payload = { headers, units: appState.units || {}, rows };
    const jsonString = JSON.stringify(payload);
    const compressed = LZString.compressToEncodedURIComponent(jsonString);
    const baseUrl = window.location.href.split('#')[0];
    return {
        url: `${baseUrl}#share=l:${compressed}`,
        isOptimized: true,
        points: rows.length
    };
}

function openQRModal() {
    if (!appState.processedData || !appState.processedData.length) {
        alert('Please load data before sharing via QR code.');
        return;
    }

    if (!currentShareUrl) {
        generateShareURLFromUI();
    }

    const qrData = generateQRPayloadUrl();
    if (!qrData) return;

    const dialog = document.getElementById('qr-dialog');
    const container = document.getElementById('qr-code-modal-container');
    const urlInput = document.getElementById('qr-dialog-url');
    const statusEl = document.getElementById('qr-modal-status');

    if (!dialog || !container) return;

    if (urlInput) urlInput.value = qrData.url;
    if (statusEl) {
        statusEl.textContent = qrData.isOptimized
            ? `QR code generated (${qrData.points} points optimized for camera scanning).`
            : 'Scan with mobile camera or copy image.';
    }

    container.innerHTML = '';
    try {
        new QRCode(container, {
            text: qrData.url,
            width: 300,
            height: 300,
            correctLevel: QRCode.CorrectLevel.L
        });
    } catch (err) {
        console.error('Failed to generate modal QR:', err);
        container.textContent = 'Unable to generate QR code for this payload.';
    }

    dialog.showModal();
}

function closeQRModal() {
    const dialog = document.getElementById('qr-dialog');
    if (dialog && dialog.open) {
        dialog.close();
    }
}

function copyShareURLFromModal() {
    const urlInput = document.getElementById('qr-dialog-url');
    const url = (urlInput && urlInput.value) || currentShareUrl;
    if (!url) return;

    const btn = document.getElementById('btn-copy-modal-url');
    navigator.clipboard.writeText(url).then(() => {
        if (btn) {
            const old = btn.innerText;
            btn.innerText = 'Copied!';
            setTimeout(() => { btn.innerText = old; }, 1200);
        }
    }).catch(err => {
        console.warn('Modal URL copy failed', err);
        if (urlInput) urlInput.select();
    });
}

function downloadQRCode() {
    const container = document.getElementById('qr-code-modal-container');
    if (!container) return;

    const canvas = container.querySelector('canvas');
    const img = container.querySelector('img');
    let dataUrl = null;

    if (canvas) {
        dataUrl = canvas.toDataURL('image/png');
    } else if (img && img.src) {
        dataUrl = img.src;
    }

    if (!dataUrl) {
        const statusEl = document.getElementById('qr-modal-status');
        if (statusEl) statusEl.textContent = 'QR image not ready to download.';
        return;
    }

    const a = document.createElement('a');
    a.download = 'locus-share-qr.png';
    a.href = dataUrl;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    const statusEl = document.getElementById('qr-modal-status');
    if (statusEl) statusEl.textContent = 'QR code downloaded!';
}

function copyQRCodeImage() {
    const container = document.getElementById('qr-code-modal-container');
    const statusEl = document.getElementById('qr-modal-status');
    if (!container) return;

    const canvas = container.querySelector('canvas');
    if (!canvas) {
        if (statusEl) statusEl.textContent = 'Canvas not available to copy.';
        return;
    }

    canvas.toBlob(blob => {
        if (!blob) {
            if (statusEl) statusEl.textContent = 'Failed to generate QR image blob.';
            return;
        }
        if (!navigator.clipboard || !navigator.clipboard.write) {
            if (statusEl) statusEl.textContent = 'Clipboard image copying not supported on this browser.';
            return;
        }

        navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
        ]).then(() => {
            if (statusEl) statusEl.textContent = 'QR image copied to clipboard!';
            const btn = document.getElementById('btn-copy-qr-img');
            if (btn) {
                const old = btn.innerText;
                btn.innerText = 'Copied!';
                setTimeout(() => { btn.innerText = old; }, 1200);
            }
        }).catch(err => {
            console.warn('Failed to copy QR image:', err);
            if (statusEl) statusEl.textContent = 'Could not copy image to clipboard.';
        });
    });
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
            // mark the pivot point as kept
            keep[index] = 1;
            recurse(startIdx, index);
            recurse(index, endIdx);
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