/**
 * Home page — GRN Roll Labels panel.
 * Sync ALL FBD-RM stock from SAP → raw_material_mirror, then search by batch and print.
 */
(function initGrnRollLabels() {
    const batchInput = document.getElementById('grn-batch-input');
    const searchBtn = document.getElementById('grn-search-btn');
    const syncBtn = document.getElementById('grn-sync-btn');
    const statusEl = document.getElementById('grn-status');
    const listEl = document.getElementById('grn-roll-list');
    const previewHost = document.getElementById('grn-preview-host');
    const actionsEl = document.getElementById('grn-label-actions');
    const statsEl = document.getElementById('grn-mirror-stats');

    if (!batchInput || !listEl || !previewHost) return;

    const API_ROOT = (window.location.protocol === 'file:' || !window.location.host)
        ? null
        : `${window.location.protocol}//${window.location.host}`;

    let pendingLabelData = null;
    let currentRolls = [];

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /** Format sync time as Asia/Kolkata — MySQL DATETIME strings must not be treated as UTC. */
    function fmtDate(d) {
        if (!d) return '—';
        if (typeof d === 'string') {
            const s = d.trim();
            const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
            if (m && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
                const dt = new Date(
                    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
                    Number(m[4]), Number(m[5]), Number(m[6] || 0)
                );
                return isNaN(dt) ? s : dt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
            }
        }
        const dt = d instanceof Date ? d : new Date(d);
        return isNaN(dt) ? '—' : dt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    }

    async function fetchJson(apiPath, options) {
        if (!API_ROOT) {
            throw new Error('Open this app through the server URL (not the HTML file directly).');
        }
        const url = `${API_ROOT}${apiPath.startsWith('/') ? apiPath : '/' + apiPath}`;
        const resp = await fetch(url, options);
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json.message || json.error || `HTTP ${resp.status}`);
        return json;
    }

    function setStatus(msg) {
        if (statusEl) statusEl.textContent = msg || '';
    }

    async function refreshStats() {
        if (!statsEl) return;
        try {
            const json = await fetchJson('/api/grn-rolls/stats');
            const when = json.lastSynced ? fmtDate(json.lastSynced) : 'never';
            statsEl.textContent = `Mirror: ${json.count || 0} roll(s) · last sync ${when}`;
        } catch {
            statsEl.textContent = 'Mirror: unavailable';
        }
    }

    function clearPreview() {
        pendingLabelData = null;
        previewHost.innerHTML = '<p class="home-label-placeholder">Search a batch to preview its GRN label</p>';
        if (actionsEl) actionsEl.innerHTML = '';
    }

    function buildLabelData(roll) {
        if (typeof ProcessLabelFormats === 'undefined' || !ProcessLabelFormats.buildGrnLabelData) {
            return roll;
        }
        return ProcessLabelFormats.buildGrnLabelData(roll);
    }

    function renderPreview(labelData) {
        pendingLabelData = labelData;
        if (typeof ProcessLabelFormats === 'undefined' || !ProcessLabelFormats.generateGrnRollLabelHTML) {
            previewHost.innerHTML = '<p class="home-label-placeholder">Label library not loaded.</p>';
            return;
        }
        previewHost.innerHTML =
            `<div class="trace-label-scale">${ProcessLabelFormats.generateGrnRollLabelHTML(labelData)}</div>`;
        if (actionsEl) {
            actionsEl.innerHTML = `
                <button type="button" class="trace-btn-primary" id="grn-print-device-btn">Print on this device</button>
                <button type="button" class="trace-btn-primary" id="grn-print-server-btn">Send to label printer</button>`;
            document.getElementById('grn-print-device-btn')?.addEventListener('click', printOnDevice);
            document.getElementById('grn-print-server-btn')?.addEventListener('click', sendToPrinter);
        }
    }

    function printOnDevice() {
        if (!pendingLabelData || typeof ProcessLabelFormats === 'undefined') return;
        const container = document.getElementById('trace-label-print-container');
        if (!container) return;
        container.innerHTML = ProcessLabelFormats.generateGrnRollLabelHTML(pendingLabelData);
        container.style.display = 'block';
        window.print();
        setTimeout(() => { container.style.display = 'none'; }, 800);
    }

    async function sendToPrinter() {
        if (!pendingLabelData) return;
        const d = pendingLabelData;
        const batch = d.batchNo || '';
        const ok = confirm(
            `Print this GRN roll label on the network label printer?\n\nRoll No: ${batch}\n\nClick OK to print.`
        );
        if (!ok) return;
        const btn = document.getElementById('grn-print-server-btn');
        if (btn) btn.disabled = true;
        setStatus('Rendering label…');
        try {
            const labelHtml = ProcessLabelFormats.generateGrnRollLabelHTML(d);
            let previewPngBase64 = null;
            if (window.LabelPrintRaster
                && typeof window.LabelPrintRaster.rasterizeLabelHtmlToPngBase64 === 'function') {
                try {
                    previewPngBase64 = await window.LabelPrintRaster.rasterizeLabelHtmlToPngBase64(labelHtml);
                } catch (e) {
                    console.warn('GRN label rasterization failed:', e);
                }
            }
            const res = await fetch(`${API_ROOT}/api/process-print-labels`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    labelData: d,
                    labelHtml,
                    previewPngBase64,
                    numLabels: 1
                })
            });
            const json = await res.json();
            if (!res.ok || !json.success) {
                const errDetail = json.printResult?.errors?.[0]?.error;
                setStatus('❌ Print failed: ' + (errDetail || json.message || json.error || 'Unknown error'));
            } else {
                const printed = json.printResult?.printed ?? 1;
                const total = json.printResult?.total ?? 1;
                setStatus(`✅ Print successful — ${printed}/${total} label(s) (${batch}).`);
            }
        } catch (e) {
            setStatus('❌ Print failed: ' + (e.message || e));
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    function renderRollList(selectedBatch) {
        if (!currentRolls.length) {
            listEl.innerHTML = '<p class="home-label-empty">No matching rolls in mirror.</p>';
            clearPreview();
            return;
        }
        listEl.innerHTML = currentRolls.map((row) => {
            const batch = row.batchNo || '';
            const sel = batch === selectedBatch && row.itemCode === (currentRolls.find((r) => r.batchNo === selectedBatch)?.itemCode)
                ? ' selected'
                : (batch === selectedBatch ? ' selected' : '');
            const dims = (row.width != null || row.length != null)
                ? `${row.width ?? '—'} mm × ${row.length ?? '—'} m`
                : 'no dims';
            return `
                <button type="button" class="home-label-output-row${sel}"
                    data-batch="${esc(batch)}" data-item="${esc(row.itemCode || '')}">
                    <span class="home-label-output-batch">${esc(batch)}</span>
                    <span class="home-label-output-meta">
                        ${esc(row.itemCode || '—')} · ${esc(row.balanceQty)} KGS · ${esc(dims)}
                        ${row.supplierName ? `<span class="home-label-output-date">${esc(row.supplierName)}</span>` : ''}
                    </span>
                </button>`;
        }).join('');

        listEl.querySelectorAll('.home-label-output-row').forEach((btn) => {
            btn.addEventListener('click', () => selectRoll(btn.dataset.batch, btn.dataset.item));
        });
    }

    function selectRoll(batch, itemCode) {
        const roll = currentRolls.find((r) =>
            r.batchNo === batch && (!itemCode || r.itemCode === itemCode)
        ) || currentRolls.find((r) => r.batchNo === batch);
        if (!roll) return;
        renderRollList(batch);
        const labelData = buildLabelData(roll);
        renderPreview(labelData);
        setStatus(`Roll ${roll.batchNo} · ${roll.itemCode} — ready to print.`);
    }

    async function searchBatch() {
        const batch = batchInput.value.trim();
        if (!batch) {
            setStatus('Enter a batch / roll number.');
            batchInput.focus();
            return;
        }
        setStatus(`Searching mirror for ${batch}…`);
        listEl.innerHTML = '';
        clearPreview();
        currentRolls = [];
        try {
            const json = await fetchJson(`/api/grn-rolls/by-batch/${encodeURIComponent(batch)}`);
            currentRolls = json.rolls || [];
            if (!currentRolls.length) {
                setStatus(`No rolls found for "${batch}".`);
                renderRollList('');
                return;
            }
            setStatus(`Found ${currentRolls.length} roll(s) for "${batch}". Select one to preview.`);
            const first = currentRolls[0];
            renderRollList(first.batchNo);
            selectRoll(first.batchNo, first.itemCode);
        } catch (e) {
            setStatus('❌ ' + (e.message || e));
            listEl.innerHTML = '';
            clearPreview();
        }
    }

    async function syncFromSap() {
        const ok = confirm(
            'Fetch ALL rolls from SAP warehouse FBD-RM and merge into raw_material_mirror?\n\n' +
            '(Existing local rolls are kept even if stock is gone in SAP — no wipe, no duplicates.)\n\n' +
            'Sync runs in chunks so all ~200+ Films rolls are included (not truncated).\n\n' +
            'This may take 1–2 minutes.'
        );
        if (!ok) return;
        if (syncBtn) syncBtn.disabled = true;
        setStatus('Syncing ALL FBD-RM stock from SAP…');
        try {
            const json = await fetchJson('/api/grn-rolls/sync', { method: 'POST' });
            setStatus(`✅ ${json.message || `Synced ${json.inserted} roll(s)`}`);
            await refreshStats();
        } catch (e) {
            setStatus('❌ Sync failed: ' + (e.message || e));
        } finally {
            if (syncBtn) syncBtn.disabled = false;
        }
    }

    searchBtn?.addEventListener('click', searchBatch);
    syncBtn?.addEventListener('click', syncFromSap);
    batchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchBatch(); });

    window.grnRollLabelsOnShow = function onShow() {
        refreshStats();
    };
})();
