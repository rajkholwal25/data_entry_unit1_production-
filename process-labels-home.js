/**
 * Home page — Process Labels panel (right side).
 * PO search → list all output batches → click row → label preview for that batch only.
 */
(function initHomeProcessLabels() {
    const poInput = document.getElementById('home-label-po-input');
    const searchBtn = document.getElementById('home-label-search-btn');
    const statusEl = document.getElementById('home-label-status');
    const listEl = document.getElementById('home-label-output-list');
    const previewHost = document.getElementById('home-label-preview-host');
    const actionsEl = document.getElementById('home-label-actions');

    if (!poInput || !listEl || !previewHost) return;

    const API_ROOT = (window.location.protocol === 'file:' || !window.location.host)
        ? null
        : `${window.location.protocol}//${window.location.host}`;

    let pendingLabelData = null;
    let currentPo = '';
    let outputRows = [];

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function fmtDate(d) {
        if (!d) return '—';
        const dt = new Date(d);
        return isNaN(dt) ? '—' : dt.toLocaleString('en-IN');
    }

    function batchSeqKey(batch) {
        const m = String(batch || '').match(/-(\d+)$/);
        return m ? parseInt(m[1], 10) : 0;
    }

    async function fetchJson(apiPath) {
        if (!API_ROOT) {
            throw new Error('Open this app through the server URL (not the HTML file directly).');
        }
        const url = `${API_ROOT}${apiPath.startsWith('/') ? apiPath : '/' + apiPath}`;
        const resp = await fetch(url);
        const json = await resp.json();
        if (!resp.ok) throw new Error(json.message || json.error || `HTTP ${resp.status}`);
        return json;
    }

    function buildLabelDataFromApi(raw, po) {
        if (typeof ProcessLabelFormats === 'undefined') return raw;
        return ProcessLabelFormats.buildLabelDataFromFinish({
            job: {
                itemNo: raw.itemCode || raw.fgCode,
                itemCode: raw.itemCode || raw.fgCode,
                jobName: raw.itemDescription || raw.jobName,
                uPCode: raw.uPCode || ''
            },
            machineInfo: { name: raw.machineName, process: raw.processName },
            poNumber: raw.poNumber || po,
            outputBatch: raw.outputBatch || raw.batchNo,
            actualOutput: raw.actualOutput ?? raw.quantity,
            roleUsages: raw.roleUsages || [],
            operator: raw.operator,
            customerName: raw.customerName,
            itemDescription: raw.itemDescription,
            packedOn: raw.packedOn
        });
    }

    function clearPreview() {
        pendingLabelData = null;
        previewHost.innerHTML = '<p class="home-label-placeholder">Select an output batch to preview its label</p>';
        if (actionsEl) actionsEl.innerHTML = '';
    }

    function renderPreview(labelData) {
        pendingLabelData = labelData;
        if (typeof ProcessLabelFormats === 'undefined') {
            previewHost.innerHTML = '<p class="home-label-placeholder">Label library not loaded.</p>';
            return;
        }
        previewHost.innerHTML =
            `<div class="trace-label-scale">${ProcessLabelFormats.generateProcessLabelHTML(labelData)}</div>`;
        if (actionsEl) {
            actionsEl.innerHTML = `
                <button type="button" class="trace-btn-primary" id="home-label-print-device-btn">Print on this device</button>
                <button type="button" class="trace-btn-primary" id="home-label-print-server-btn">Send to label printer</button>`;
            document.getElementById('home-label-print-device-btn')?.addEventListener('click', printOnDevice);
            document.getElementById('home-label-print-server-btn')?.addEventListener('click', sendToPrinter);
        }
    }

    function printOnDevice() {
        if (!pendingLabelData || typeof ProcessLabelFormats === 'undefined') return;
        const container = document.getElementById('trace-label-print-container');
        if (!container) return;
        container.innerHTML = ProcessLabelFormats.generateProcessLabelHTML(pendingLabelData);
        container.style.display = 'block';
        window.print();
        setTimeout(() => { container.style.display = 'none'; }, 800);
    }

    async function sendToPrinter() {
        if (!pendingLabelData) return;
        const d = pendingLabelData;
        const batch = d.batchNo || d.outputBatch || '';
        const ok = confirm(
            `Print this label on the network label printer?\n\nBatch: ${batch}\n\nClick OK to print, or Cancel to go back to preview.`
        );
        if (!ok) return;
        const btn = document.getElementById('home-label-print-server-btn');
        if (btn) btn.disabled = true;
        if (statusEl) statusEl.textContent = 'Rendering label…';
        try {
            const labelHtml = (typeof ProcessLabelFormats !== 'undefined')
                ? ProcessLabelFormats.generateProcessLabelHTML(d)
                : null;
            // WYSIWYG: rasterize the exact on-screen preview (incl. QR) on the client
            // and print that, so the print matches the preview instead of relying on a
            // server re-render (which can drop the QR / drift the layout).
            let previewPngBase64 = null;
            if (labelHtml && window.LabelPrintRaster
                && typeof window.LabelPrintRaster.rasterizeLabelHtmlToPngBase64 === 'function') {
                try {
                    previewPngBase64 = await window.LabelPrintRaster.rasterizeLabelHtmlToPngBase64(labelHtml);
                } catch (e) {
                    console.warn('Label rasterization failed, falling back to server render:', e);
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
                const errMsg = errDetail || json.printResult?.message || json.message || json.error || 'Unknown error';
                if (statusEl) statusEl.textContent = '❌ Print failed: ' + errMsg;
            } else if (statusEl) {
                const printed = json.printResult?.printed ?? 1;
                const total = json.printResult?.total ?? 1;
                statusEl.textContent = `✅ Print successful — ${printed}/${total} label(s) sent to printer (${batch}).`;
            }
        } catch (e) {
            if (statusEl) statusEl.textContent = '❌ Print failed: ' + (e.message || e);
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    function renderOutputList(selectedBatch) {
        if (!outputRows.length) {
            listEl.innerHTML = '<p class="home-label-empty">No output batches saved for this production order yet.</p>';
            clearPreview();
            return;
        }
        listEl.innerHTML = outputRows.map((row) => {
            const batch = row.outputBatch || '';
            const sel = batch === selectedBatch ? ' selected' : '';
            const hasDims = Number(row.uWidth) > 0 && Number(row.uLength) > 0;
            const dimFmt = (typeof ProcessLabelFormats !== 'undefined' && ProcessLabelFormats.formatBatchDimensions)
                ? ProcessLabelFormats.formatBatchDimensions(row.uWidth, row.uLength)
                : `${row.uWidth} mm × ${row.uLength} m`;
            const dimBadge = hasDims
                ? `<span class="home-label-dim-ok">${dimFmt}</span>`
                : '<span class="home-label-dim-miss">no dims</span>';
            return `
                <button type="button" class="home-label-output-row${sel}" data-batch="${esc(batch)}">
                    <span class="home-label-output-batch">${esc(batch)}</span>
                    <span class="home-label-output-meta">
                        ${dimBadge} · ${esc(row.quantity)} KGS · ${esc(row.operator || '—')}
                        ${row.completedAt ? `<span class="home-label-output-date">${esc(fmtDate(row.completedAt))}</span>` : ''}
                    </span>
                </button>`;
        }).join('');

        listEl.querySelectorAll('.home-label-output-row').forEach((btn) => {
            btn.addEventListener('click', () => selectBatch(btn.dataset.batch));
        });
    }

    async function selectBatch(batch) {
        const b = String(batch || '').trim();
        if (!b || !currentPo) return;
        renderOutputList(b);
        if (statusEl) statusEl.textContent = `Loading label for ${b}…`;
        previewHost.innerHTML = '<p class="home-label-placeholder">Loading…</p>';
        if (actionsEl) actionsEl.innerHTML = '';
        try {
            const json = await fetchJson(
                `/api/process-label/by-po/${encodeURIComponent(currentPo)}?batch=${encodeURIComponent(b)}`
            );
            if (!json.success || !json.labelData) throw new Error(json.message || 'No label data');
            const labelData = buildLabelDataFromApi(json.labelData, currentPo);
            renderPreview(labelData);
            if (statusEl) {
                statusEl.textContent = `Production order ${currentPo} · ${b} — ${outputRows.length} output batch(es). Click another row to switch label.`;
            }
        } catch (e) {
            clearPreview();
            if (statusEl) statusEl.textContent = '❌ ' + (e.message || e);
        }
    }

    async function loadPoLabels() {
        const po = poInput.value.trim();
        if (!po) {
            if (statusEl) statusEl.textContent = 'Enter a production order number.';
            poInput.focus();
            return;
        }
        currentPo = po;
        outputRows = [];
        if (statusEl) statusEl.textContent = 'Loading outputs…';
        listEl.innerHTML = '';
        clearPreview();
        try {
            const listJson = await fetchJson(`/api/process-label/by-po/${encodeURIComponent(po)}?list=1`);
            outputRows = (listJson.batches || []).slice().sort(
                (a, b) => batchSeqKey(a.outputBatch) - batchSeqKey(b.outputBatch)
            );
            if (!outputRows.length) {
                if (statusEl) statusEl.textContent = `Production order ${po}: no saved output batches yet.`;
                renderOutputList('');
                return;
            }
            if (statusEl) {
                statusEl.textContent = `Production order ${po}: ${outputRows.length} output batch(es). Select one for its label.`;
            }
            const firstBatch = outputRows[0].outputBatch;
            renderOutputList(firstBatch);
            const urlBatch = new URLSearchParams(location.search).get('batch')?.trim();
            const pick = urlBatch && outputRows.some((r) => r.outputBatch === urlBatch)
                ? urlBatch
                : firstBatch;
            await selectBatch(pick);
        } catch (e) {
            if (statusEl) statusEl.textContent = '❌ ' + (e.message || e);
            listEl.innerHTML = '';
            clearPreview();
        }
    }

    searchBtn?.addEventListener('click', loadPoLabels);
    poInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadPoLabels(); });

    window.homeProcessLabelsLoadPo = loadPoLabels;

    window.processLabelsRunFromParams = function runFromParams() {
        const urlParams = new URLSearchParams(location.search);
        const urlPo = urlParams.get('labelPo') || urlParams.get('po');
        if (urlPo) {
            poInput.value = urlPo;
            loadPoLabels();
        }
    };
})();
