// Material Traceability — embedded on home page (index.html)
// PO in API/URL params = SAP Production Order (OWOR), not Purchase Order.

(function initTraceability() {
    const poInput = document.getElementById('trace-po-input');
    const batchPoInput = document.getElementById('trace-batch-po-input');
    const batchInput = document.getElementById('trace-batch-input');
    const batchHintEl = document.getElementById('trace-batch-hint');
    const statusEl = document.getElementById('trace-status');
    const resultsEl = document.getElementById('trace-results');
    const poSummaryEl = document.getElementById('trace-po-summary');
    const cardInputs = document.getElementById('trace-card-inputs');
    const cardOutputs = document.getElementById('trace-card-outputs');

    if (!poInput || !resultsEl) return;

    const API_ROOT = (window.location.protocol === 'file:' || !window.location.host)
        ? null
        : `${window.location.protocol}//${window.location.host}`;

    async function fetchJson(apiPath, options = {}) {
        if (!API_ROOT) {
            throw new Error(
                'Open this page through the server URL (not the HTML file directly).'
            );
        }
        const url = `${API_ROOT}${apiPath.startsWith('/') ? apiPath : '/' + apiPath}`;
        const resp = await fetch(url, options);
        const text = await resp.text();
        let json;
        try {
            json = JSON.parse(text);
        } catch (_) {
            if (text.trimStart().startsWith('<!DOCTYPE') || text.trimStart().startsWith('<html')) {
                throw new Error(
                    'API returned HTML instead of JSON. Open the app from the server (port 5006).'
                );
            }
            throw new Error(`Invalid JSON (HTTP ${resp.status})`);
        }
        if (!resp.ok) {
            throw new Error(json.message || json.error || `HTTP ${resp.status}`);
        }
        return json;
    }

    let poData = null;
    let poView = 'outputs';

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function fmtDate(d) {
        if (!d) return '—';
        const dt = new Date(d);
        return isNaN(dt) ? '—' : dt.toLocaleString();
    }

    function setMode(mode) {
        document.querySelectorAll('.trace-mode-tab').forEach((t) => {
            t.classList.toggle('active', t.dataset.mode === mode);
        });
        document.getElementById('trace-panel-po').classList.toggle('active', mode === 'po');
        document.getElementById('trace-panel-batch').classList.toggle('active', mode === 'batch');
        if (batchHintEl) {
            batchHintEl.style.display = mode === 'batch' ? '' : 'none';
        }
        poSummaryEl.classList.remove('visible');
        resultsEl.innerHTML = '';
        statusEl.textContent = '';
    }

    document.querySelectorAll('.trace-mode-tab').forEach((tab) => {
        tab.addEventListener('click', () => setMode(tab.dataset.mode));
    });

    function inputTableRows(items) {
        return items.map((i) => {
            const usedIn = (i.usedInOutputs && i.usedInOutputs.length)
                ? esc(i.usedInOutputs.join(', '))
                : (i.usageStatus === 'issued' || i.usageStatus === 'unused'
                    ? '<span class="trace-warn-pill">Not used yet</span>'
                    : '—');
            return `
            <tr class="${i.usageStatus === 'issued' || i.usageStatus === 'unused' ? 'trace-row-unused' : ''}">
                <td>${esc(i.itemCode || '—')}</td>
                <td class="trace-batch">${esc(i.batchNumber)}</td>
                <td class="trace-qty">${i.issuedQty != null ? i.issuedQty : '—'}</td>
                <td>${esc(i.inputType === 'process_batch'
                    ? (i.sourcePoNum ? `Prod. order ${i.sourcePoNum} output` : 'Prev. process output')
                    : (i.warehouse || 'Raw roll'))}</td>
                <td class="trace-meta">${usedIn}</td>
            </tr>`;
        }).join('');
    }

    function detailInputRows(inputs, inputBatchMap) {
        return inputs.map((i) => {
            const issuedNum = i.availableQty != null
                ? Number(i.availableQty)
                : (i.issuedQty != null
                    ? Number(i.issuedQty)
                    : (inputBatchMap?.get(i.batchNumber)?.issuedQty != null
                        ? Number(inputBatchMap.get(i.batchNumber).issuedQty)
                        : null));
            const issued = issuedNum != null ? issuedNum : '—';
            return `
            <tr>
                <td>${esc(i.itemCode || '—')}</td>
                <td class="trace-batch">${esc(i.batchNumber)}</td>
                <td class="trace-qty">${issued}</td>
                <td class="trace-qty">${i.quantity != null ? i.quantity : '—'}</td>
                <td>${esc(i.inputType === 'process_batch' ? 'Prev. process' : (i.warehouse || 'Raw roll'))}</td>
                <td>${esc(i.operator || '')}<div class="trace-meta">${esc(i.machine || '')}</div></td>
                <td class="trace-meta">${esc(fmtDate(i.usedAt))}</td>
            </tr>`;
        }).join('');
    }

    function renderPOView() {
        if (!poData) return;
        cardInputs.classList.toggle('selected', poView === 'inputs');
        cardOutputs.classList.toggle('selected', poView === 'outputs');

        if (poView === 'inputs') {
            const items = poData.inputBatches || [];
            if (!items.length) {
                resultsEl.innerHTML = '<div class="trace-empty">No input batches issued yet.<br>Issue material to this production order before running the job.</div>';
                return;
            }
            resultsEl.innerHTML = `
                <div class="trace-group">
                    <div class="trace-group-head">
                        <div><span class="trace-arrow">Prod. order ${esc(poData.poNum)} →</span> <strong>Input Batches Issued</strong></div>
                        <span class="trace-pill">${items.length} batch(es)</span>
                    </div>
                    <table class="trace-table">
                        <thead>
                            <tr>
                                <th>Item</th><th>Input Batch</th>
                                <th style="text-align:right">Issued Quantity</th>
                                <th>Source</th><th>Used In Output(s)</th>
                            </tr>
                        </thead>
                        <tbody>${inputTableRows(items)}</tbody>
                    </table>
                </div>`;
            return;
        }

        const outputs = poData.outputBatches || [];
        if (!outputs.length) {
            resultsEl.innerHTML = '<div class="trace-empty">No output batches for this production order yet.</div>';
            return;
        }
        const inputBatchMap = new Map(
            (poData.inputBatches || []).map((b) => [b.batchNumber, b])
        );
        const hasUnlinked = outputs.some((o) => o.noInputsRecorded);
        const hasIssuedInputs = (poData.inputBatches || []).some((b) =>
            (Number(b.issuedQty) || 0) > 0 || (Number(b.remainingQty) || 0) > 0
        );
        const reconcileBanner = (hasUnlinked && hasIssuedInputs)
            ? `<div class="trace-reconcile-banner" style="margin-bottom:16px;padding:14px 18px;background:#422006;border:1px solid #f59e0b;border-radius:8px;color:#fde68a">
                <strong>Inputs were issued but not linked at report completion.</strong>
                Finish Job must select which rolls/batches were used — otherwise traceability cannot connect inputs to outputs.
                <button type="button" id="trace-reconcile-btn" style="display:block;margin-top:10px;padding:8px 14px;background:#f59e0b;color:#1c1917;border:none;border-radius:6px;cursor:pointer;font-weight:600">
                    Link issued inputs to outputs (auto)
                </button>
            </div>`
            : '';
        resultsEl.innerHTML = reconcileBanner + outputs.map((o) => {
            const rows = detailInputRows(o.inputs || [], inputBatchMap);
            const warn = o.noInputsRecorded
                ? '<span class="trace-warn-pill"> ⚠ No inputs linked — finish job with input selection</span>'
                : '';
            const completionMeta = (o.completionOperator || o.completionMachine)
                ? `<span class="trace-completion-meta">Report completed by: <strong>${esc(o.completionOperator || '—')}</strong>${o.completionMachine ? ` · ${esc(o.completionMachine)}` : ''}</span>`
                : '';
            const dimW = Number(o.uWidth);
            const dimL = Number(o.uLength);
            const dimFmt = (typeof ProcessLabelFormats !== 'undefined' && ProcessLabelFormats.formatBatchDimensions)
                ? ProcessLabelFormats.formatBatchDimensions(dimW, dimL)
                : `${dimW} mm × ${dimL} m`;
            const dimMeta = (dimW > 0 && dimL > 0)
                ? `<span class="trace-completion-meta">Size: <strong>${dimFmt}</strong></span>`
                : `<span class="trace-warn-pill">Width/length missing — use <strong>Update Batch Data</strong> from home</span>`;
            return `
                <div class="trace-group">
                    <div class="trace-group-head">
                        <div>
                            <span class="trace-arrow">Output →</span>
                            <a class="trace-out-batch trace-batch-link" href="#" data-batch="${esc(o.outputBatch)}">${esc(o.outputBatch)}</a>
                            ${warn}
                            ${completionMeta}
                            ${dimMeta}
                        </div>
                        <span class="trace-pill">${o.inputCount || 0} input(s) · ${o.totalInputQty || 0} KGS in${o.outputQty != null ? ` · ${o.outputQty} KGS out` : ''}</span>
                    </div>
                    ${rows ? `<table class="trace-table">
                        <thead>
                            <tr>
                                <th>Item</th><th>Input Batch</th>
                                <th style="text-align:right">Issued Quantity</th>
                                <th style="text-align:right">Used Here</th>
                                <th>Source</th><th>Operator</th><th>Used At</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>` : `<div class="trace-empty" style="padding:24px">No inputs linked for this output batch.${o.completionOperator ? `<br>Report completed by <strong>${esc(o.completionOperator)}</strong>${o.completionMachine ? ` (${esc(o.completionMachine)})` : ''}.` : ''}</div>`}
                </div>`;
        }).join('');

        const reconcileBtn = document.getElementById('trace-reconcile-btn');
        if (reconcileBtn) {
            reconcileBtn.addEventListener('click', reconcileCurrentPo);
        }

        resultsEl.querySelectorAll('a.trace-batch-link').forEach((a) => {
            a.addEventListener('click', (e) => {
                e.preventDefault();
                const bn = a.dataset.batch;
                if (bn) openBatchSearch(bn, poData?.poNum);
            });
        });
    }

    async function suggestBatchOwnerPO() {
        const batch = batchInput?.value.trim();
        if (!batch || !batchPoInput) return;
        try {
            const json = await fetchJson(`/api/traceability/batch-owner/${encodeURIComponent(batch)}`);
            if (json.ownerPo) {
                const current = batchPoInput.value.trim();
                if (!current) {
                    batchPoInput.value = json.ownerPo;
                    statusEl.textContent = `Batch ${batch} belongs to production order ${json.ownerPo}${json.processName ? ` (${json.processName})` : ''} — order number filled automatically.`;
                } else if (current !== json.ownerPo) {
                    statusEl.textContent = `❌ This batch belongs to production order ${json.ownerPo}${json.processName ? ` (${json.processName})` : ''}, not ${current}.`;
                    resultsEl.innerHTML = '';
                }
            }
        } catch (_) { /* unknown batch — ignore until search */ }
    }

    function openBatchSearch(batchNum, poNum) {
        setMode('batch');
        const po = String(poNum || poData?.poNum || poInput?.value || '').trim();
        if (batchPoInput) batchPoInput.value = po;
        batchInput.value = batchNum;
        if (!po) {
            statusEl.textContent = '⚠️ Please enter production order — batch trace needs order number and batch number together.';
            resultsEl.innerHTML = '';
            poSummaryEl.classList.remove('visible');
            batchPoInput?.focus();
            return;
        }
        runBatchSearch();
    }

    async function reconcileCurrentPo() {
        const po = String(poData?.poNum || poInput.value || '').trim();
        if (!po) return;
        if (!confirm(`Link issued inputs to unlinked outputs for production order ${po}?`)) return;
        statusEl.textContent = 'Linking inputs…';
        try {
            const json = await fetchJson(
                `/api/traceability/reconcile/${encodeURIComponent(po)}`,
                { method: 'POST' }
            );
            if (!json.success) throw new Error(json.message || 'Failed');
            statusEl.textContent = `Linked ${json.linked || 0} input usage row(s). Refreshing…`;
            poInput.value = po;
            await runPOSearch(po);
        } catch (e) {
            statusEl.textContent = '❌ ' + (e.message || e);
        }
    }

    async function runPOSearch(poOverride) {
        const po = String(
            typeof poOverride === 'string' || typeof poOverride === 'number' ? poOverride : poInput.value
        ).trim();
        if (!po) {
            statusEl.textContent = 'Enter a production order number.';
            return;
        }
        statusEl.textContent = 'Loading…';
        resultsEl.innerHTML = '';
        poSummaryEl.classList.remove('visible');
        try {
            const json = await fetchJson(`/api/traceability/by-po/${encodeURIComponent(po)}`);
            if (!json.success) throw new Error(json.message || 'Failed');
            poData = json;
            document.getElementById('trace-input-count').textContent = (json.inputBatches || []).length;
            document.getElementById('trace-output-count').textContent = (json.outputBatches || []).length;
            poSummaryEl.classList.add('visible');
            poView = 'outputs';
            const usedCount = (json.inputBatches || []).filter((b) => (b.totalQtyUsed || 0) > 0).length;
            statusEl.textContent = `Production order ${po}: ${(json.inputBatches || []).length} input batch(es) issued (${usedCount} used in production), ${(json.outputBatches || []).length} output batch(es).`;
            renderPOView();
        } catch (e) {
            statusEl.textContent = '❌ ' + (e.message || e);
        }
    }

    async function runBatchSearch() {
        const batch = batchInput.value.trim();
        const po = batchPoInput?.value.trim() || '';
        if (!po) {
            statusEl.textContent = '⚠️ Please enter production order — batch trace needs order number and batch number together.';
            batchPoInput?.focus();
            return;
        }
        if (!batch) {
            statusEl.textContent = 'Enter an output batch number.';
            batchInput?.focus();
            return;
        }

        // Resolve owning production order before search — batch must match the order that produced it
        let ownerPo = null;
        let ownerProcess = null;
        try {
            const ownerJson = await fetchJson(`/api/traceability/batch-owner/${encodeURIComponent(batch)}`);
            ownerPo = ownerJson.ownerPo || null;
            ownerProcess = ownerJson.processName || null;
        } catch (_) {
            /* batch-owner API unavailable on older server — validated after by-batch */
        }
        if (ownerPo && ownerPo !== po) {
            const procHint = ownerProcess ? ` (${ownerProcess})` : '';
            statusEl.textContent = `❌ This batch belongs to production order ${ownerPo}${procHint}, not ${po}. Use production order ${ownerPo} to trace this batch.`;
            resultsEl.innerHTML = '';
            batchPoInput.value = ownerPo;
            batchPoInput?.focus();
            return;
        }

        statusEl.textContent = 'Loading…';
        resultsEl.innerHTML = '';
        poSummaryEl.classList.remove('visible');
        try {
            const qs = new URLSearchParams({ po: ownerPo || po });
            const json = await fetchJson(
                `/api/traceability/by-batch/${encodeURIComponent(batch)}?${qs}`
            );
            if (!json.success) throw new Error(json.message || 'Failed');
            if (json.poNum && String(json.poNum) !== String(po)) {
                throw new Error(
                    `This batch belongs to production order ${json.poNum}, not ${po}. Use production order ${json.poNum} to trace this batch.`
                );
            }
            const resolvedPo = json.poNum || ownerPo || po;
            const inputs = json.inputs || [];
            statusEl.textContent = inputs.length
                ? `Production order ${resolvedPo}: ${inputs.length} input(s) used to produce ${batch}`
                : `Production order ${resolvedPo}: no report-completion inputs linked for ${batch}. Finish job with input selection.`;

            const hero = `
                <div class="trace-batch-hero">
                    <div class="trace-hero-title">Output Batch</div>
                    <div class="trace-hero-batch-id">${esc(json.outputBatch)}</div>
                    <div class="trace-hero-meta">
                        ${resolvedPo ? `Prod. order ${esc(resolvedPo)}` : ''}
                        ${json.outputQty != null ? ` · Output: <strong>${json.outputQty} KGS</strong>` : ''}
                        ${json.itemCode ? ` · Item: ${esc(json.itemCode)}` : ''}
                        ${json.completionOperator ? ` · Operator: <strong>${esc(json.completionOperator)}</strong>${json.completionMachine ? ` (${esc(json.completionMachine)})` : ''}` : ''}
                    </div>
                </div>`;

            if (!inputs.length) {
                resultsEl.innerHTML = hero + '<div class="trace-empty">No inputs linked at report completion.<br>Use Finish Job and select which rolls/batches were used.</div>';
                return;
            }

            resultsEl.innerHTML = hero + `
                <div class="trace-group">
                    <div class="trace-group-head">
                        <div><span class="trace-arrow">Made from →</span> <strong>Inputs Used</strong></div>
                        <span class="trace-pill">${inputs.length} input(s) · ${json.totalInputQty || 0} KGS used here</span>
                    </div>
                    <table class="trace-table">
                        <thead>
                            <tr>
                                <th>Item</th><th>Input Batch</th>
                                <th style="text-align:right">Issued Quantity</th>
                                <th style="text-align:right">Used Here</th>
                                <th>Source</th><th>Operator / Machine</th><th>Used At</th>
                            </tr>
                        </thead>
                        <tbody>${detailInputRows(inputs)}</tbody>
                    </table>
                </div>`;
        } catch (e) {
            statusEl.textContent = '❌ ' + (e.message || e);
        }
    }

    cardInputs.addEventListener('click', () => { poView = 'inputs'; renderPOView(); });
    cardOutputs.addEventListener('click', () => { poView = 'outputs'; renderPOView(); });

    document.getElementById('trace-search-po-btn').addEventListener('click', () => runPOSearch());
    document.getElementById('trace-search-batch-btn').addEventListener('click', runBatchSearch);
    poInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runPOSearch(); });
    batchInput?.addEventListener('blur', () => { suggestBatchOwnerPO(); });
    batchPoInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') runBatchSearch(); });
    batchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runBatchSearch(); });

    window.traceabilityRunFromParams = function runFromParams() {
        const params = new URLSearchParams(location.search);
        if (params.get('batch')) {
            setMode('batch');
            if (batchPoInput) batchPoInput.value = params.get('po') || '';
            batchInput.value = params.get('batch');
            runBatchSearch();
        } else if (params.get('po')) {
            setMode('po');
            poInput.value = params.get('po');
            runPOSearch();
        }
    };
})();
