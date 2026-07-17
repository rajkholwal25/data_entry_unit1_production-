/**
 * Standalone page — Update batch width / length by production order.
 */
(function initBatchDimensionsBackfill() {
    const poInput = document.getElementById('batch-dims-po-input');
    const loadBtn = document.getElementById('batch-dims-load-btn');
    const statusEl = document.getElementById('batch-dims-status');
    const tableWrap = document.getElementById('batch-dims-table-wrap');
    const syncSapCb = document.getElementById('batch-dims-sync-sap');

    if (!poInput || !tableWrap) return;

    const API_ROOT = (window.location.protocol === 'file:' || !window.location.host)
        ? null
        : `${window.location.protocol}//${window.location.host}`;

    let currentPo = '';
    let batches = [];

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    async function fetchJson(path, options = {}) {
        if (!API_ROOT) throw new Error('Open this app through the server URL.');
        const resp = await fetch(`${API_ROOT}${path}`, options);
        const json = await resp.json();
        if (!resp.ok) throw new Error(json.message || json.error || `HTTP ${resp.status}`);
        return json;
    }

    function setStatus(msg, isError) {
        if (!statusEl) return;
        statusEl.textContent = msg || '';
        statusEl.className = 'batch-dims-status' + (isError ? ' batch-dims-status-error' : '');
    }

    function renderTable() {
        if (!batches.length) {
            tableWrap.innerHTML = '<p class="home-label-placeholder">No output batches found for this production order.</p>';
            return;
        }
        tableWrap.innerHTML = `<table class="batch-dims-table">
            <thead>
                <tr>
                    <th>Output batch</th>
                    <th>Item</th>
                    <th style="text-align:right">Qty</th>
                    <th>Width (mm)</th>
                    <th>Length (m)</th>
                    <th>Status</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                ${batches.map((b, idx) => {
                    const batch = b.outputBatch || '';
                    const has = Number(b.uWidth) > 0 && Number(b.uLength) > 0;
                    const wVal = Number(b.uWidth) > 0 ? b.uWidth : '';
                    const lVal = Number(b.uLength) > 0 ? b.uLength : '';
                    return `<tr data-idx="${idx}">
                        <td class="batch-dims-batch">${esc(batch)}</td>
                        <td>${esc(b.itemCode || '—')}</td>
                        <td style="text-align:right">${b.quantity != null ? b.quantity : '—'}</td>
                        <td><input type="number" class="batch-dims-w" min="0.01" step="any" value="${esc(wVal)}" placeholder="mm" /></td>
                        <td><input type="number" class="batch-dims-l" min="0.01" step="any" value="${esc(lVal)}" placeholder="m" /></td>
                        <td class="batch-dims-row-status">${has
                            ? '<span class="batch-dims-ok">Saved</span>'
                            : '<span class="batch-dims-missing">Missing</span>'}</td>
                        <td><button type="button" class="trace-btn-primary batch-dims-save-row">Save</button></td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>`;

        tableWrap.querySelectorAll('.batch-dims-save-row').forEach((btn) => {
            btn.addEventListener('click', () => {
                const tr = btn.closest('tr');
                const idx = Number(tr?.dataset.idx);
                if (Number.isFinite(idx)) saveRow(idx, tr);
            });
        });
    }

    async function saveRow(idx, tr) {
        const b = batches[idx];
        if (!b || !currentPo) return;
        const width = parseFloat(tr.querySelector('.batch-dims-w')?.value);
        const length = parseFloat(tr.querySelector('.batch-dims-l')?.value);
        if (!Number.isFinite(width) || width <= 0) {
            alert('Enter width (mm) greater than 0');
            return;
        }
        if (!Number.isFinite(length) || length <= 0) {
            alert('Enter length (m) greater than 0');
            return;
        }
        const statusCell = tr.querySelector('.batch-dims-row-status');
        const saveBtn = tr.querySelector('.batch-dims-save-row');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = '…';
        }
        try {
            const json = await fetchJson(
                `/api/batch-dimensions/${encodeURIComponent(currentPo)}/${encodeURIComponent(b.outputBatch)}`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        width,
                        length,
                        U_Width: width,
                        U_Length: length,
                        syncSap: syncSapCb?.checked !== false
                    })
                }
            );
            if (!json.success) {
                throw new Error(json.sap?.error || json.message || 'Save failed');
            }
            batches[idx].uWidth = width;
            batches[idx].uLength = length;
            batches[idx].hasDimensions = true;
            if (statusCell) {
                const sapNote = json.sap?.skipped
                    ? ' (local only)'
                    : (json.sap?.success ? ' + SAP' : '');
                statusCell.innerHTML = `<span class="batch-dims-ok">Saved${esc(sapNote)}</span>`;
            }
            const dimFmt = (typeof ProcessLabelFormats !== 'undefined' && ProcessLabelFormats.formatBatchDimensions)
                ? ProcessLabelFormats.formatBatchDimensions(width, length)
                : `${width} mm × ${length} m`;
            setStatus(`Saved ${b.outputBatch}: ${dimFmt}`);
        } catch (e) {
            if (statusCell) statusCell.innerHTML = '<span class="batch-dims-missing">Failed</span>';
            alert((syncSapCb?.checked !== false ? 'SAP or save failed: ' : 'Save failed: ') + (e.message || e));
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save';
            }
        }
    }

    async function loadBatches() {
        const po = poInput.value.trim();
        if (!po) {
            setStatus('Enter a production order number.', true);
            poInput.focus();
            return;
        }
        currentPo = po;
        setStatus('Loading batches…');
        tableWrap.innerHTML = '<p class="home-label-placeholder">Loading…</p>';
        try {
            const json = await fetchJson(`/api/batch-dimensions/by-po/${encodeURIComponent(po)}`);
            batches = json.batches || [];
            const missing = json.missingCount ?? 0;
            setStatus(
                missing > 0
                    ? `PO ${po}: ${batches.length} batch(es), ${missing} missing width/length`
                    : `PO ${po}: ${batches.length} batch(es) — all have dimensions`
            );
            renderTable();
        } catch (e) {
            batches = [];
            tableWrap.innerHTML = '';
            setStatus('❌ ' + (e.message || e), true);
        }
    }

    loadBtn?.addEventListener('click', loadBatches);
    poInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadBatches(); });

    window.batchDimensionsRunFromParams = function runFromParams() {
        const po = new URLSearchParams(location.search).get('dimsPo')
            || new URLSearchParams(location.search).get('po')
            || '';
        if (po) {
            poInput.value = po;
            loadBatches();
        } else {
            poInput.focus();
        }
    };
})();
