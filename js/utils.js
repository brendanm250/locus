// --- UTILS ---

function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function formatMagnitude(val, sigFigs = 3) {
    // 1. Safety Checks (Prevents crashing on null/undefined/NaN)
    if (val === null || val === undefined || isNaN(val)) return '--';

    // 2. Handle Zero explicitly (toPrecision fails on 0)
    if (val === 0) return '0';

    const abs = Math.abs(val);
    let divisor = 1;
    let suffix = '';

    // 3. Determine Magnitude
    if (abs >= 1000000) {
        divisor = 1000000;
        suffix = 'M';
    } else if (abs >= 1000) {
        divisor = 1000;
        suffix = 'k';
    }

    // 4. precise formatting
    const formatted = val / divisor;

    // toPrecision returns a string (e.g. "1.200").
    // parseFloat strips the trailing zeros (e.g. 1.2).
    // Then we append the suffix.
    return parseFloat(formatted.toPrecision(sigFigs)) + suffix;
}

function formatTime(seconds) {
    if (seconds < 60) return seconds.toFixed(1) + 's';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    if (m < 60) return `${m}m ${s}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
}

function formatDistance(km) {
    if (km < 1) return (km * 1000).toFixed(0) + 'm';
    return km.toFixed(2) + 'km';
}

function modifyRGBa(RGBa, lFactor, cFactor, hRotate, aFactor=0) {

    const color = chroma(...RGBa);

    const [l, c, h] = color.oklch();

    let newColor = chroma.oklch(l*(1+lFactor), c*(1+cFactor), h+hRotate).rgb();

    if (RGBa.length === 3 && aFactor === 0) {
        return newColor
    }
    else {
        const alpha = RGBa[3] ? RGBa[3] : 255;
        return [...newColor, alpha*(1+aFactor)];
    }
}