/**
 * Unit 1 process output label formats — FG-style layout (150mm × 100mm).
 * Each process has its own slip title; HTML structure matches finished-goods packing slip.
 */
(function (global) {
    const PROCESS_LABEL_CONFIG = {
        EMB: { slipTitle: 'EMBOSSING OUTPUT', quantityLabel: 'Output (KGS)', processName: 'Embossing' },
        MET: { slipTitle: 'METALLISATION OUTPUT', quantityLabel: 'Output (KGS)', processName: 'Metallisation' },
        COT: { slipTitle: 'COATING OUTPUT', quantityLabel: 'Output (KGS)', processName: 'Coating' },
        SLT: { slipTitle: 'SLITTING OUTPUT', quantityLabel: 'Output (KGS)', processName: 'Slitting' },
        REW: { slipTitle: 'REWINDING OUTPUT', quantityLabel: 'Output (KGS)', processName: 'Rewinding' },
        FG: { slipTitle: 'PROCESS OUTPUT', quantityLabel: 'Output (KGS)', processName: 'Finish Good' },
        default: { slipTitle: 'PROCESS OUTPUT', quantityLabel: 'Output (KGS)', processName: 'Process' }
    };

    /** Per-process HTML templates — same FG-style grid; title/labels from config above. */
    const PROCESS_LABEL_TEMPLATES = {
        EMB: renderStandardProcessLabel,
        MET: renderStandardProcessLabel,
        COT: renderStandardProcessLabel,
        SLT: renderStandardProcessLabel,
        REW: renderStandardProcessLabel,
        FG: renderFgProcessLabel,
        default: renderStandardProcessLabel
    };

    /** Display batch size: width in mm, length in m (stored values — no conversion). */
    function formatBatchDimensions(width, length) {
        const w = width != null && width !== '' && width !== '—' ? width : null;
        const l = length != null && length !== '' && length !== '—' ? length : null;
        if (w != null && l != null) return `${w} mm × ${l} m`;
        if (w != null) return `${w} mm`;
        if (l != null) return `${l} m`;
        return '—';
    }

    function escapeHtml(text) {
        if (text == null) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function inferProcessTag(job, machineInfo, outputBatch) {
        const batch = String(outputBatch || job?.batchNo || '').trim().toUpperCase();
        if (/^FG\d/.test(batch)) return 'FG';
        const u = String(job?.uPCode || '').toUpperCase();
        if (u === 'FG' || u.includes('FINISHED')) return 'FG';
        const procEarly = String(machineInfo?.process || job?.processName || '').toLowerCase();
        if (procEarly.includes('finished') || procEarly.includes('finish good') || procEarly.includes('final good')) return 'FG';
        if (u.includes('EMB')) return 'EMB';
        if (u.includes('MET') || u.includes('MTL')) return 'MET';
        if (u.includes('COT')) return 'COT';
        if (u.includes('SLT')) return 'SLT';
        if (u.includes('REW')) return 'REW';
        const proc = String(machineInfo?.process || '').toLowerCase();
        if (proc.includes('emboss')) return 'EMB';
        if (proc.includes('metall')) return 'MET';
        if (proc.includes('coat')) return 'COT';
        if (proc.includes('slit')) return 'SLT';
        if (proc.includes('rewind')) return 'REW';
        const item = String(job?.itemNo || job?.itemCode || '').toUpperCase();
        if (item.endsWith('-EMB')) return 'EMB';
        if (item.endsWith('-MET') || item.endsWith('-MTL')) return 'MET';
        if (item.endsWith('-COT')) return 'COT';
        if (item.endsWith('-SLT')) return 'SLT';
        if (item.endsWith('-REW')) return 'REW';
        return 'default';
    }

    function getConfig(processTag) {
        return PROCESS_LABEL_CONFIG[processTag] || PROCESS_LABEL_CONFIG.default;
    }

    function formatKgs(n) {
        const v = Number(n) || 0;
        return Math.abs(v - Math.round(v)) < 0.001 ? String(Math.round(v)) : v.toFixed(2);
    }

    function formatDimValue(n) {
        if (n == null || n === '') return '—';
        const v = Number(n);
        return Number.isFinite(v) ? formatKgs(v) : String(n);
    }

    function formatGrnDate(d) {
        if (!d) return '—';
        const dt = new Date(d);
        return isNaN(dt) ? String(d) : dt.toLocaleDateString('en-IN');
    }

    function formatMachineDisplayName(name) {
        const raw = String(name || '').trim();
        if (!raw) return '';
        return raw
            .split('-')
            .map((word) => {
                const w = word.trim();
                if (!w) return '';
                return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
            })
            .filter(Boolean)
            .join('-');
    }

    function formatProcessDisplayName(processTag, fallback) {
        const cfg = getConfig(processTag);
        if (cfg.processName) return cfg.processName;
        const fb = String(fallback || '').trim();
        if (fb) return fb.charAt(0).toUpperCase() + fb.slice(1).toLowerCase();
        return 'Process';
    }

    function buildLabelDataFromFinish({
        job,
        machineInfo,
        poNumber,
        outputBatch,
        actualOutput,
        roleUsages,
        operator,
        customerName,
        itemDescription,
        packedOn
    }) {
        const processTag = inferProcessTag(job, machineInfo, outputBatch);
        const cfg = getConfig(processTag);
        const batch = outputBatch || '';
        const barcodeValue = batch.toUpperCase().replace(/[^0-9A-Z \-\.\$\/\+%]/g, '');
        let packedOnStr = packedOn || '';
        if (!packedOnStr) {
            packedOnStr = new Date().toLocaleDateString('en-IN');
        } else if (packedOn instanceof Date || !isNaN(new Date(packedOn).getTime())) {
            const dt = new Date(packedOn);
            if (!isNaN(dt)) packedOnStr = dt.toLocaleDateString('en-IN');
        }
        return {
            processTag,
            slipTitle: cfg.slipTitle,
            quantityLabel: cfg.quantityLabel,
            customerName: customerName || job?.customerName || '',
            itemDescription: itemDescription || job?.jobName || job?.itemNo || '—',
            fgCode: job?.itemNo || job?.itemCode || '—',
            jobNo: poNumber || job?.poNumber || job?.jobNumber || '—',
            poNo: poNumber || job?.poNumber || job?.jobNumber || '—',
            batchNo: batch,
            quantity: formatKgs(actualOutput),
            packedOn: packedOnStr,
            operator: operator || '—',
            machineName: formatMachineDisplayName(machineInfo?.name) || machineInfo?.name || '—',
            processName: processTag === 'FG'
                ? cfg.processName
                : formatProcessDisplayName(processTag, machineInfo?.process),
            rolesUsed: Array.isArray(roleUsages) ? roleUsages : [],
            barcodeValue,
            barcodeDisplay: batch || job?.itemNo || ''
        };
    }

    /** QR code for batch — used on process output labels and FG packing slip. */
    function renderQrSvg(value) {
        const text = String(value || '').trim();
        if (!text) return '';
        const qrFactory = (typeof qrcode !== 'undefined' && qrcode) || null;
        if (!qrFactory) return renderCode39Svg(text);
        try {
            const qr = qrFactory(0, 'M');
            qr.addData(text);
            qr.make();
            const svg = qr.createSvgTag(3, 2);
            return svg.replace('<svg ', '<svg class="qr-svg" ');
        } catch {
            return renderCode39Svg(text);
        }
    }

    function renderCode39Svg(value) {
        const normalized = String(value || '').toUpperCase();
        if (!normalized) return '';
        const encoded = `*${normalized}*`;
        const patterns = {
            '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
            '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
            'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw', 'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw', 'E': 'wnnnwwnnn',
            'F': 'nnwnwwnnn', 'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn', 'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn',
            'K': 'wnnnnnnww', 'L': 'nnwnnnnww', 'M': 'wnwnnnnwn', 'N': 'nnnnwnnww', 'O': 'wnnnwnnwn',
            'P': 'nnwnwnnwn', 'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn', 'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn',
            'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw', 'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw', 'Y': 'wwnnwnnnn',
            'Z': 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn'
        };
        const narrow = 1;
        const wide = 3;
        let x = 0;
        const bars = [];
        for (let i = 0; i < encoded.length; i++) {
            const pattern = patterns[encoded[i]];
            if (!pattern) continue;
            for (let j = 0; j < pattern.length; j++) {
                if (j % 2 === 0) bars.push({ x, w: pattern[j] === 'w' ? wide : narrow });
                x += pattern[j] === 'w' ? wide : narrow;
            }
            x += 1;
        }
        const height = 60;
        const width = x;
        const rects = bars.map((b) => `<rect x="${b.x}" y="0" width="${b.w}" height="${height}" fill="#000"/>`).join('');
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${rects}</svg>`;
    }

    function rolesSummaryHtml(roles) {
        if (!roles.length) return '—';
        return roles.slice(0, 4).map((r) => {
            const bn = r.batch_number || r.batchNumber || '—';
            const q = formatKgs(r.quantity_used ?? r.quantityUsed ?? 0);
            return `${escapeHtml(bn)}: ${q} KGS`;
        }).join('<br/>') + (roles.length > 4 ? `<br/>+${roles.length - 4} more` : '');
    }

    /** FG-style process output label — matches packing slip layout (see finished-goods generateLabelHTML). */
    function renderStandardProcessLabel(data) {
        const batchCode = data.barcodeDisplay || data.batchNo || data.barcodeValue || '';
        const barcodeValue = data.barcodeValue || batchCode;
        const qrSvg = barcodeValue ? renderQrSvg(barcodeValue) : '';
        const poDisplay = data.poNo || data.jobNo || '—';
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
              <div class="sap-title">${escapeHtml(data.slipTitle || 'PROCESS OUTPUT')}</div>
              <div class="sap-fields">
                <table class="sap-table sap-fields-grid">
                  <colgroup>
                    <col class="col-k"><col class="col-v"><col class="col-barcode">
                  </colgroup>
                  <tr>
                    <td class="k">Item Description</td>
                    <td class="v" colspan="2">${escapeHtml(data.itemDescription)}</td>
                  </tr>
                  <tr>
                    <td class="k">FG Code</td>
                    <td class="v" colspan="2">${escapeHtml(data.fgCode)}</td>
                  </tr>
                  <tr>
                    <td class="k">PO No.</td>
                    <td class="v">${escapeHtml(poDisplay)}</td>
                    <td class="barcode-cell" rowspan="5">
                      <div class="sap-barcode-title">Batch No</div>
                      <div class="sap-barcode sap-qr">
                        ${qrSvg}
                        <div class="code-text">${escapeHtml(batchCode)}</div>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td class="k">${escapeHtml(data.quantityLabel || 'Output (KGS)')}</td>
                    <td class="v">${escapeHtml(data.quantity)} KGS</td>
                  </tr>
                  <tr>
                    <td class="k">Packed On</td>
                    <td class="v">${escapeHtml(data.packedOn)}</td>
                  </tr>
                  <tr>
                    <td class="k">Process</td>
                    <td class="v">${escapeHtml(data.processName)}</td>
                  </tr>
                  <tr>
                    <td class="k">Machine</td>
                    <td class="v">${escapeHtml(data.machineName)}</td>
                  </tr>
                </table>
              </div>
            </div>
          </div>
        </div>`;
    }

    /** FG label — process output layout without Customer Name or Machine. */
    function renderFgProcessLabel(data) {
        const batchCode = data.barcodeDisplay || data.batchNo || data.barcodeValue || '';
        const barcodeValue = data.barcodeValue || batchCode;
        const qrSvg = barcodeValue ? renderQrSvg(barcodeValue) : '';
        const poDisplay = data.poNo || data.jobNo || '—';
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
              <div class="sap-title">${escapeHtml(data.slipTitle || 'PROCESS OUTPUT')}</div>
              <div class="sap-fields">
                <table class="sap-table sap-fields-grid">
                  <colgroup>
                    <col class="col-k"><col class="col-v"><col class="col-barcode">
                  </colgroup>
                  <tr>
                    <td class="k">Item Description</td>
                    <td class="v" colspan="2">${escapeHtml(data.itemDescription)}</td>
                  </tr>
                  <tr>
                    <td class="k">FG Code</td>
                    <td class="v" colspan="2">${escapeHtml(data.fgCode)}</td>
                  </tr>
                  <tr>
                    <td class="k">PO No.</td>
                    <td class="v">${escapeHtml(poDisplay)}</td>
                    <td class="barcode-cell" rowspan="4">
                      <div class="sap-barcode-title">Batch No</div>
                      <div class="sap-barcode sap-qr">
                        ${qrSvg}
                        <div class="code-text">${escapeHtml(batchCode)}</div>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td class="k">${escapeHtml(data.quantityLabel || 'Output (KGS)')}</td>
                    <td class="v">${escapeHtml(data.quantity)} KGS</td>
                  </tr>
                  <tr>
                    <td class="k">Packed On</td>
                    <td class="v">${escapeHtml(data.packedOn)}</td>
                  </tr>
                  <tr>
                    <td class="k">Process</td>
                    <td class="v">${escapeHtml(data.processName || 'Finish Good')}</td>
                  </tr>
                </table>
              </div>
            </div>
          </div>
        </div>`;
    }

    function generateProcessLabelHTML(data) {
        const tag = data.processTag || inferProcessTag(
            { itemNo: data.fgCode, uPCode: data.uPCode || '', batchNo: data.batchNo },
            { process: data.processName },
            data.batchNo || data.outputBatch
        );
        const render = PROCESS_LABEL_TEMPLATES[tag] || PROCESS_LABEL_TEMPLATES.default;
        const cfg = getConfig(tag);
        const merged = {
            ...data,
            processTag: tag,
            slipTitle: data.slipTitle || cfg.slipTitle,
            quantityLabel: data.quantityLabel || cfg.quantityLabel,
            processName: tag === 'FG'
                ? (cfg.processName || 'Finish Good')
                : (data.processName || cfg.processName)
        };
        return render(merged);
    }

    function buildGrnLabelData(roll) {
        const batch = String(roll?.batchNo || roll?.batch_no || '').trim();
        const barcodeValue = batch.toUpperCase().replace(/[^0-9A-Z \-\.\$\/\+%]/g, '');
        const qty = roll?.balanceQty ?? roll?.balance_qty ?? roll?.quantity;
        return {
            slipTitle: 'GRN ROLL',
            itemDescription: roll?.itemDescription || roll?.item_description || '—',
            itemCode: roll?.itemCode || roll?.item_code || '—',
            fgCode: roll?.itemCode || roll?.item_code || '—',
            batchNo: batch,
            quantity: formatKgs(qty),
            packedOn: formatGrnDate(roll?.admissionDate || roll?.admission_date),
            batchWidth: roll?.width ?? null,
            batchLength: roll?.length ?? null,
            thickness: roll?.thickness ?? null,
            baseRollNo: roll?.baseRollNo || roll?.base_roll_no || '—',
            grade: roll?.grade || '—',
            supplierName: roll?.supplierName || roll?.supplier_name || '—',
            barcodeValue,
            barcodeDisplay: batch
        };
    }

    function renderGrnRollLabel(data) {
        const batchCode = data.barcodeDisplay || data.batchNo || data.barcodeValue || '';
        const barcodeValue = data.barcodeValue || batchCode;
        const qrSvg = barcodeValue ? renderQrSvg(barcodeValue) : '';
        const baseRoll = (data.baseRollNo != null && String(data.baseRollNo).trim() !== '' && data.baseRollNo !== '—')
            ? String(data.baseRollNo).trim()
            : '—';
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
                  15/1, MAIN MATHURA ROAD, SECTOR-31<br/>
                  FARIDABAD - 121003, INDIA
                </div>
              </div>
              <div class="sap-title">${escapeHtml(data.slipTitle || 'GRN ROLL')}</div>
              <div class="sap-fields">
                <table class="sap-table sap-fields-grid">
                  <colgroup>
                    <col class="col-k"><col class="col-v"><col class="col-barcode">
                  </colgroup>
                  <tr>
                    <td class="k">Description</td>
                    <td class="v" colspan="2">${escapeHtml(data.itemDescription)}</td>
                  </tr>
                  <tr>
                    <td class="k">Item No</td>
                    <td class="v" colspan="2">${escapeHtml(data.itemCode || data.fgCode)}</td>
                  </tr>
                  <tr>
                    <td class="k">Supplier</td>
                    <td class="v">${escapeHtml(data.supplierName || '—')}</td>
                    <td class="barcode-cell" rowspan="7">
                      <div class="sap-barcode-title">Roll No</div>
                      <div class="sap-barcode sap-qr">
                        ${qrSvg}
                        <div class="code-text">${escapeHtml(batchCode)}</div>
                        <div class="grn-base-roll">GRADE: ${escapeHtml(data.grade || '—')}</div>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td class="k">Qty (KGS)</td>
                    <td class="v">${escapeHtml(data.quantity)}</td>
                  </tr>
                  <tr>
                    <td class="k">MFG Date</td>
                    <td class="v">${escapeHtml(data.packedOn)}</td>
                  </tr>
                  <tr>
                    <td class="k">WIDTH (MM)</td>
                    <td class="v">${escapeHtml(formatDimValue(data.batchWidth))}</td>
                  </tr>
                  <tr>
                    <td class="k">LENGTH (M)</td>
                    <td class="v">${escapeHtml(formatDimValue(data.batchLength))}</td>
                  </tr>
                  <tr>
                    <td class="k">Thickness</td>
                    <td class="v">${escapeHtml(formatDimValue(data.thickness))}</td>
                  </tr>
                  <tr>
                    <td class="k">BASE ROLL</td>
                    <td class="v">${escapeHtml(baseRoll)}</td>
                  </tr>
                </table>
              </div>
            </div>
          </div>
        </div>`;
    }

    function generateGrnRollLabelHTML(rollOrData) {
        const data = rollOrData?.slipTitle || rollOrData?.barcodeValue
            ? rollOrData
            : buildGrnLabelData(rollOrData);
        return renderGrnRollLabel(data);
    }

    global.ProcessLabelFormats = {
        PROCESS_LABEL_CONFIG,
        PROCESS_LABEL_TEMPLATES,
        inferProcessTag,
        getConfig,
        buildLabelDataFromFinish,
        generateProcessLabelHTML,
        renderStandardProcessLabel,
        renderFgProcessLabel,
        buildGrnLabelData,
        renderGrnRollLabel,
        generateGrnRollLabelHTML,
        renderCode39Svg,
        renderQrSvg,
        formatMachineDisplayName,
        formatProcessDisplayName,
        formatBatchDimensions
    };
})(typeof window !== 'undefined' ? window : global);
