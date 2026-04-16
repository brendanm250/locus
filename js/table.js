function renderTable(data, headers) {
    const tbody = document.getElementById('table-body');
    document.getElementById('table-header').innerHTML = headers.map(h => `<th>${h}</th>`).join(''); tbody.innerHTML = '';
    const limit = Math.min(data.length, 500);
    for(let i=0; i<limit; i++) {
        const row = document.createElement('tr');
        row.id = `row-${i}`;
        row.onclick = () => JumpEvent.jumpToTime(i, true);
        headers.forEach(h => {
            const td = document.createElement('td');
            let val = data[i][h];
            if (typeof val === 'number' && !Number.isInteger(val)) {
                val = val.toFixed(4);
            }
            td.innerText = val;
            row.appendChild(td);
        });
        tbody.appendChild(row);
    }
}

const highlightTableRow = (function() {
    let lastHighlightedRow = null;
    const tablePanel = document.getElementById('table-panel'); // Cache the container ref

    return function(index) {
        // --- VISIBILITY GUARD ---
        // If the table isn't flex (visible), don't waste cycles on DOM manipulation
        if (tablePanel.style.display !== 'flex') return;

        // 1. O(1) removal
        if (lastHighlightedRow) {
            lastHighlightedRow.classList.remove('active-row');
        }

        // 2. Direct lookup
        const newRow = document.getElementById(`row-${index}`);
        if (newRow) {
            newRow.classList.add('active-row');

            // 3. Scroll into view
            newRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

            lastHighlightedRow = newRow;
        }
    };
})();