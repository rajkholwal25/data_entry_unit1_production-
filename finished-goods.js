// Finished Goods Entry - JavaScript
// Handles PO search, form validation, submission to SAP/MySQL, and label printing

// API Configuration
const API_BASE_URL = `${window.location.protocol}//${window.location.host}/api`;

// Current job data
let currentJobData = null;
let currentInventoryUOM = '';

// Last submitted entry data (for label printing)
let lastSubmittedEntry = null;

// Previous-process inputs for FG traceability (same pattern as machine report completion)
let fgInputRoles = [];
let fgSelectedInputs = [];

// QC Supervisor list
const QC_SUPERVISORS = [
    'Amit',
    'Aakash',
    'Jagdish',
    'Mukesh',
    'Chandra Shekhar'
];

function extractFirstName(fullName) {
    const s = (fullName || '').toString().trim();
    if (!s) return '';
    return s.split(/\s+/)[0];
}

/** Label Operator field: "SupervisorFirst/OperatorFirst" */
function formatLabelOperatorField(supervisorName, operatorName) {
    const supFirst = extractFirstName(supervisorName);
    const opFirst = extractFirstName(operatorName);
    if (supFirst && opFirst) return `${supFirst}/${opFirst}`;
    return supFirst || opFirst || '';
}

// DOM Elements
const elements = {
    poSearchInput: null,
    poSearchBtn: null,
    loadingSection: null,
    errorSection: null,
    errorMessage: null,
    retryBtn: null,
    jobSection: null,
    successSection: null,
    successDetails: null,
    newEntryBtn: null,
    printLabelsBtn: null,
    labelCount: null,
    fgEntryForm: null,
    clearFormBtn: null,
    submitBtn: null,
    confirmModal: null,
    confirmModalBody: null,
    cancelSubmitBtn: null,
    confirmSubmitBtn: null,
    qcSupervisorSelect: null,
    otherQcGroup: null,
    otherQcInput: null,
    currentTime: null,
    labelPrintContainer: null,
    labelPreviewModal: null,
    labelPreviewHint: null,
    labelPreviewHost: null,
    labelPreviewSkipBtn: null,
    labelPreviewBrowserPrintBtn: null,
    labelPreviewPrintBtn: null,
    labelPrintStatusExtra: null
};

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    initializeElements();
    setupEventListeners();
    startClock();
    
    // Focus on search input
    if (elements.poSearchInput) {
        elements.poSearchInput.focus();
    }
});

// Initialize DOM element references
function initializeElements() {
    elements.poSearchInput = document.getElementById('po-search-input');
    elements.poSearchBtn = document.getElementById('po-search-btn');
    elements.loadingSection = document.getElementById('loading-section');
    elements.errorSection = document.getElementById('error-section');
    elements.errorMessage = document.getElementById('error-message');
    elements.retryBtn = document.getElementById('retry-btn');
    elements.jobSection = document.getElementById('job-section');
    elements.successSection = document.getElementById('success-section');
    elements.successDetails = document.getElementById('success-details');
    elements.newEntryBtn = document.getElementById('new-entry-btn');
    elements.printLabelsBtn = document.getElementById('print-labels-btn');
    elements.labelCount = document.getElementById('label-count');
    elements.fgEntryForm = document.getElementById('fg-entry-form');
    elements.clearFormBtn = document.getElementById('clear-form-btn');
    elements.submitBtn = document.getElementById('submit-btn');
    elements.confirmModal = document.getElementById('confirm-modal');
    elements.confirmModalBody = document.getElementById('confirm-modal-body');
    elements.cancelSubmitBtn = document.getElementById('cancel-submit-btn');
    elements.confirmSubmitBtn = document.getElementById('confirm-submit-btn');
    elements.qcSupervisorSelect = document.getElementById('qc-supervisor');
    elements.otherQcGroup = document.getElementById('other-qc-group');
    elements.otherQcInput = document.getElementById('other-qc-supervisor');
    elements.currentTime = document.getElementById('current-time');
    elements.labelPrintContainer = document.getElementById('label-print-container');
    elements.labelPreviewModal = document.getElementById('label-preview-modal');
    elements.labelPreviewHint = document.getElementById('label-preview-hint');
    elements.labelPreviewHost = document.getElementById('label-preview-host');
    elements.labelPreviewSkipBtn = document.getElementById('label-preview-skip-btn');
    elements.labelPreviewBrowserPrintBtn = document.getElementById('label-preview-browser-print-btn');
    elements.labelPreviewPrintBtn = document.getElementById('label-preview-print-btn');
    elements.labelPrintStatusExtra = document.getElementById('label-print-status-extra');
}

// Setup event listeners
function setupEventListeners() {
    // Search functionality
    if (elements.poSearchBtn) {
        elements.poSearchBtn.addEventListener('click', handleSearch);
    }
    
    if (elements.poSearchInput) {
        elements.poSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleSearch();
            }
        });
    }
    
    // Retry button
    if (elements.retryBtn) {
        elements.retryBtn.addEventListener('click', handleSearch);
    }
    
    // Form submission
    if (elements.fgEntryForm) {
        elements.fgEntryForm.addEventListener('submit', handleFormSubmit);
    }
    
    // Clear form button
    if (elements.clearFormBtn) {
        elements.clearFormBtn.addEventListener('click', clearForm);
    }

    document.getElementById('fg-input-add-btn')?.addEventListener('click', addFgInputFromSelect);
    
    // QC Supervisor "Other" option
    if (elements.qcSupervisorSelect) {
        elements.qcSupervisorSelect.addEventListener('change', handleQcSupervisorChange);
    }
    
    // Modal buttons
    if (elements.cancelSubmitBtn) {
        elements.cancelSubmitBtn.addEventListener('click', hideConfirmModal);
    }
    
    if (elements.confirmSubmitBtn) {
        elements.confirmSubmitBtn.addEventListener('click', confirmAndSubmit);
    }
    
    // New entry button
    if (elements.newEntryBtn) {
        elements.newEntryBtn.addEventListener('click', resetToSearch);
    }
    
    // Reprint / print on label printer (server PDF → CUPS → ZT411)
    if (elements.printLabelsBtn) {
        elements.printLabelsBtn.addEventListener('click', () => sendLabelsToPrinter({ fromReprint: true }));
    }

    // Label preview modal (optional flow)
    if (elements.labelPreviewSkipBtn) {
        elements.labelPreviewSkipBtn.addEventListener('click', hideLabelPreviewModal);
    }
    if (elements.labelPreviewBrowserPrintBtn) {
        elements.labelPreviewBrowserPrintBtn.addEventListener('click', () => {
            // Tablet/browser printing: render all labels into #label-print-container and open native print dialog
            try {
                printLabelsOnThisDevice();
            } finally {
                hideLabelPreviewModal();
            }
        });
    }
    if (elements.labelPreviewPrintBtn) {
        elements.labelPreviewPrintBtn.addEventListener('click', () => sendLabelsToPrinter({ fromPreview: true }));
    }
    // Rendered printing (PNG -> ZPL) is intentionally disabled because it degrades barcode quality.
    if (elements.labelPreviewModal) {
        elements.labelPreviewModal.addEventListener('click', (e) => {
            if (e.target === elements.labelPreviewModal) {
                hideLabelPreviewModal();
            }
        });
    }
    
    // Close modal on overlay click
    if (elements.confirmModal) {
        elements.confirmModal.addEventListener('click', (e) => {
            if (e.target === elements.confirmModal) {
                hideConfirmModal();
            }
        });
    }
}

// Start clock display
function startClock() {
    function updateClock() {
        const now = new Date();
        const options = {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        };
        if (elements.currentTime) {
            elements.currentTime.textContent = now.toLocaleTimeString('en-IN', options);
        }
    }
    
    updateClock();
    setInterval(updateClock, 1000);
}

// Handle PO search
async function handleSearch() {
    const poNumber = elements.poSearchInput?.value.trim();
    
    if (!poNumber) {
        alert('Please enter a Production Order number');
        elements.poSearchInput?.focus();
        return;
    }
    
    // Show loading, hide other sections
    showSection('loading');
    
    try {
        const response = await fetch(
            `${API_BASE_URL}/production-order/${encodeURIComponent(poNumber)}?enrich=1&prefer_process=FG`
        );
        const result = await response.json();
        
        if (!response.ok) {
            const detail = result.hint ? `\n\n${result.hint}` : '';
            const sapErr = result.sapError ? `\n\nSAP: ${result.sapError}` : '';
            throw new Error((result.error || result.message || 'Failed to fetch production order') + detail + sapErr);
        }
        
        if (!result.success || !result.data) {
            throw new Error('Production order not found');
        }
        
        // Store job data
        currentJobData = result.data;
        
        // Validate U_PCode - Finished Goods: FG process code OR final item (no -EMB/-SLT suffix)
        const uPCode = (currentJobData.uPCode || '').toUpperCase();
        const itemNo = String(currentJobData.itemNo || '').toUpperCase();
        const isFgProcessCode = uPCode === 'FG' || uPCode.includes('FINISHED');
        const isFinalItemCode = itemNo && !/-(EMB|MET|MTL|COT|SLT|REW)(-\d+)?$/i.test(itemNo);
        if (!isFgProcessCode && !isFinalItemCode) {
            throw new Error(`This page is only for Finished Goods (FG) jobs.\n\nThis job has process code "${currentJobData.uPCode || 'N/A'}" which should be processed on the appropriate machine first.`);
        }

        // Manual issue popup (no FG auto-issue — reduces SAP load)
        await maybeShowFgMaterialIssuePopup(currentJobData);
        
        // Display job details
        displayJobDetails(currentJobData);
        
        // Show job section
        showSection('job');
        
    } catch (error) {
        console.error('Search error:', error);
        showError(error.message);
    }
}

function formatQty(qty) {
    return (Number(qty) || 0).toLocaleString();
}

/**
 * Always open the FG batch picker for every process-input component.
 * This is intentionally independent of planned/issued/remaining quantities:
 * the operator may issue any positive quantity up to current linked-batch stock.
 */
async function maybeShowFgMaterialIssuePopup(job) {
    let components = Array.isArray(job?.bomProcessInputs) ? job.bomProcessInputs : [];
    if (!components.length) {
        try {
            const resp = await fetch(
                `${API_BASE_URL}/production-order/${encodeURIComponent(job.jobNumber)}?materialOnly=1&prefer_process=FG`
            );
            const json = await resp.json();
            const fresh = json?.data || json;
            if (fresh) {
                job.unissuedMaterialsNeedIssue = fresh.unissuedMaterialsNeedIssue || [];
                job.bomProcessInputs = fresh.bomProcessInputs || [];
                job.processInputAvailableQty = fresh.processInputAvailableQty ?? job.processInputAvailableQty;
                job.materialIssuedQuantity = fresh.materialIssuedQuantity ?? job.materialIssuedQuantity;
                job.issuedQuantity = fresh.issuedQuantity ?? job.issuedQuantity;
            }
            components = Array.isArray(job.bomProcessInputs) ? job.bomProcessInputs : [];
        } catch (err) {
            console.warn('FG material refresh failed:', err);
        }
    }

    // Older API fallback: retain the popup when bomProcessInputs was not returned.
    if (!components.length) {
        components = (job?.unissuedMaterialsNeedIssue || []).map((m) => ({
            itemCode: m.itemNo,
            warehouse: m.warehouse,
            lineNumber: m.lineNumber
        }));
    }
    if (!components.length) {
        alert('No process-input component line was found on this FG production order.');
        return { success: false, skipped: true };
    }

    for (const component of components) {
        const mat = {
            itemNo: component.itemCode || component.itemNo,
            warehouse: component.warehouse,
            lineNumber: component.lineNumber
        };
        const result = await showFgBatchIssueDialog(job, mat);
        if (!result || result.cancelled) {
            return { success: false, cancelled: true };
        }
        if (result.success) {
            try {
                const refresh = await fetch(
                    `${API_BASE_URL}/production-order/${encodeURIComponent(job.jobNumber)}?enrich=1&prefer_process=FG`
                );
                const refreshJson = await refresh.json();
                if (refresh.ok && refreshJson?.data) {
                    Object.assign(job, refreshJson.data);
                    currentJobData = job;
                }
            } catch (_) { /* non-blocking */ }
        }
    }
    return { success: true };
}

/**
 * Popup: select component-warehouse batches and issue to FG PO (manual).
 * FG-only: operator may choose linked previous-PO batches OR other PO batches.
 */
function showFgBatchIssueDialog(job, material) {
    return new Promise(async (resolve) => {
        const existing = document.getElementById('fg-batch-issue-overlay');
        if (existing) existing.remove();

        const wh = String(material.warehouse || '').trim();
        const itemCode = String(material.itemNo || '').trim();
        const uom = currentInventoryUOM || 'KGS';

        const overlay = document.createElement('div');
        overlay.id = 'fg-batch-issue-overlay';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 20000;
            background: rgba(15, 23, 42, 0.72); display: flex;
            align-items: center; justify-content: center; padding: 16px;
        `;
        overlay.innerHTML = `
            <div style="background:#0f172a;color:#e2e8f0;border:1px solid rgba(148,163,184,0.3);
                border-radius:14px;width:min(720px,100%);max-height:90vh;overflow:auto;
                box-shadow:0 24px 60px rgba(0,0,0,0.45);">
                <div style="padding:16px 18px;border-bottom:1px solid rgba(148,163,184,0.2);">
                    <div style="font-size:1.05rem;font-weight:700;">Issue material to FG PO</div>
                    <div style="margin-top:6px;font-size:0.85rem;opacity:0.85;">
                        PO <strong>${job.jobNumber}</strong> · ${itemCode}<br>
                        Component warehouse <strong>${wh || '—'}</strong>
                    </div>
                    <div style="margin-top:8px;font-size:0.8rem;color:#fbbf24;">
                        FG only: you can issue linked previous-PO batches <strong>or other PO batches</strong> from this warehouse.
                        Select carefully — you are responsible for what you issue.
                    </div>
                </div>
                <div id="fg-issue-body" style="padding:14px 18px;">
                    <div style="text-align:center;padding:24px;opacity:0.8;">Loading warehouse batches…</div>
                </div>
                <div style="padding:12px 18px 16px;display:flex;gap:10px;justify-content:flex-end;
                    border-top:1px solid rgba(148,163,184,0.2);">
                    <button type="button" id="fg-issue-skip" style="padding:10px 14px;border-radius:8px;
                        border:1px solid rgba(148,163,184,0.35);background:transparent;color:#cbd5e1;cursor:pointer;">
                        Skip for now
                    </button>
                    <button type="button" id="fg-issue-submit" style="padding:10px 16px;border-radius:8px;
                        border:none;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;
                        font-weight:600;cursor:pointer;" disabled>
                        Issue selected
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const body = overlay.querySelector('#fg-issue-body');
        const submitBtn = overlay.querySelector('#fg-issue-submit');
        const skipBtn = overlay.querySelector('#fg-issue-skip');
        let batches = [];

        const close = (result) => {
            overlay.remove();
            resolve(result);
        };

        skipBtn.addEventListener('click', () => close({ success: false, cancelled: true }));

        const updateSubmitState = () => {
            let total = 0;
            body.querySelectorAll('.fg-issue-qty').forEach((inp) => {
                if (inp.disabled) return;
                total += parseFloat(inp.value) || 0;
            });
            submitBtn.disabled = total <= 1e-6;
            submitBtn.textContent = total > 0
                ? `Issue ${formatKgsDisplay(total)} ${uom}`
                : 'Issue selected';
        };

        try {
            const url =
                `${API_BASE_URL}/po/${encodeURIComponent(job.jobNumber)}/linked-issue-batches` +
                `?itemCode=${encodeURIComponent(itemCode)}&warehouse=${encodeURIComponent(wh)}`;
            const resp = await fetch(url);
            const json = await resp.json();
            if (!resp.ok || json?.success === false) {
                throw new Error(json?.message || json?.error || 'Failed to load batches');
            }
            batches = Array.isArray(json.batches) ? json.batches : [];
            const sourceHint = (json.sourcePoNums || []).join(', ') || '—';
            const linkedCount = batches.filter((b) => b.isLinked).length;
            const otherCount = batches.length - linkedCount;

            if (!batches.length) {
                body.innerHTML = `
                    <div style="padding:12px;border-radius:8px;background:rgba(239,68,68,0.12);color:#fecaca;font-size:0.9rem;">
                        ${json.message || 'No stock batches found in this warehouse.'}<br>
                        <span style="opacity:0.85;">Linked source PO(s): ${sourceHint}</span><br>
                        Transfer stock to <strong>${wh || 'warehouse'}</strong>, then search PO again.
                    </div>`;
                submitBtn.disabled = true;
                return;
            }

            body.innerHTML = `
                <div style="font-size:0.8rem;color:#94a3b8;margin-bottom:10px;">
                    Linked source PO(s): <strong style="color:#e2e8f0;">${sourceHint}</strong><br>
                    Showing <strong style="color:#86efac;">${linkedCount} linked</strong>
                    + <strong style="color:#fdba74;">${otherCount} other</strong>
                    batch(es) in <strong>${wh || '—'}</strong>
                </div>
                <table style="width:100%;border-collapse:collapse;font-size:0.88rem;">
                    <thead>
                        <tr style="text-align:left;color:#94a3b8;border-bottom:1px solid rgba(148,163,184,0.25);">
                            <th style="padding:6px 4px;width:36px;"></th>
                            <th style="padding:6px 4px;">Batch</th>
                            <th style="padding:6px 4px;">From PO</th>
                            <th style="padding:6px 4px;">Type</th>
                            <th style="padding:6px 4px;text-align:right;">Avail</th>
                            <th style="padding:6px 4px;text-align:center;">Issue qty</th>
                        </tr>
                    </thead>
                    <tbody id="fg-issue-tbody"></tbody>
                </table>
                <div style="margin-top:10px;font-size:0.85rem;color:#94a3b8;">
                    No planned/remaining quantity cap. Each row is limited only by available stock.
                </div>
            `;
            const tbody = body.querySelector('#fg-issue-tbody');
            batches.forEach((b, idx) => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid rgba(148,163,184,0.12)';
                if (!b.isLinked) tr.style.background = 'rgba(251, 146, 60, 0.08)';
                const typeBadge = b.isLinked
                    ? '<span style="color:#86efac;font-weight:600;">Linked</span>'
                    : '<span style="color:#fdba74;font-weight:600;">Other PO</span>';
                tr.innerHTML = `
                    <td style="padding:8px 4px;text-align:center;">
                        <input type="checkbox" class="fg-issue-cb" data-idx="${idx}" style="width:18px;height:18px;">
                    </td>
                    <td style="padding:8px 4px;font-family:monospace;">${b.batchNumber}</td>
                    <td style="padding:8px 4px;">${b.sourcePoNum || '—'}</td>
                    <td style="padding:8px 4px;">${typeBadge}</td>
                    <td style="padding:8px 4px;text-align:right;font-weight:600;">${formatKgsDisplay(b.available)}</td>
                    <td style="padding:8px 4px;text-align:center;">
                        <input type="number" class="fg-issue-qty" data-idx="${idx}" min="0" max="${b.available}"
                            step="any" disabled value=""
                            style="width:90px;padding:6px;border-radius:6px;border:1px solid rgba(148,163,184,0.3);
                            background:#1e293b;color:#fff;text-align:center;">
                    </td>
                `;
                tbody.appendChild(tr);
            });

            tbody.querySelectorAll('.fg-issue-cb').forEach((cb) => {
                cb.addEventListener('change', () => {
                    const idx = cb.dataset.idx;
                    const qtyInp = tbody.querySelector(`.fg-issue-qty[data-idx="${idx}"]`);
                    const avail = Number(batches[idx]?.available) || 0;
                    if (cb.checked) {
                        qtyInp.disabled = false;
                        qtyInp.focus();
                    } else {
                        qtyInp.disabled = true;
                        qtyInp.value = '';
                    }
                    updateSubmitState();
                });
            });
            tbody.querySelectorAll('.fg-issue-qty').forEach((inp) => {
                inp.addEventListener('input', () => {
                    const idx = inp.dataset.idx;
                    const avail = Number(batches[idx]?.available) || 0;
                    let v = parseFloat(inp.value) || 0;
                    if (v > avail) {
                        v = avail;
                        inp.value = String(v);
                    }
                    updateSubmitState();
                });
            });
            updateSubmitState();
        } catch (err) {
            body.innerHTML = `
                <div style="padding:12px;border-radius:8px;background:rgba(239,68,68,0.12);color:#fecaca;">
                    ${err.message || 'Failed to load batches'}
                </div>`;
            submitBtn.disabled = true;
        }

        submitBtn.addEventListener('click', async () => {
            const allocations = [];
            body.querySelectorAll('.fg-issue-qty').forEach((inp) => {
                if (inp.disabled) return;
                const qty = parseFloat(inp.value) || 0;
                if (qty <= 1e-6) return;
                const idx = Number(inp.dataset.idx);
                const b = batches[idx];
                if (!b) return;
                allocations.push({
                    batchNumber: b.batchNumber,
                    quantity: qty,
                    sourcePoNum: b.sourcePoNum || null
                });
            });
            if (!allocations.length) return;

            submitBtn.disabled = true;
            submitBtn.textContent = 'Issuing…';
            skipBtn.disabled = true;
            try {
                const issueResp = await fetch(`${API_BASE_URL}/issue-rmc-batches`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        absoluteEntry: job.absoluteEntry,
                        documentNumber: job.jobNumber,
                        itemCode,
                        lineNumber: material.lineNumber,
                        warehouse: wh,
                        targetWarehouse: wh,
                        batchAllocations: allocations,
                        remarks: `FG manual issue (PO ${job.jobNumber})`,
                        machineName: 'FG-Entry',
                        operatorName: 'FG'
                    })
                });
                const issueJson = await issueResp.json();
                if (!issueResp.ok || issueJson?.success === false) {
                    throw new Error(issueJson?.message || issueJson?.error || 'Issue failed');
                }
                close({
                    success: true,
                    issued: allocations.reduce((s, a) => s + (Number(a.quantity) || 0), 0),
                    allocations
                });
            } catch (issueErr) {
                alert(`Issue failed:\n\n${issueErr.message || issueErr}`);
                submitBtn.disabled = false;
                skipBtn.disabled = false;
                updateSubmitState();
            }
        });
    });
}

function applyInventoryUomToFgUi(uom) {
    currentInventoryUOM = (uom || '').toString().trim();
    const unitLabel = currentInventoryUOM || 'Units';
    const unitSuffix = currentInventoryUOM ? ` (${currentInventoryUOM})` : '';

    const fgQtyLabel = document.getElementById('fg-quantity-label');
    const fgQtyHint = document.getElementById('fg-quantity-hint');
    if (fgQtyLabel) {
        fgQtyLabel.innerHTML = `<span class="label-icon">📦</span> FG Quantity (${unitLabel}) *`;
    }
    if (fgQtyHint) {
        fgQtyHint.textContent = currentInventoryUOM
            ? `Auto total of inputs used (${currentInventoryUOM}) — posted to SAP`
            : 'Auto total of inputs used — posted to SAP';
    }

    const fgInputsHint = document.getElementById('fg-inputs-hint');
    if (fgInputsHint) {
        fgInputsHint.textContent = currentInventoryUOM
            ? `Select last-process batches issued to this PO; enter qty used in ${currentInventoryUOM}`
            : 'Select last-process batches issued to this PO; enter qty used';
    }

    const qtyLabels = [
        ['planned-quantity-label', 'Planned Quantity'],
        ['issued-quantity-label', 'Issued Quantity'],
        ['completed-quantity-label', 'Completed Quantity'],
        ['remaining-quantity-label', 'Remaining Quantity']
    ];
    for (const [id, base] of qtyLabels) {
        const el = document.getElementById(id);
        if (el) el.textContent = `${base}${unitSuffix}`;
    }
}

// Display job details
function displayJobDetails(job) {
    // Update job info elements
    const jobNumberEl = document.getElementById('job-number');
    const customerNameEl = document.getElementById('customer-name');
    const fgCodeEl = document.getElementById('fg-code');
    const productDescEl = document.getElementById('product-description');
    const plannedQtyEl = document.getElementById('planned-quantity');
    const issuedQtyEl = document.getElementById('issued-quantity');
    const completedQtyEl = document.getElementById('completed-quantity');
    const remainingQtyEl = document.getElementById('remaining-quantity');
    const processCodeEl = document.getElementById('process-code');

    applyInventoryUomToFgUi(job.inventoryUOM);
    
    if (jobNumberEl) jobNumberEl.textContent = job.jobNumber || '-';
    const customerDisplay = (job.customerName || job.customerCode || '').toString().trim();
    if (customerNameEl) customerNameEl.textContent = customerDisplay || '-';
    if (fgCodeEl) fgCodeEl.textContent = job.itemNo || '-';
    if (productDescEl) productDescEl.textContent = job.jobName || '-';
    if (plannedQtyEl) plannedQtyEl.textContent = formatQty(job.plannedQuantity);
    if (issuedQtyEl) issuedQtyEl.textContent = formatQty(job.issuedQuantity);
    if (completedQtyEl) completedQtyEl.textContent = formatQty(job.completedQuantity);
    
    // Remaining = issued − already done (not planned − done)
    const issuedQty = job.issuedQuantity || 0;
    const completedQty = job.completedQuantity || 0;
    const remaining = Math.max(0, issuedQty - completedQty);
    if (remainingQtyEl) {
        remainingQtyEl.textContent = formatQty(remaining);
        // Show warning color if remaining is low or zero
        if (remaining <= 0) {
            remainingQtyEl.style.color = '#ef4444'; // Red
        } else {
            remainingQtyEl.style.color = ''; // Default warning color from CSS
        }
    }
    
    if (processCodeEl) processCodeEl.textContent = job.uPCode || '-';

    const widthEl = document.getElementById('fg-batch-width');
    const lengthEl = document.getElementById('fg-batch-length');
    if (widthEl) widthEl.value = '';
    if (lengthEl) lengthEl.value = '';
    
    fgSelectedInputs = [];
    loadFgInputBatches(job);
}

function formatKgsDisplay(n) {
    const v = Number(n) || 0;
    return Math.abs(v - Math.round(v)) < 0.001 ? String(Math.round(v)) : v.toFixed(2);
}

function isFgProcessBatch(r) {
    if (r.input_type === 'raw_roll') return false;
    if (r.input_type === 'process_batch') return true;
    const batch = String(r.batch_number || '').trim();
    if (!batch) return false;
    return Boolean(String(r.source_po_num || '').trim())
        || /^(EMB|MET|MTL|COT|SLT|REW|FG)\d{8}$/i.test(batch)
        || /-(EMB|MET|MTL|COT|SLT|REW)-/i.test(batch);
}

/** Resolve source PO from role row (matches machine data-entry traceability keys). */
function sourcePoFromFgRole(r) {
    const direct = String(r?.source_po_num || '').trim();
    if (direct) return direct;
    const id = String(r?.issue_id || '').trim();
    const m = id.match(/^(\d+):/);
    return m ? m[1] : '';
}

/** Client-side safety: one entry per batch + source PO with merged used/remaining. */
function dedupeFgSummaryIssuedRoles(roles) {
    if (!Array.isArray(roles) || roles.length === 0) return [];
    const byBatch = new Map();
    for (const r of roles) {
        const batch = String(r.batch_number || '').trim();
        if (!batch) continue;
        const sourcePo = sourcePoFromFgRole(r);
        if (isFgProcessBatch(r) && !sourcePo) continue;
        const key = sourcePo ? `${sourcePo}:${batch}` : batch;
        const issued = Number(r.issued_qty) || 0;
        const used = Number(r.used_qty) || 0;
        const remaining = Number(r.remaining_qty);
        const remainingQty = Number.isFinite(remaining) ? remaining : Math.max(0, issued - used);
        const prev = byBatch.get(key);
        if (!prev) {
            byBatch.set(key, {
                ...r,
                source_po_num: sourcePo || r.source_po_num || null,
                issue_id: r.issue_id ?? (sourcePo ? `${sourcePo}:${batch}` : batch),
                issued_qty: issued,
                used_qty: used,
                remaining_qty: remainingQty
            });
            continue;
        }
        const mergedIssued = Math.max(prev.issued_qty, issued);
        const mergedUsed = Math.max(prev.used_qty, used);
        byBatch.set(key, {
            ...prev,
            issue_id: prev.issue_id || r.issue_id,
            source_po_num: prev.source_po_num || sourcePo || r.source_po_num || null,
            issued_qty: mergedIssued,
            used_qty: mergedUsed,
            remaining_qty: Math.max(0, mergedIssued - mergedUsed)
        });
    }
    return Array.from(byBatch.values());
}

async function loadFgInputBatches(job) {
    const po = String(job?.jobNumber || '').trim();
    if (!po) {
        fgInputRoles = [];
        renderFgSelectedInputs();
        return;
    }
    const fg = job?.itemNo || '';
    const qs = new URLSearchParams({ process_tag: 'FG' });
    if (fg) qs.set('fg_num', fg);
    try {
        const res = await fetch(`${API_BASE_URL}/po/${encodeURIComponent(po)}/process-inputs?${qs}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const roles = (data.success && Array.isArray(data.roles)) ? data.roles : [];
        fgInputRoles = dedupeFgSummaryIssuedRoles(roles);
        console.log(`📋 FG inputs loaded: ${fgInputRoles.length} batch(es) for PO ${po}`);
    } catch (e) {
        console.warn('Failed to load FG process inputs:', e);
        fgInputRoles = [];
    }
    renderFgSelectedInputs();
}

function populateFgInputDropdown() {
    const sel = document.getElementById('fg-input-add-select');
    if (!sel) return;
    const selectedKeys = new Set(fgSelectedInputs.map((r) => String(r.issue_id)));
    sel.innerHTML = '<option value="">— Select input batch —</option>';
    let added = 0;
    for (const r of fgInputRoles) {
        if ((Number(r.remaining_qty) || 0) <= 0) continue;
        if (selectedKeys.has(String(r.issue_id))) continue;
        const opt = document.createElement('option');
        opt.value = String(r.issue_id);
        const poHint = r.source_po_num ? ` · Prod. order ${r.source_po_num}` : '';
        opt.textContent = `${r.batch_number}${poHint} — avail ${formatKgsDisplay(r.remaining_qty)}${currentInventoryUOM ? ` ${currentInventoryUOM}` : ' KGS'}`;
        sel.appendChild(opt);
        added++;
    }
    if (added === 0) {
        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = fgInputRoles.length
            ? 'All inputs fully used'
            : 'No batches from last process — issue material to this production order first';
        emptyOpt.disabled = true;
        sel.appendChild(emptyOpt);
    }
}

function updateFgQuantityFromInputs() {
    const total = fgSelectedInputs.reduce((s, r) => s + (Number(r.quantity_used) || 0), 0);
    const fgQtyEl = document.getElementById('fg-quantity');
    if (fgQtyEl) {
        fgQtyEl.value = total > 0 ? (Math.abs(total - Math.round(total)) < 0.001 ? String(Math.round(total)) : total.toFixed(2)) : '';
    }
}

function renderFgSelectedInputs() {
    const list = document.getElementById('fg-input-selected-list');
    if (!list) return;
    list.innerHTML = '';
    fgSelectedInputs.forEach((r) => {
        const row = document.createElement('div');
        row.className = 'role-selected-row';
        row.innerHTML = `
            <span class="role-batch-label">${r.batch_number}</span>
            <span class="role-avail">Avail: ${formatKgsDisplay(r.remaining_qty)}${currentInventoryUOM ? ` ${currentInventoryUOM}` : ' KGS'}</span>
            <span class="role-used-label">Used</span>
            <input type="number" class="fg-input-qty" min="0" max="${r.remaining_qty}" step="any"
                value="${r.quantity_used > 0 ? r.quantity_used : ''}" placeholder="0">
            <span class="role-qty-unit">${currentInventoryUOM || 'KGS'}</span>
            <button type="button" class="role-remove-btn">Remove</button>
        `;
        const qtyInput = row.querySelector('.fg-input-qty');
        qtyInput.addEventListener('input', () => {
            let val = parseFloat(qtyInput.value) || 0;
            if (val > r.remaining_qty) {
                val = r.remaining_qty;
                qtyInput.value = String(val);
            }
            if (val < 0) val = 0;
            r.quantity_used = val;
            updateFgQuantityFromInputs();
        });
        row.querySelector('.role-remove-btn')?.addEventListener('click', () => {
            fgSelectedInputs = fgSelectedInputs.filter((x) => String(x.issue_id) !== String(r.issue_id));
            renderFgSelectedInputs();
        });
        list.appendChild(row);
    });
    populateFgInputDropdown();
    updateFgQuantityFromInputs();
}

function addFgInputFromSelect() {
    const sel = document.getElementById('fg-input-add-select');
    if (!sel || !sel.value) {
        alert('Please select an input batch to add');
        return;
    }
    const key = sel.value;
    const role = fgInputRoles.find((r) => String(r.issue_id) === key);
    if (!role || (Number(role.remaining_qty) || 0) <= 0) {
        alert('This batch has no remaining quantity');
        return;
    }
    if (fgSelectedInputs.some((r) => String(r.issue_id) === key)) return;
    fgSelectedInputs.push({
        issue_id: role.issue_id,
        batch_number: role.batch_number,
        item_code: role.item_code,
        input_type: role.input_type || 'process_batch',
        source_po_num: sourcePoFromFgRole(role) || null,
        remaining_qty: role.remaining_qty,
        quantity_used: 0
    });
    renderFgSelectedInputs();
}

function collectFgInputUsages() {
    return fgSelectedInputs
        .filter((r) => (Number(r.quantity_used) || 0) > 0)
        .map((r) => ({
            issue_id: r.input_type === 'process_batch' ? null : r.issue_id,
            batch_number: r.batch_number,
            item_code: r.item_code,
            input_type: r.input_type || 'process_batch',
            source_po_num: r.source_po_num || sourcePoFromFgRole(r) || null,
            quantity_used: Number(r.quantity_used) || 0
        }));
}

// Handle QC Supervisor dropdown change
function handleQcSupervisorChange() {
    const selectedValue = elements.qcSupervisorSelect?.value;
    
    if (selectedValue === 'other') {
        if (elements.otherQcGroup) {
            elements.otherQcGroup.style.display = 'block';
        }
        if (elements.otherQcInput) {
            elements.otherQcInput.required = true;
            elements.otherQcInput.focus();
        }
    } else {
        if (elements.otherQcGroup) {
            elements.otherQcGroup.style.display = 'none';
        }
        if (elements.otherQcInput) {
            elements.otherQcInput.required = false;
            elements.otherQcInput.value = '';
        }
    }
}

// Handle form submission
function handleFormSubmit(e) {
    e.preventDefault();
    
    // Validate form
    const formData = getFormData();
    const validation = validateFormData(formData);
    
    if (!validation.valid) {
        alert(validation.message);
        return;
    }
    
    // Show confirmation modal
    showConfirmModal(formData);
}

// Get form data
function getFormData() {
    const fgQuantity = parseFloat(document.getElementById('fg-quantity')?.value) || 0;
    const batchWidth = parseFloat(document.getElementById('fg-batch-width')?.value) || 0;
    const batchLength = parseFloat(document.getElementById('fg-batch-length')?.value) || 0;
    const roleUsages = collectFgInputUsages();
    const remarks = document.getElementById('remarks')?.value.trim() || '';
    const pkdDetails = document.getElementById('pkd-details')?.value.trim() || '';
    
    // Get QC Supervisor
    let qcSupervisor = elements.qcSupervisorSelect?.value || '';
    if (qcSupervisor === 'other') {
        qcSupervisor = elements.otherQcInput?.value.trim() || '';
    }
    
    return {
        fgQuantity,
        batchWidth,
        batchLength,
        roleUsages,
        qcSupervisor,
        operatorName: document.getElementById('operator-name')?.value.trim() || '',
        remarks,
        pkdDetails
    };
}

// Validate form data
function validateFormData(data) {
    if (!data.roleUsages || data.roleUsages.length === 0) {
        return { valid: false, message: 'Please add at least one input batch from the last process and enter quantity used' };
    }
    for (const r of data.roleUsages) {
        if ((Number(r.quantity_used) || 0) <= 0) {
            return { valid: false, message: `Enter quantity used for ${r.batch_number}` };
        }
    }
    if (!data.fgQuantity || data.fgQuantity <= 0) {
        const uomHint = currentInventoryUOM ? ` (${currentInventoryUOM})` : '';
        return { valid: false, message: `FG quantity must be greater than zero${uomHint}` };
    }

    if (!data.batchWidth || data.batchWidth <= 0) {
        return { valid: false, message: 'Please enter batch width (mm) — must be greater than 0' };
    }
    if (!data.batchLength || data.batchLength <= 0) {
        return { valid: false, message: 'Please enter batch length (m) — must be greater than 0' };
    }
    
    if (!data.qcSupervisor) {
        return { valid: false, message: 'Please select a QC Supervisor' };
    }

    if (!data.operatorName || !data.operatorName.trim()) {
        return { valid: false, message: 'Please enter the operator name (shown on the label)' };
    }

    // ========== QUANTITY VALIDATION AGAINST REMAINING ==========
    // Same validation as data-entry: Check that FG quantity doesn't exceed (issuedQuantity - completedQuantity)
    if (currentJobData) {
        const issuedQty = currentJobData.issuedQuantity || 0;
        const completedQty = currentJobData.completedQuantity || 0;
        const plannedQty = currentJobData.plannedQuantity || 0;
        
        const remainingQty = Math.max(0, issuedQty - completedQty);
        
        console.log(`📊 FG Quantity Validation:`);
        console.log(`   Issued Qty: ${issuedQty}`);
        console.log(`   Completed Qty: ${completedQty}`);
        console.log(`   Remaining Qty: ${remainingQty}`);
        console.log(`   FG Entry Qty: ${data.fgQuantity}`);
        
        // Only validate if we have a positive remaining quantity to check against
        if (remainingQty > 0 && data.fgQuantity > remainingQty) {
            let errorMsg = `❌ Quantity Exceeds Remaining!\n\n`;
            
            if (issuedQty > 0) {
                errorMsg += `Issued Quantity: ${issuedQty.toLocaleString()}\n`;
            } else {
                errorMsg += `Planned Quantity: ${plannedQty.toLocaleString()}\n`;
            }
            errorMsg += `Already Completed: ${completedQty.toLocaleString()}\n`;
            errorMsg += `Remaining to Complete: ${remainingQty.toLocaleString()}\n\n`;
            errorMsg += `Your Entry: ${data.fgQuantity.toLocaleString()}\n\n`;
            errorMsg += `The FG quantity (${data.fgQuantity.toLocaleString()}) exceeds the remaining quantity (${remainingQty.toLocaleString()}).\n`;
            errorMsg += `Please reduce the FG quantity.`;
            
            return { valid: false, message: errorMsg };
        }
        
        // Warn if remaining is zero or negative
        if (remainingQty <= 0) {
            return { 
                valid: false, 
                message: `❌ No Remaining Quantity!\n\nIssued: ${issuedQty.toLocaleString()}\nCompleted: ${completedQty.toLocaleString()}\n\nAll quantity has already been completed for this job.`
            };
        }
    }
    
    return { valid: true };
}

// Show confirmation modal
function showConfirmModal(formData) {
    if (!elements.confirmModalBody || !elements.confirmModal) return;
    
    // Build confirmation HTML
    const confirmHTML = `
        <div class="confirm-item">
            <span class="confirm-label">Production Order</span>
            <span class="confirm-value highlight">${currentJobData?.jobNumber || '-'}</span>
        </div>
        <div class="confirm-item">
            <span class="confirm-label">FG Code</span>
            <span class="confirm-value">${currentJobData?.itemNo || '-'}</span>
        </div>
        <div class="confirm-item">
            <span class="confirm-label">Product</span>
            <span class="confirm-value">${currentJobData?.jobName || '-'}</span>
        </div>
        <div class="confirm-item">
            <span class="confirm-label">Inputs Used</span>
            <span class="confirm-value">${(formData.roleUsages || []).map((r) => `${r.batch_number}: ${formatKgsDisplay(r.quantity_used)}`).join('<br>')}</span>
        </div>
        <div class="confirm-item">
            <span class="confirm-label">FG Quantity${currentInventoryUOM ? ` (${currentInventoryUOM})` : ''}</span>
            <span class="confirm-value highlight">${formatQty(formData.fgQuantity)}</span>
        </div>
        <div class="confirm-item">
            <span class="confirm-label">Batch Width</span>
            <span class="confirm-value">${formData.batchWidth} mm</span>
        </div>
        <div class="confirm-item">
            <span class="confirm-label">Batch Length</span>
            <span class="confirm-value">${formData.batchLength} m</span>
        </div>
        <div class="confirm-item">
            <span class="confirm-label">QC Supervisor</span>
            <span class="confirm-value">${formData.qcSupervisor}</span>
        </div>
        <div class="confirm-item">
            <span class="confirm-label">Operator</span>
            <span class="confirm-value">${formData.operatorName}</span>
        </div>
        ${formData.remarks ? `
        <div class="confirm-item">
            <span class="confirm-label">Remarks</span>
            <span class="confirm-value">${formData.remarks}</span>
        </div>
        ` : ''}
        ${formData.pkdDetails ? `
        <div class="confirm-item">
            <span class="confirm-label">PKD Details</span>
            <span class="confirm-value">${formData.pkdDetails}</span>
        </div>
        ` : ''}
    `;
    
    elements.confirmModalBody.innerHTML = confirmHTML;
    elements.confirmModal.style.display = 'flex';
}

// Hide confirmation modal
function hideConfirmModal() {
    if (elements.confirmModal) {
        elements.confirmModal.style.display = 'none';
    }
}

// Confirm and submit
async function confirmAndSubmit() {
    hideConfirmModal();
    
    const formData = getFormData();
    
    // Disable submit button
    if (elements.submitBtn) {
        elements.submitBtn.disabled = true;
        elements.submitBtn.innerHTML = '<span>⏳</span> Submitting...';
    }
    
    try {
        // Prepare payload for API
        const payload = {
            poNumber: currentJobData?.jobNumber,
            jobNo: currentJobData?.jobNumber,
            absoluteEntry: currentJobData?.absoluteEntry,
            itemCode: currentJobData?.itemNo,
            productDescription: currentJobData?.jobName,
            customerName: currentJobData?.customerName || '',
            customerCode: currentJobData?.customerCode || '',
            itemCodeLabel: currentJobData?.itemCodeLabel || '',
            plannedQuantity: currentJobData?.plannedQuantity || 0,
            completedQuantity: currentJobData?.completedQuantity || 0,
            fgQuantity: formData.fgQuantity,
            U_Width: formData.batchWidth,
            U_Length: formData.batchLength,
            batchWidth: formData.batchWidth,
            batchLength: formData.batchLength,
            role_usages: formData.roleUsages,
            inventoryUOM: currentInventoryUOM || currentJobData?.inventoryUOM || '',
            qcSupervisor: formData.qcSupervisor,
            operatorName: formData.operatorName,
            remarks: formData.remarks,
            pkdDetails: formData.pkdDetails,
            entryTimestamp: new Date().toISOString()
        };
        
        console.log('📤 Submitting FG Entry:', payload);
        
        // Submit to API
        const response = await fetch(`${API_BASE_URL}/fg-entry`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();
        
        if (!response.ok || result.success === false) {
            throw new Error(
                result.message || result.sapError || result.error || 'Failed to submit FG entry'
            );
        }
        
        console.log('✅ FG Entry submitted successfully:', result);
        
        // Show success
        showSuccess(payload, result);
        
    } catch (error) {
        console.error('❌ Submission error:', error);
        alert(`Failed to submit FG entry: ${error.message}`);
        
        // Re-enable submit button
        if (elements.submitBtn) {
            elements.submitBtn.disabled = false;
            elements.submitBtn.innerHTML = '<span>✅</span> Submit FG Entry';
        }
    }
}

// Show success message
function showSuccess(payload, result) {
    const numLabels = result.labelsCount || 1;

    lastSubmittedEntry = {
        poNumber: payload.poNumber || currentJobData?.jobNumber || '',
        customerName: result.labelData?.customerName || currentJobData?.customerName || '',
        customerCode: result.labelData?.customerCode || currentJobData?.customerCode || '',
        itemDescription: result.labelData?.itemDescription || currentJobData?.jobName || '',
        fgCode: result.labelData?.fgCode || currentJobData?.itemNo || '',
        itemCodeLabel: result.labelData?.itemCodeLabel || currentJobData?.itemCodeLabel || '',
        jobNo: payload.poNumber || currentJobData?.jobNumber || '',
        quantity: result.labelData?.quantity ?? payload.fgQuantity,
        totalQuantity: result.labelData?.totalQuantity ?? payload.fgQuantity,
        inventoryUOM: result.labelData?.inventoryUOM || payload.inventoryUOM || currentInventoryUOM || 'KGS',
        packedOn: result.labelData?.packedOn || formatDateForLabel(new Date()),
        operator: result.labelData?.operator || formatLabelOperatorField(payload.qcSupervisor, payload.operatorName),
        batchNo: result.batchNumber || result.labelData?.batchNo || '',
        numLabels
    };
    
    // Determine print status
    let printStatusHTML = '';
    if (result.printResult?.previewPending) {
        printStatusHTML = `
            <div style="color: #38bdf8;">
                <strong>🖨️ Packing slip:</strong> Saved — preview opens below. Print or skip.
            </div>
        `;
    } else if (result.printResult?.success) {
            printStatusHTML = `
                <div style="color: #22c55e; font-weight: bold;">
                    <strong>🖨️ Labels Printed:</strong> ${result.printResult.printed}/${result.printResult.total} ✅
                </div>
            `;
    } else if (result.printResult) {
        printStatusHTML = `
            <div style="color: #f59e0b;">
                <strong>🖨️ Auto-Print:</strong> ${result.printResult.message || 'Not available'}
            </div>
            <div style="font-size: 0.85em; color: #94a3b8;">Use "Reprint Labels" button for manual printing</div>
        `;
    }

    // SAP-first: success screen only appears when SAP + local DB both succeeded
    const sapOk = !!result.sapSuccess;
    const sapStatusHTML = sapOk
        ? `<div style="color:#22c55e; font-weight:700;"><strong>SAP:</strong> Posted ✅</div>`
        : `<div style="color:#ef4444; font-weight:800;"><strong>SAP:</strong> NOT posted ❌</div>`;
    
    if (elements.successDetails) {
        elements.successDetails.innerHTML = `
            <div><strong>Production Order:</strong> ${payload.poNumber}</div>
            <div><strong>FG Quantity${currentInventoryUOM ? ` (${currentInventoryUOM})` : ''}:</strong> ${formatQty(payload.fgQuantity)}</div>
            <div><strong>QC Supervisor:</strong> ${payload.qcSupervisor}</div>
            <div><strong>Operator:</strong> ${payload.operatorName}</div>
            ${result.batchNumber ? `<div><strong>Batch Number:</strong> ${result.batchNumber}</div>` : ''}
            ${result.sapDocEntry ? `<div><strong>SAP Doc Entry:</strong> ${result.sapDocEntry}</div>` : ''}
            ${sapStatusHTML}
            <div><strong>Packing Slip:</strong> 1 label (${formatQty(payload.fgQuantity)}${currentInventoryUOM ? ` ${currentInventoryUOM}` : ''})</div>
            ${printStatusHTML}
        `;
    }
    
    // Update label count on button
    if (elements.labelCount) {
        elements.labelCount.textContent = numLabels;
    }
    
    // Update button text to indicate reprint
    if (elements.printLabelsBtn) {
        elements.printLabelsBtn.innerHTML = `<span>🖨️</span> Reprint Labels (<span id="label-count">${numLabels}</span>)`;
    }
    
    showSection('success');

    // Refresh input batch list so fully-used batches disappear from the dropdown
    fgSelectedInputs = [];
    if (currentJobData) {
        const submittedQty = Number(payload.fgQuantity) || 0;
        if (submittedQty > 0) {
            currentJobData.completedQuantity = (Number(currentJobData.completedQuantity) || 0) + submittedQty;
            const issued = Number(currentJobData.issuedQuantity) || 0;
            const completed = Number(currentJobData.completedQuantity) || 0;
            currentJobData.remainingQuantity = Math.max(0, issued - completed);
            const remEl = document.getElementById('remaining-quantity');
            if (remEl) remEl.textContent = formatQty(currentJobData.remainingQuantity);
            const compEl = document.getElementById('completed-quantity');
            if (compEl) compEl.textContent = formatQty(currentJobData.completedQuantity);
        }
        loadFgInputBatches(currentJobData);
    }

    showLabelPreviewModal();
}

function hideLabelPreviewModal() {
    if (elements.labelPreviewModal) {
        elements.labelPreviewModal.style.display = 'none';
    }
}

function showLabelPreviewModal() {
    if (!elements.labelPreviewModal || !lastSubmittedEntry) return;
    const n = lastSubmittedEntry.numLabels;
    if (elements.labelPreviewHint) {
        elements.labelPreviewHint.textContent =
            `Entry saved. Packing slip — total FG quantity in ${lastSubmittedEntry.inventoryUOM || 'KGS'}. Print or close.`;
    }
    if (elements.labelPreviewHost) {
        elements.labelPreviewHost.innerHTML =
            `<div class="label-preview-scale">${generateLabelHTML(lastSubmittedEntry, 1, n)}</div>`;
    }
    if (elements.labelPreviewPrintBtn) {
        elements.labelPreviewPrintBtn.disabled = false;
    }
    elements.labelPreviewModal.style.display = 'flex';
}

async function fetchLastBatchForPo(poNumber) {
    if (!poNumber) return '';
    try {
        const response = await fetch(`${API_BASE_URL}/fg-last-batch/${encodeURIComponent(poNumber)}`);
        if (!response.ok) return '';
        const json = await response.json();
        return (json.batchNumber || '').toString().trim();
    } catch {
        return '';
    }
}

async function buildLabelDataFromCurrentForm(batchNo = '') {
    const formData = getFormData();
    const uom = currentInventoryUOM || currentJobData?.inventoryUOM || 'KGS';
    return {
        customerName: currentJobData?.customerName || '',
        customerCode: currentJobData?.customerCode || '',
        itemDescription: currentJobData?.jobName || '',
        fgCode: currentJobData?.itemNo || '',
        itemCodeLabel: currentJobData?.itemCodeLabel || '',
        jobNo: currentJobData?.jobNumber || '',
        poNumber: currentJobData?.jobNumber || '',
        quantity: formData.fgQuantity,
        totalQuantity: formData.fgQuantity,
        inventoryUOM: uom,
        packedOn: formatDateForLabel(new Date()),
        operator: formatLabelOperatorField(formData.qcSupervisor, formData.operatorName),
        batchNo: batchNo || ''
    };
}

function getLabelQuantityLabel(data) {
    const uom = (data?.inventoryUOM || data?.uom || currentInventoryUOM || 'KGS').toString().trim();
    return uom ? `Quantity (${uom})` : 'Quantity';
}

function getLabelQuantityValue(data) {
    const qty = Number(data?.quantity ?? data?.totalQuantity ?? data?.fgQuantity);
    if (!Number.isFinite(qty) || qty <= 0) return '';
    return qty.toLocaleString();
}

function buildLabelDataForZebra() {
    if (!lastSubmittedEntry) return null;
    return {
        customerName: lastSubmittedEntry.customerName,
        customerCode: lastSubmittedEntry.customerCode,
        itemDescription: lastSubmittedEntry.itemDescription,
        fgCode: lastSubmittedEntry.fgCode,
        itemCodeLabel: lastSubmittedEntry.itemCodeLabel,
        poNumber: lastSubmittedEntry.poNumber || lastSubmittedEntry.jobNo,
        jobNo: lastSubmittedEntry.poNumber || lastSubmittedEntry.jobNo,
        processName: 'Finish Good',
        quantity: lastSubmittedEntry.quantity,
        totalQuantity: lastSubmittedEntry.totalQuantity,
        inventoryUOM: lastSubmittedEntry.inventoryUOM,
        packedOn: lastSubmittedEntry.packedOn,
        operator: lastSubmittedEntry.operator,
        batchNo: lastSubmittedEntry.batchNo
    };
}

async function sendLabelsToPrinter({ fromPreview = false, fromReprint = false } = {}) {
    const labelData = buildLabelDataForZebra();
    const numLabels = lastSubmittedEntry?.numLabels;
    if (!labelData || !numLabels) {
        alert('No label data for printing.');
        return;
    }

    const batch = labelData.batchNo || '';
    const ok = confirm(
        `Print ${numLabels} label(s) on the network label printer?\n\nBatch: ${batch}\n\nClick OK to print, or Cancel to go back to preview.`
    );
    if (!ok) return;

    const btn = fromPreview ? elements.labelPreviewPrintBtn : (fromReprint ? elements.printLabelsBtn : null);
    if (btn) btn.disabled = true;
    if (elements.labelPrintStatusExtra) {
        elements.labelPrintStatusExtra.style.display = 'block';
        elements.labelPrintStatusExtra.innerHTML = '<span style="color:#94a3b8">Sending to label printer…</span>';
    }

    try {
        console.log('🖨️ Sending labels to printer via server…', { numLabels, labelData });
        const response = await fetch(`${API_BASE_URL}/fg-print-labels`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ labelData, numLabels })
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || data.error || 'Print request failed');
        }
        const printResult = data.printResult;
        if (!printResult?.success) {
            throw new Error(printResult?.message || 'Print did not complete');
        }

        if (fromPreview) hideLabelPreviewModal();

        if (elements.labelPrintStatusExtra) {
            elements.labelPrintStatusExtra.style.display = 'block';
            elements.labelPrintStatusExtra.innerHTML =
                `<span style="color:#22c55e;font-weight:600">✅ Print successful — ${printResult.printed}/${printResult.total} label(s) sent to printer.</span>`;
        }
    } catch (err) {
        console.error('fg-print-labels:', err);
        if (elements.labelPrintStatusExtra) {
            elements.labelPrintStatusExtra.style.display = 'block';
            elements.labelPrintStatusExtra.innerHTML =
                `<span style="color:#ef4444;font-weight:600">❌ Print failed: ${err.message || 'Unknown error'}</span>`;
        } else {
            alert(err.message || 'Print failed');
        }
    } finally {
        if (btn) btn.disabled = false;
    }
}

/** @deprecated use sendLabelsToPrinter */
async function sendLabelPrintToZebra() {
    return sendLabelsToPrinter({ fromPreview: true });
}

function svgToPngDataUrl(svgString, widthPx, heightPx) {
    return new Promise((resolve, reject) => {
        const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = widthPx;
                canvas.height = heightPx;
                const ctx = canvas.getContext('2d');
                // White background
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, widthPx, heightPx);
                ctx.drawImage(img, 0, 0, widthPx, heightPx);
                URL.revokeObjectURL(url);
                resolve(canvas.toDataURL('image/png'));
            } catch (e) {
                URL.revokeObjectURL(url);
                reject(e);
            }
        };
        img.onerror = (e) => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to rasterize label layout'));
        };
        img.src = url;
    });
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read image'));
        reader.readAsDataURL(blob);
    });
}

async function inlineLabelImages(rootEl) {
    // Inline any <img> sources as data URLs so rasterization works reliably on tablets.
    const imgs = Array.from(rootEl.querySelectorAll('img'));
    for (const img of imgs) {
        const src = (img.getAttribute('src') || '').trim();
        if (!src) continue;
        // Skip already-inlined images
        if (src.startsWith('data:')) continue;
        try {
            const res = await fetch(src, { cache: 'no-store' });
            const blob = await res.blob();
            const dataUrl = await blobToDataUrl(blob);
            img.setAttribute('src', dataUrl);
        } catch (e) {
            // If inlining fails, hide the image (better than failing the whole print)
            console.warn('inlineLabelImages failed for', src, e);
            img.style.display = 'none';
        }
    }
}

async function renderCurrentLabelHtmlToPngDataUrl(labelHtml, widthMm = 150, heightMm = 100) {
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '-10000px';
    host.style.top = '0';
    host.style.width = `${widthMm}mm`;
    host.style.height = `${heightMm}mm`;
    host.style.background = '#fff';
    host.innerHTML = labelHtml;
    document.body.appendChild(host);

    try {
        await inlineLabelImages(host);

        // Prefer html2canvas (works on tablets). Fallback to SVG foreignObject if unavailable.
        if (typeof window.html2canvas === 'function') {
            const canvas = await window.html2canvas(host, {
                backgroundColor: '#ffffff',
                // Higher scale makes text/bars bolder after thresholding; keep moderate for barcode readability.
                scale: 1.25,
                useCORS: true,
                logging: false
            });
            return canvas.toDataURL('image/png');
        }

        // Fallback: SVG foreignObject (may fail on some tablet browsers)
        const cssPxPerMm = 96 / 25.4;
        const widthPx = Math.round(widthMm * cssPxPerMm);
        const heightPx = Math.round(heightMm * cssPxPerMm);
        const html = `
<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}">
  <foreignObject width="100%" height="100%">
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:${widthMm}mm;height:${heightMm}mm;background:#fff;">
      ${host.innerHTML}
    </div>
  </foreignObject>
</svg>`;
        return await svgToPngDataUrl(html, widthPx, heightPx);
    } finally {
        host.remove();
    }
}

// Rendered print (PNG -> ZPL) intentionally removed: it degrades barcode quality.

// Format date for label (DD/MM/YYYY)
function formatDateForLabel(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

// Browser-only print (local device dialog) — not the ZT411 label printer
function printLabelsOnThisDevice() {
    if (!lastSubmittedEntry) {
        alert('No entry data available for printing');
        return;
    }
    
    const { numLabels } = lastSubmittedEntry;
    
    // Generate label HTML
    let labelsHTML = '';
    for (let i = 1; i <= numLabels; i++) {
        labelsHTML += generateLabelHTML(lastSubmittedEntry, i, numLabels);
    }
    
    // Put labels in print container
    if (elements.labelPrintContainer) {
        elements.labelPrintContainer.innerHTML = labelsHTML;
        elements.labelPrintContainer.style.display = 'block';
        
        // Trigger print
        window.print();
        
        // Hide container after print dialog closes
        setTimeout(() => {
            elements.labelPrintContainer.style.display = 'none';
        }, 1000);
    }
}

function renderQrSvg(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const qrFactory = (typeof qrcode !== 'undefined' && qrcode) || null;
    if (!qrFactory) return '';
    try {
        const qr = qrFactory(0, 'M');
        qr.addData(text);
        qr.make();
        const svg = qr.createSvgTag(3, 2);
        return svg.replace('<svg ', '<svg class="qr-svg" ');
    } catch {
        return '';
    }
}

// Generate HTML for a single label (150mm x 100mm for Zebra ZT411 - Landscape)
function generateLabelHTML(data, boxNum, totalBoxes) {
    if (typeof ProcessLabelFormats !== 'undefined') {
        const qty = Number(data?.quantity ?? data?.totalQuantity);
        const labelData = ProcessLabelFormats.buildLabelDataFromFinish({
            job: {
                itemNo: data.fgCode,
                itemCode: data.fgCode,
                jobName: data.itemDescription,
                uPCode: 'FG',
                customerName: data.customerName
            },
            machineInfo: { process: 'Finish Good' },
            poNumber: data.poNumber || data.jobNo,
            outputBatch: data.batchNo,
            actualOutput: Number.isFinite(qty) ? qty : data.quantity,
            customerName: data.customerName,
            itemDescription: data.itemDescription,
            packedOn: data.packedOn
        });
        return ProcessLabelFormats.generateProcessLabelHTML(labelData);
    }

    const batchCode = (data.batchNo || '').toString().trim();
    const qrSvg = batchCode ? renderQrSvg(batchCode) : '';

    return `
        <div class="label-page">
          <div class="label-page-inner">
            <div class="sap-label process-output-label">
              <div class="sap-top">
                <div class="sap-logo">
                  <img class="sap-logo-bw" src="/vk-logo.png" alt="VK logo" onerror="this.style.display='none'">
                </div>
                <div class="sap-company">
                  <strong>VK GLOBAL DIGITAL PRIVATE LIMITED</strong>
                  15/1, MAIN MATHURA ROAD, SECTOR-31 FARIDABAD,<br/>
                  FARIDABAD - 121003, INDIA
                </div>
              </div>

              <div class="sap-title">PACKING SLIP</div>

              <div class="sap-fields">
                <table class="sap-table sap-fields-grid">
                  <colgroup>
                    <col class="col-k">
                    <col class="col-v">
                    <col class="col-barcode">
                  </colgroup>
                  <tr>
                    <td class="k">Customer Name</td>
                    <td class="v" colspan="2">${escapeHtml(data.customerName)}</td>
                  </tr>
                  <tr>
                    <td class="k">Item Description</td>
                    <td class="v" colspan="2">${escapeHtml(data.itemDescription)}</td>
                  </tr>
                  <tr>
                    <td class="k">FG Code</td>
                    <td class="v">${escapeHtml(data.fgCode)}</td>
                    <td class="barcode-cell" rowspan="6">
                      <div class="sap-barcode-title">Batch No</div>
                      <div class="sap-barcode sap-qr">
                        ${qrSvg}
                        <div class="code-text">${escapeHtml(batchCode)}</div>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td class="k">Job No</td>
                    <td class="v">${escapeHtml(data.jobNo)}</td>
                  </tr>
                  <tr>
                    <td class="k">${escapeHtml(getLabelQuantityLabel(data))}</td>
                    <td class="v">${escapeHtml(getLabelQuantityValue(data))}</td>
                  </tr>
                  <tr>
                    <td class="k">Packed On</td>
                    <td class="v">${escapeHtml(data.packedOn)}</td>
                  </tr>
                  <tr>
                    <td class="k">Process</td>
                    <td class="v">Finish Good</td>
                  </tr>
                  <tr>
                    <td class="k">Operator</td>
                    <td class="v">${escapeHtml(data.operator)}</td>
                  </tr>
                </table>
              </div>
            </div>
          </div>
        </div>
    `;
}

// Offline barcode (Code 39) for digits/uppercase + basic symbols
function renderCode39Svg(value) {
    const normalized = value.toUpperCase();
    const encoded = `*${normalized}*`;

    const patterns = {
        '0': 'nnnwwnwnn',
        '1': 'wnnwnnnnw',
        '2': 'nnwwnnnnw',
        '3': 'wnwwnnnnn',
        '4': 'nnnwwnnnw',
        '5': 'wnnwwnnnn',
        '6': 'nnwwwnnnn',
        '7': 'nnnwnnwnw',
        '8': 'wnnwnnwnn',
        '9': 'nnwwnnwnn',
        'A': 'wnnnnwnnw',
        'B': 'nnwnnwnnw',
        'C': 'wnwnnwnnn',
        'D': 'nnnnwwnnw',
        'E': 'wnnnwwnnn',
        'F': 'nnwnwwnnn',
        'G': 'nnnnnwwnw',
        'H': 'wnnnnwwnn',
        'I': 'nnwnnwwnn',
        'J': 'nnnnwwwnn',
        'K': 'wnnnnnnww',
        'L': 'nnwnnnnww',
        'M': 'wnwnnnnwn',
        'N': 'nnnnwnnww',
        'O': 'wnnnwnnwn',
        'P': 'nnwnwnnwn',
        'Q': 'nnnnnnwww',
        'R': 'wnnnnnwwn',
        'S': 'nnwnnnwwn',
        'T': 'nnnnwnwwn',
        'U': 'wwnnnnnnw',
        'V': 'nwwnnnnnw',
        'W': 'wwwnnnnnn',
        'X': 'nwnnwnnnw',
        'Y': 'wwnnwnnnn',
        'Z': 'nwwnwnnnn',
        '-': 'nwnnnnwnw',
        '.': 'wwnnnnwnn',
        ' ': 'nwwnnnwnn',
        '$': 'nwnwnwnnn',
        '/': 'nwnwnnnwn',
        '+': 'nwnnnwnwn',
        '%': 'nnnwnwnwn',
        '*': 'nwnnwnwnn'
    };

    const narrow = 1;
    const wide = 3;
    const gap = 1; // inter-character gap (narrow space)

    let x = 0;
    const bars = [];

    for (let i = 0; i < encoded.length; i++) {
        const ch = encoded[i];
        const pattern = patterns[ch];
        if (!pattern) continue;

        // pattern length 9: bar/space alternating starting with bar
        for (let j = 0; j < pattern.length; j++) {
            const isBar = j % 2 === 0;
            const w = pattern[j] === 'w' ? wide : narrow;
            if (isBar) {
                bars.push({ x, w });
            }
            x += w;
        }
        x += gap;
    }

    const height = 60; // svg units
    const width = Math.max(x, 1);
    const viewBox = `0 0 ${width} ${height}`;
    const rects = bars
        .map(b => `<rect x="${b.x}" y="0" width="${b.w}" height="${height}" fill="#000" />`)
        .join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="none">${rects}</svg>`;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Reset to search state
function resetToSearch() {
    currentJobData = null;
    lastSubmittedEntry = null;
    
    // Clear form
    clearForm();
    
    // Clear search input
    if (elements.poSearchInput) {
        elements.poSearchInput.value = '';
    }
    
    // Reset submit button
    if (elements.submitBtn) {
        elements.submitBtn.disabled = false;
        elements.submitBtn.innerHTML = '<span>✅</span> Submit FG Entry';
    }
    
    // Show search section
    showSection('search');
    
    // Focus on search input
    if (elements.poSearchInput) {
        elements.poSearchInput.focus();
    }
}

// Clear form
function clearForm() {
    if (elements.fgEntryForm) {
        elements.fgEntryForm.reset();
    }
    fgSelectedInputs = [];
    renderFgSelectedInputs();

    // Reset QC supervisor "other" field
    if (elements.otherQcGroup) {
        elements.otherQcGroup.style.display = 'none';
    }
    if (elements.otherQcInput) {
        elements.otherQcInput.required = false;
        elements.otherQcInput.value = '';
    }
}

// Show error message
function showError(message) {
    if (elements.errorMessage) {
        elements.errorMessage.textContent = message;
    }
    showSection('error');
}

// Show specific section
function showSection(section) {
    // Hide all sections
    if (elements.loadingSection) elements.loadingSection.style.display = 'none';
    if (elements.errorSection) elements.errorSection.style.display = 'none';
    if (elements.jobSection) elements.jobSection.style.display = 'none';
    if (elements.successSection) elements.successSection.style.display = 'none';
    
    // Show requested section
    switch (section) {
        case 'loading':
            if (elements.loadingSection) elements.loadingSection.style.display = 'flex';
            break;
        case 'error':
            if (elements.errorSection) elements.errorSection.style.display = 'flex';
            break;
        case 'job':
            if (elements.jobSection) elements.jobSection.style.display = 'flex';
            break;
        case 'success':
            if (elements.successSection) elements.successSection.style.display = 'block';
            break;
        case 'search':
        default:
            // Just show search section (always visible)
            break;
    }
}

// Format IST date time
function formatISTDateTime() {
    const now = new Date();
    const options = {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    };
    return now.toLocaleString('en-IN', options);
}

// Generate sample label for testing
function generateSampleLabel() {
    const sampleData = {
        customerName: 'ABC Pharmaceuticals Pvt Ltd',
        customerCode: 'CUST-12345',
        itemDescription: 'Premium Quality Printed Cartons for Medicine Packaging - 300gsm',
        fgCode: 'FG-2024-00123',
        jobNo: 'PO-2024-001234',
        quantity: 500,
        totalQuantity: 2500,
        packedOn: formatDateForLabel(new Date()),
            operator: 'Rajesh/Amit',
        batchNo: 'BATCH-2024-0313-001',
        numLabels: 5
    };
    
    // Generate label HTML
    const labelHTML = generateLabelHTML(sampleData, 1, 5);
    
    // Put label in print container
    if (elements.labelPrintContainer) {
        elements.labelPrintContainer.innerHTML = labelHTML;
        elements.labelPrintContainer.style.display = 'block';
        
        // Trigger print
        window.print();
        
        // Hide container after print dialog closes
        setTimeout(() => {
            elements.labelPrintContainer.style.display = 'none';
        }, 1000);
    }
    
    return sampleData;
}

// Preview sample label (without printing)
function previewSampleLabel() {
    const sampleData = {
        customerName: 'ABC Pharmaceuticals Pvt Ltd',
        customerCode: 'CUST-12345',
        itemDescription: 'Premium Quality Printed Cartons for Medicine Packaging - 300gsm',
        fgCode: 'FG-2024-00123',
        jobNo: 'PO-2024-001234',
        quantity: 500,
        totalQuantity: 2500,
        packedOn: formatDateForLabel(new Date()),
            operator: 'Rajesh/Amit',
        batchNo: 'BATCH-2024-0313-001',
        numLabels: 5
    };
    
    // Generate label HTML
    const labelHTML = generateLabelHTML(sampleData, 1, 5);
    
    // Put label in print container with preview mode
    if (elements.labelPrintContainer) {
        elements.labelPrintContainer.innerHTML = `
            <div style="text-align: center; margin-bottom: 15px;">
                <button onclick="document.getElementById('label-print-container').style.display='none'; document.getElementById('label-print-container').classList.remove('preview-mode');" 
                    style="padding: 10px 20px; background: #ef4444; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; margin-right: 10px;">
                    Close Preview
                </button>
                <button onclick="window.print();" 
                    style="padding: 10px 20px; background: #10b981; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px;">
                    Print Label
                </button>
            </div>
            ${labelHTML}
        `;
        elements.labelPrintContainer.classList.add('preview-mode');
        elements.labelPrintContainer.style.display = 'block';
    }
    
    return sampleData;
}

// Expose functions globally for console testing
window.generateSampleLabel = generateSampleLabel;
window.previewSampleLabel = previewSampleLabel;
