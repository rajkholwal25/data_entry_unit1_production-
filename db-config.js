// Database Configuration — MySQL (mysql2)
const mysql = require('mysql2/promise');
const path = require('path');

const VERBOSE_LOG = process.env.VERBOSE_LOG === 'true' || process.env.DEBUG_PO_LOG === 'true';
function vlog(...args) { if (VERBOSE_LOG) console.log(...args); }

const envPath = path.join(__dirname, '.env');
vlog('📁 Loading .env from:', envPath);
require('dotenv').config({ path: envPath });

const DATABASE_URL = process.env.DATABASE_URL || '';

vlog('🔧 Database Configuration (MySQL):');
if (DATABASE_URL) {
    vlog('   DATABASE_URL:', DATABASE_URL.replace(/:\/\/([^:]+):[^@]*@/, '://$1:****@'));
} else {
    vlog('   DB_HOST:', process.env.DB_HOST || '(not set — required on server)');
    vlog('   DB_PORT:', process.env.DB_PORT || '(not set, using 3306)');
    vlog('   DB_USER:', process.env.DB_USER || '(not set, using root)');
    vlog('   DB_NAME:', process.env.DB_NAME || '(not set, using sap)');
}

const mysqlPool = DATABASE_URL
    ? mysql.createPool({
        uri: DATABASE_URL,
        waitForConnections: true,
        connectionLimit: 10,
        charset: 'utf8mb4'
    })
    : mysql.createPool({
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT, 10) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'sap',
        waitForConnections: true,
        connectionLimit: 10,
        charset: 'utf8mb4'
    });

mysqlPool.on('error', (err) => {
    console.error('Unexpected MySQL pool error:', err.message);
});

async function query(sql, params = []) {
    return mysqlPool.query(sql, params);
}

async function getConnection() {
    const conn = await mysqlPool.getConnection();
    return {
        release: () => conn.release(),
        query: (sql, params = []) => conn.query(sql, params)
    };
}

const pool = {
    query,
    getConnection,
    end: () => mysqlPool.end()
};

async function columnExists(table, column) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    return Number(rows[0]?.c) > 0;
}

async function ensureColumn(table, column, definition) {
    if (!(await columnExists(table, column))) {
        await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    }
}

async function safeCreateIndex(name, sql) {
    try {
        await pool.query(sql);
    } catch (err) {
        if (err.code !== 'ER_DUP_KEYNAME') throw err;
    }
}

// ---------------------------------------------------------------------------
// Schema (idempotent) — tables / views the app relies on
// ---------------------------------------------------------------------------
async function ensureSchema() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS batch_num_seq (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS process_batch_seq (
            process_tag VARCHAR(8)  NOT NULL,
            last_seq    BIGINT UNSIGNED NOT NULL DEFAULT 26000000,
            PRIMARY KEY (process_tag)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS production_records (
            unique_id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            batch_num                  VARCHAR(40)     NULL,
            po_num                     VARCHAR(64)     NULL,
            fg_num                     VARCHAR(64)     NULL,
            job_name                   VARCHAR(255)    NULL,
            operator_name              VARCHAR(128)    NULL,
            shift_type                 VARCHAR(16)     NULL,
            machine_name               VARCHAR(128)    NULL,
            process_name               VARCHAR(64)     NULL,
            planned_qty                INT             DEFAULT 0,
            job_start_time             DATETIME        NULL,
            job_end_time               DATETIME        NULL,
            quantity_processed         INT             DEFAULT 0,
            role_quantity_used         DECIMAL(18,4)   NULL,
            chemical_quantity_used     DECIMAL(18,4)   NULL,
            speed_impressions_per_hour DECIMAL(18,4)   DEFAULT 0,
            sheets_wasted              INT             DEFAULT 0,
            remark                     TEXT            NULL,
            activity_name              VARCHAR(64)     NULL,
            activity_time_minutes      DECIMAL(18,4)   DEFAULT 0,
            device_id                  VARCHAR(64)     NULL,
            date_of_entry              DATETIME        DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (unique_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await safeCreateIndex('idx_pr_batch', 'CREATE INDEX idx_pr_batch ON production_records (batch_num)');
    await safeCreateIndex('idx_pr_po', 'CREATE INDEX idx_pr_po ON production_records (po_num)');
    await safeCreateIndex('idx_pr_fg', 'CREATE INDEX idx_pr_fg ON production_records (fg_num)');
    await safeCreateIndex('idx_pr_machine', 'CREATE INDEX idx_pr_machine ON production_records (machine_name)');

    try {
        const [colRows] = await pool.query(
            `SELECT CHARACTER_MAXIMUM_LENGTH AS len
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'production_records'
                AND COLUMN_NAME = 'batch_num'`
        );
        const colLen = Number(colRows[0]?.len) || 16;
        if (colLen < 40) {
            await pool.query('DROP VIEW IF EXISTS vw_shift_summary');
            await pool.query('DROP VIEW IF EXISTS vw_job_summary');
            await pool.query('DROP VIEW IF EXISTS vw_batch_summary');
            await pool.query('ALTER TABLE production_records MODIFY COLUMN batch_num VARCHAR(40)');
            vlog('   ✅ batch_num column widened to VARCHAR(40)');
        }
    } catch (err) {
        console.warn('⚠️ batch_num column widen failed:', err.message);
    }

    await ensureColumn('production_records', 'role_quantity_used', 'DECIMAL(18,4) NULL');
    await ensureColumn('production_records', 'chemical_quantity_used', 'DECIMAL(18,4) NULL');
    await ensureColumn('production_records', 'u_width', 'DECIMAL(18,4) NULL');
    await ensureColumn('production_records', 'u_length', 'DECIMAL(18,4) NULL');

    await pool.query(`
        CREATE TABLE IF NOT EXISTS po_customer_cache (
            po_num              VARCHAR(64)   NOT NULL,
            customer_name       VARCHAR(255)  NULL,
            customer_code       VARCHAR(64)   NULL,
            job_no              VARCHAR(64)   NULL,
            item_code           VARCHAR(64)   NULL,
            job_name            VARCHAR(255)  NULL,
            product_description VARCHAR(255)  NULL,
            inventory_uom       VARCHAR(32)   NULL,
            item_code_label     VARCHAR(64)   NULL,
            u_job_ent           VARCHAR(64)   NULL,
            u_pcode             VARCHAR(32)   NULL,
            absolute_entry      BIGINT        NULL,
            updated_at          DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (po_num)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await safeCreateIndex('idx_po_customer_cache_po', 'CREATE INDEX idx_po_customer_cache_po ON po_customer_cache (po_num)');
    for (const [col, def] of [
        ['customer_code', 'VARCHAR(64) NULL'],
        ['job_no', 'VARCHAR(64) NULL'],
        ['item_code', 'VARCHAR(64) NULL'],
        ['job_name', 'VARCHAR(255) NULL'],
        ['product_description', 'VARCHAR(255) NULL'],
        ['inventory_uom', 'VARCHAR(32) NULL'],
        ['item_code_label', 'VARCHAR(64) NULL'],
        ['u_job_ent', 'VARCHAR(64) NULL'],
        ['u_pcode', 'VARCHAR(32) NULL'],
        ['absolute_entry', 'BIGINT NULL']
    ]) {
        await ensureColumn('po_customer_cache', col, def);
    }
    try {
        await pool.query(
            'ALTER TABLE po_customer_cache MODIFY COLUMN customer_name VARCHAR(255) NULL'
        );
    } catch (_) { /* non-blocking */ }

    await pool.query('DROP VIEW IF EXISTS vw_shift_summary');
    await pool.query('DROP VIEW IF EXISTS vw_job_summary');
    await pool.query('DROP VIEW IF EXISTS vw_batch_summary');
    await pool.query('DROP TABLE IF EXISTS vw_shift_summary');
    await pool.query('DROP TABLE IF EXISTS vw_job_summary');
    await pool.query('DROP TABLE IF EXISTS vw_batch_summary');

    await pool.query(`
        CREATE VIEW vw_batch_summary AS
        SELECT batch_num,
               po_num,
               MAX(fg_num)                 AS fg_num,
               MAX(job_name)               AS job_name,
               MAX(machine_name)           AS machine_name,
               MAX(operator_name)          AS operator_name,
               MAX(shift_type)             AS shift_type,
               MIN(job_start_time)         AS job_start,
               MAX(job_end_time)           AS job_end,
               MAX(planned_qty)            AS planned_qty,
               MAX(quantity_processed)     AS quantity_processed,
               MAX(u_width)                AS u_width,
               MAX(u_length)               AS u_length,
               MAX(role_quantity_used)     AS role_quantity_used,
               MAX(chemical_quantity_used) AS chemical_quantity_used,
               SUM(sheets_wasted)          AS total_sheets_wasted,
               SUM(activity_time_minutes)  AS total_minutes,
               COUNT(*)                    AS activity_count
          FROM production_records
         WHERE po_num IS NOT NULL AND TRIM(po_num) <> ''
         GROUP BY batch_num, po_num
    `);

    await pool.query(`
        CREATE VIEW vw_job_summary AS
        SELECT batch_num,
               po_num,
               MAX(fg_num)                 AS fg_num,
               MAX(job_name)               AS job_name,
               MAX(machine_name)           AS machine_name,
               MAX(operator_name)          AS operator_name,
               MAX(shift_type)             AS shift_type,
               MAX(process_name)           AS process_name,
               MAX(planned_qty)            AS planned_qty,
               MAX(quantity_processed)     AS quantity_processed,
               MAX(u_width)                AS u_width,
               MAX(u_length)               AS u_length,
               MIN(job_start_time)         AS job_start_time,
               MAX(job_end_time)           AS job_end_time,
               SUM(sheets_wasted)          AS total_sheets_wasted,
               SUM(activity_time_minutes)  AS total_minutes,
               SUM(CASE WHEN activity_name = 'makeready' THEN activity_time_minutes ELSE 0 END) AS makeready_minutes,
               SUM(CASE WHEN activity_name = 'running'   THEN activity_time_minutes ELSE 0 END) AS running_minutes,
               COUNT(*)                    AS activity_count
          FROM production_records
         WHERE po_num IS NOT NULL AND TRIM(po_num) <> ''
         GROUP BY batch_num, po_num
    `);

    await pool.query(`
        CREATE VIEW vw_shift_summary AS
        SELECT machine_name,
               DATE(job_start_time)        AS shift_date,
               shift_type,
               COUNT(DISTINCT batch_num)   AS job_count,
               SUM(quantity_processed)     AS total_quantity,
               SUM(sheets_wasted)          AS total_sheets_wasted,
               SUM(activity_time_minutes)  AS total_minutes
          FROM production_records
         GROUP BY machine_name, DATE(job_start_time), shift_type
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS po_local_reset (
            po_num    VARCHAR(64) NOT NULL,
            reset_at  DATETIME    DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (po_num)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS material_issue_log (
            issue_id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            po_num          VARCHAR(64)     NULL,
            absolute_entry  BIGINT          NULL,
            line_number     INT             NULL,
            item_code       VARCHAR(64)     NULL,
            batch_number    VARCHAR(80)     NULL,
            quantity        DECIMAL(18,4)   DEFAULT 0,
            warehouse       VARCHAR(32)     NULL,
            operator_name   VARCHAR(128)    NULL,
            machine_name    VARCHAR(128)    NULL,
            sap_doc_entry   VARCHAR(64)     NULL,
            output_batch    VARCHAR(80)     NULL,
            remarks         TEXT            NULL,
            source_po_num   VARCHAR(64)     NULL,
            issued_at       DATETIME        DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (issue_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await safeCreateIndex('idx_mil_po', 'CREATE INDEX idx_mil_po ON material_issue_log (po_num)');
    await safeCreateIndex('idx_mil_batch', 'CREATE INDEX idx_mil_batch ON material_issue_log (batch_number)');
    await safeCreateIndex('idx_mil_output', 'CREATE INDEX idx_mil_output ON material_issue_log (output_batch)');

    await dedupeMaterialIssueLog();
    await safeCreateIndex('uq_mil_po_batch', 'CREATE UNIQUE INDEX uq_mil_po_batch ON material_issue_log (po_num, batch_number)');

    await pool.query(`
        CREATE TABLE IF NOT EXISTS role_batch_usage (
            usage_id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            po_num             VARCHAR(64)     NOT NULL,
            issue_id           BIGINT          NULL,
            input_batch_number VARCHAR(80)     NOT NULL,
            item_code          VARCHAR(64)     NULL,
            output_batch       VARCHAR(80)     NULL,
            quantity_used      DECIMAL(18,4)   NOT NULL DEFAULT 0,
            input_type         VARCHAR(20)     DEFAULT 'raw_roll',
            operator_name      VARCHAR(128)    NULL,
            machine_name       VARCHAR(128)    NULL,
            source_po_num      VARCHAR(64)     NULL,
            created_at         DATETIME        DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (usage_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await safeCreateIndex('idx_rbu_po', 'CREATE INDEX idx_rbu_po ON role_batch_usage (po_num)');
    await safeCreateIndex('idx_rbu_issue', 'CREATE INDEX idx_rbu_issue ON role_batch_usage (issue_id)');
    await safeCreateIndex('idx_rbu_output', 'CREATE INDEX idx_rbu_output ON role_batch_usage (output_batch)');
    await ensureColumn('role_batch_usage', 'input_type', "VARCHAR(20) DEFAULT 'raw_roll'");
    await ensureColumn('role_batch_usage', 'operator_name', 'VARCHAR(128) NULL');
    await ensureColumn('role_batch_usage', 'machine_name', 'VARCHAR(128) NULL');
    await ensureColumn('material_issue_log', 'source_po_num', 'VARCHAR(64) NULL');
    await ensureColumn('role_batch_usage', 'source_po_num', 'VARCHAR(64) NULL');

    try {
        await backfillRoleBatchUsageOperators();
    } catch (_) { /* non-blocking */ }

    vlog('✅ Production schema ready (production_records, material_issue_log, role_batch_usage, views, batch_num_seq)');
}

const GENERIC_OPERATOR_NAMES = new Set(['', 'Operator', 'Unknown']);

function isUsableOperatorName(name) {
    const v = String(name || '').trim();
    return v.length > 0 && !GENERIC_OPERATOR_NAMES.has(v);
}

/** Aggregated completion operator/machine per output batch (one row per batch_num). */
const PR_COMPLETION_SUBQUERY = `
    SELECT batch_num,
           MAX(CASE WHEN operator_name IS NOT NULL
                     AND TRIM(operator_name) NOT IN ('', 'Operator', 'Unknown')
                THEN operator_name END) AS operator_name,
           MAX(CASE WHEN machine_name IS NOT NULL AND TRIM(machine_name) <> ''
                THEN machine_name END) AS machine_name,
           MAX(quantity_processed) AS quantity_processed,
           MAX(fg_num) AS fg_num,
           MAX(process_name) AS process_name,
           MIN(job_start_time) AS job_start_time
      FROM production_records
     GROUP BY batch_num`;

/** Backfill report-completion operator on role_batch_usage from production_records. */
async function backfillRoleBatchUsageOperators(poNum = null) {
    const po = poNum != null ? String(poNum).trim() : '';
    const poClause = po ? 'AND rbu.po_num = ?' : '';
    const params = po ? [po] : [];
    const [result] = await pool.query(
        `UPDATE role_batch_usage rbu
            INNER JOIN (${PR_COMPLETION_SUBQUERY}) pr ON pr.batch_num = rbu.output_batch
            SET rbu.operator_name = COALESCE(
                    NULLIF(TRIM(rbu.operator_name), ''),
                    pr.operator_name
                ),
                rbu.machine_name = COALESCE(
                    NULLIF(TRIM(rbu.machine_name), ''),
                    pr.machine_name
                )
          WHERE (
                rbu.operator_name IS NULL OR TRIM(rbu.operator_name) = ''
                OR rbu.operator_name IN ('Operator', 'Unknown')
                OR rbu.machine_name IS NULL OR TRIM(rbu.machine_name) = ''
            )
            ${poClause}`,
        params
    );
    return result.affectedRows || 0;
}

async function resolveCompletionOperatorMeta(outputBatch, completionMeta = {}) {
    let operatorName = completionMeta.operator_name || completionMeta.operatorName || null;
    let machineName = completionMeta.machine_name || completionMeta.machineName || null;
    if ((!isUsableOperatorName(operatorName) || !machineName) && outputBatch) {
        const [rows] = await pool.query(
            `SELECT operator_name, machine_name
               FROM (${PR_COMPLETION_SUBQUERY}) pr
              WHERE pr.batch_num = ?
              LIMIT 1`,
            [String(outputBatch).trim()]
        );
        if (!isUsableOperatorName(operatorName)) {
            operatorName = rows[0]?.operator_name || operatorName;
        }
        if (!machineName) {
            machineName = rows[0]?.machine_name || machineName;
        }
    }
    return { operatorName: operatorName || null, machineName: machineName || null };
}

/** Display form: slitting-1 → Slitting-1 (title-case each hyphen segment). */
function formatMachineDisplayName(machineName) {
    const raw = String(machineName || '').trim();
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

/** Legacy chain — FG terminal detection only; material flow follows SAP BOM, not this order. */
const UNIT1_PROCESS_CHAIN = ['EMB', 'MET', 'COT', 'SLT', 'REW', 'FG'];

const UNIT1_AUX_MATERIAL_PREFIXES = ['PMT', 'FIL', 'ADH', 'RMC', 'TAP'];

function isUnit1AuxBomItemNo(itemNo) {
    const upper = String(itemNo || '').toUpperCase();
    return UNIT1_AUX_MATERIAL_PREFIXES.some((p) => upper.startsWith(p));
}

function isSapItemBomLine(line) {
    const itemType = line?.ItemType;
    return itemType === 'pit_Item' || itemType === 4 || String(itemType) === '4';
}

/**
 * Process-intermediate BOM lines from a PO (…-EMB, …-REW, …-MET, etc.).
 * Raw rolls (PMI / no process suffix) and aux consumables (ADH, FIL, …) are excluded.
 */
function extractUnit1ProcessBomInputs(productionOrderLines, headerItemNo) {
    const header = String(headerItemNo || '').trim().toUpperCase();
    const results = [];
    for (const line of productionOrderLines || []) {
        if (!isSapItemBomLine(line)) continue;
        const itemNo = String(line.ItemNo || line.ItemCode || '').trim();
        if (!itemNo) continue;
        const upper = itemNo.toUpperCase();
        if (header && upper === header) continue;
        if (upper.startsWith('ADH') || upper.startsWith('FIL')) continue;
        if (isUnit1AuxBomItemNo(itemNo)) continue;
        const processTag = inferUnit1ProcessTagFromItemCode(itemNo);
        if (!processTag) continue;
        if (Number(line.PlannedQuantity || 0) <= 0) continue;
        results.push({
            itemCode: upper,
            processTag,
            warehouse: line.Warehouse || line.WarehouseCode || null,
            lineNumber: line.LineNumber ?? null
        });
    }
    return results;
}

/** @deprecated Use extractUnit1ProcessBomInputs — kept for FG terminal index only. */
function getPreviousUnit1ProcessTag(processTag) {
    const t = String(processTag || '').toUpperCase();
    const i = UNIT1_PROCESS_CHAIN.indexOf(t);
    return i <= 0 ? null : UNIT1_PROCESS_CHAIN[i - 1];
}

function getUnit1ProcessChainIndex(processTag) {
    const i = UNIT1_PROCESS_CHAIN.indexOf(String(processTag || '').trim().toUpperCase());
    return i >= 0 ? i : -1;
}

/** True when this step is FG / end of chain — no auto-issue to a next process PO. */
function isTerminalUnit1Process(uPCode, itemCode) {
    const u = String(uPCode || '').toUpperCase();
    if (u.includes('FG') || u.includes('FINISHED')) return true;
    const tag = getUnit1ProcessBatchTag(uPCode, null, null, itemCode);
    const idx = getUnit1ProcessChainIndex(tag);
    return idx >= getUnit1ProcessChainIndex('FG');
}

/** Metallisation process tag (outsourced — inventory transfer/challan between adjacent POs). */
function isUnit1OutsourcedMetallisationProcess(uPCode) {
    const u = String(uPCode || '').toUpperCase();
    return u.includes('MET') || u.includes('MTL');
}

/**
 * Skip cross-PO auto-issue when stock must move via inventory transfer first:
 * - Into MET (e.g. REW complete → MET PO): transfer to FBD-MTL before issue on MET PO
 * - Out of MET (MET complete → next PO): transfer from FBD-MTL before issue on next PO
 * Running-time auto-issue on the current PO (component line warehouse) is still allowed.
 */
function shouldSkipUnit1CrossPoAutoIssue(sourceUPCode, nextUPCode) {
    if (isUnit1OutsourcedMetallisationProcess(nextUPCode)) return true;
    if (isUnit1OutsourcedMetallisationProcess(sourceUPCode)) return true;
    return false;
}

/** @deprecated BOM item match in U_JobEnt replaces fixed chain ordering for auto-issue. */
function isDownstreamUnit1Process(_nextTag, _currentTag) {
    return true;
}

// Test database connection
async function testConnection() {
    try {
        vlog('🔌 Attempting database connection...');
        const connection = await pool.getConnection();
        vlog('✅ Database connected successfully!');
        connection.release();
        // Make sure the schema the app needs exists.
        await ensureSchema();
        return true;
    } catch (error) {
        console.error('❌ Database connection failed!');
        console.error('   Error:', error.message);
        console.error('   Code:', error.code);
        if (error.code === 'ER_ACCESS_DENIED_ERROR') {
            console.error('   → Check username/password in DATABASE_URL (.env)');
        } else if (error.code === 'ECONNREFUSED') {
            console.error('   → MySQL server not running or not accessible');
        } else if (error.code === 'ER_BAD_DB_ERROR') {
            console.error('   → Database does not exist (check DATABASE_URL db name)');
        } else if (error.code === 'ENOTFOUND') {
            console.error('   → Invalid host address');
        }
        vlog('⚠️  App will continue without database (data saved locally)');
        return false;
    }
}

/** Global process batch sequence starts at 26000001 (EMB26000001, MET26000001, …). */
const UNIT1_BATCH_SEQ_START = 26000001;
const UNIT1_BATCH_SEQ_FLOOR = UNIT1_BATCH_SEQ_START - 1;
const VALID_PROCESS_BATCH_TAGS = new Set(['EMB', 'MET', 'SLT', 'REW', 'COT', 'FG']);

function normalizeProcessBatchTag(processTag) {
    const t = String(processTag || '').trim().toUpperCase();
    if (t === 'MTL') return 'MET';
    if (VALID_PROCESS_BATCH_TAGS.has(t)) return t;
    return t || 'EMB';
}

/** True for new global batches (EMB26000001) or legacy item-based (…-EMB-001). */
function isProcessBatchNumber(batchNumber, processTags = null) {
    const batch = String(batchNumber || '').trim().toUpperCase();
    if (!batch) return false;
    if (/^(EMB|MET|MTL|SLT|REW|COT|FG)\d{8}$/.test(batch)) return true;
    const tags = Array.isArray(processTags)
        ? processTags.map((t) => String(t || '').trim().toUpperCase()).filter(Boolean)
        : (processTags ? [String(processTags).trim().toUpperCase()] : []);
    const tagList = tags.length ? tags : ['EMB', 'MET', 'MTL', 'SLT', 'REW', 'COT', 'FG'];
    return tagList.some((t) => batch.includes(`-${t}-`));
}

/** Process prefix only (EMB, MET, SLT, REW, COT, FG). itemCode kept for API compatibility. */
function buildUnit1BatchPrefix(itemCode, processTag) {
    return normalizeProcessBatchTag(processTag ?? itemCode);
}

function formatProcessBatchNumber(processTag, seq) {
    const tag = normalizeProcessBatchTag(processTag);
    const n = Number(seq);
    if (!Number.isFinite(n) || n < UNIT1_BATCH_SEQ_START) {
        throw new Error(`Invalid batch sequence ${seq} for ${tag}`);
    }
    return `${tag}${String(n).padStart(8, '0')}`;
}

/** Infer process tag from FG item code suffix (e.g. …-ALO-COT, …-HRI-COT, …-TRI-COT → COT). */
function inferUnit1ProcessTagFromItemCode(itemCode) {
    const c = String(itemCode || '').trim().toUpperCase();
    if (c.endsWith('-COT')) return 'COT';
    if (c.endsWith('-EMB')) return 'EMB';
    if (c.endsWith('-MTL') || c.endsWith('-MET')) return 'MET';
    if (c.endsWith('-SLT')) return 'SLT';
    if (c.endsWith('-REW')) return 'REW';
    return null;
}

/** Resolve process tag for Unit 1 output batches (EMB, MET, SLT, REW, COT). */
function getUnit1ProcessBatchTag(uPCode, processName, machineName, itemCode) {
    const u = String(uPCode || '').toUpperCase();
    if (u.includes('COT')) return 'COT';
    if (u.includes('MET') || u.includes('MTL')) return 'MET';
    if (u.includes('SLT')) return 'SLT';
    if (u.includes('REW')) return 'REW';
    if (u.includes('EMB')) return 'EMB';
    if (u === 'FG' || u.includes('FINISHED')) return 'FG';

    const fromItem = inferUnit1ProcessTagFromItemCode(itemCode);
    if (fromItem) return fromItem;

    const machine = String(machineName || '').toLowerCase();
    if (machine.includes('emboss')) return 'EMB';
    if (machine.includes('metall')) return 'MET';
    if (machine.includes('slitting') || machine.startsWith('slt')) return 'SLT';
    if (machine.includes('rewind')) return 'REW';
    if (machine.includes('coat')) return 'COT';

    const proc = String(processName || '').toLowerCase();
    if (proc.includes('emboss')) return 'EMB';
    if (proc.includes('metall')) return 'MET';
    if (proc.includes('slitting')) return 'SLT';
    if (proc.includes('rewind')) return 'REW';
    if (proc.includes('coating')) return 'COT';

    return 'EMB';
}

/** Parse numeric seq from process batch (EMB26000001 → 26000001; legacy …-EMB-001 → 1). */
function parseUnit1BatchSeq(batchNumber, itemCode, processTag) {
    const tag = normalizeProcessBatchTag(processTag);
    const batch = String(batchNumber || '').trim().toUpperCase();
    if (!batch) return null;

    const newMatch = batch.match(/^(EMB|MET|MTL|SLT|REW|COT|FG)(\d{8})$/);
    if (newMatch) {
        const seqTag = normalizeProcessBatchTag(newMatch[1]);
        if (!tag || seqTag === tag) {
            return parseInt(newMatch[2], 10);
        }
        return null;
    }

    // Legacy item-based batch (PBP-12-1003-ALO-EMB-001) — kept for SAP/history lookup only.
    const code = String(itemCode || '').trim().toUpperCase();
    if (code && tag) {
        let legacyPrefix = code.endsWith(`-${tag}`) ? `${code}-` : `${code}-${tag}-`;
        if (batch.startsWith(legacyPrefix)) {
            const suffix = batch.slice(legacyPrefix.length);
            if (/^\d{3}$/.test(suffix)) {
                return parseInt(suffix, 10);
            }
        }
    }
    return null;
}

async function getMaxProcessBatchSeqFromRecords(processTag) {
    const tag = normalizeProcessBatchTag(processTag);
    const [rows] = await pool.query(
        `SELECT batch_num FROM production_records
         WHERE UPPER(batch_num) LIKE ?
         ORDER BY batch_num DESC
         LIMIT 500`,
        [`${tag}%`]
    );
    let maxSeq = 0;
    for (const row of rows || []) {
        const seq = parseUnit1BatchSeq(row.batch_num, null, tag);
        if (seq !== null && seq > maxSeq) maxSeq = seq;
    }
    return maxSeq;
}

/** Atomically allocate next global seq for a process tag (EMB, MET, …). */
async function allocateProcessBatchSeq(processTag, sapMaxSeq = 0) {
    const tag = normalizeProcessBatchTag(processTag);
    const recordMax = await getMaxProcessBatchSeqFromRecords(tag);
    const seed = Math.max(UNIT1_BATCH_SEQ_FLOOR, recordMax, Number(sapMaxSeq) || 0);

    const conn = await mysqlPool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query(
            `INSERT INTO process_batch_seq (process_tag, last_seq) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE last_seq = GREATEST(last_seq, ?)`,
            [tag, seed, seed]
        );
        await conn.query(
            `UPDATE process_batch_seq SET last_seq = last_seq + 1 WHERE process_tag = ?`,
            [tag]
        );
        const [rows] = await conn.query(
            `SELECT last_seq FROM process_batch_seq WHERE process_tag = ?`,
            [tag]
        );
        await conn.commit();
        return rows[0].last_seq;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

// Unit 1 / FG output batch: {TAG}{8-digit-seq} e.g. EMB26000001, FG26000002
async function getUnit1BatchNum(itemCode, processTag, poNum, startTime, sapMaxSeq = 0) {
    const tag = normalizeProcessBatchTag(processTag);
    if (!tag) {
        return getBatchNum(poNum, startTime, null);
    }

    vlog(`   🔢 Generating process batch: ${tag}########`);
    vlog(`      PO: ${poNum}, SAP max seq: ${sapMaxSeq}`);

    if (poNum && startTime) {
        const [existing] = await pool.query(
            `SELECT batch_num FROM production_records
             WHERE po_num = ? AND job_start_time = ?
             ORDER BY date_of_entry ASC LIMIT 1`,
            [poNum, startTime]
        );
        if (existing[0] && existing[0].batch_num) {
            vlog(`      ♻️  Reusing existing batch: ${existing[0].batch_num}`);
            return existing[0].batch_num;
        }
    }

    const nextSeq = await allocateProcessBatchSeq(tag, sapMaxSeq);
    const batchNum = formatProcessBatchNumber(tag, nextSeq);
    vlog(`      ✅ Generated process batch: ${batchNum}`);
    return batchNum;
}

// Get or generate batch number (legacy fallback — B000001).
// New Unit 1 / FG batches use getUnit1BatchNum (EMB26000001, FG26000001, …).
// Existing B* rows in production_records are never modified or deleted.
async function getBatchNum(poNum, startTime, endTime) {
    try {
        vlog(`   🔢 Generating batch number for PO: ${poNum}`);
        vlog(`      Start time: ${startTime}`);
        vlog(`      End time: ${endTime}`);

        if (poNum && startTime) {
            const [existing] = await pool.query(
                `SELECT batch_num FROM production_records
                 WHERE po_num = ? AND job_start_time = ?
                 ORDER BY date_of_entry ASC LIMIT 1`,
                [poNum, startTime]
            );
            if (existing[0] && existing[0].batch_num) {
                vlog(`      ♻️  Reusing existing batch number: ${existing[0].batch_num}`);
                return existing[0].batch_num;
            }
        }

        const [insertResult] = await pool.query('INSERT INTO batch_num_seq () VALUES ()');
        const [seq] = await pool.query(
            `SELECT CONCAT('B', LPAD(?, 6, '0')) AS batch_num`,
            [insertResult.insertId]
        );
        if (seq[0] && seq[0].batch_num) {
            vlog(`      ✅ Generated batch number: ${seq[0].batch_num}`);
            return seq[0].batch_num;
        }

        throw new Error('Failed to generate batch number');
    } catch (error) {
        console.error('Error getting batch number:', error);
        console.error('   Error code:', error.code);
        console.error('   Error message:', error.message);
        throw error;
    }
}

// Insert a production activity record
async function insertActivityRecord(data) {
    try {
        const batchNum = data.batch_num || await getBatchNum(
            data.po_num,
            data.job_start_time,
            data.job_end_time
        );

        const query = `
            INSERT INTO production_records 
            (batch_num, po_num, fg_num, job_name, operator_name, shift_type, machine_name, 
             process_name, planned_qty, job_start_time, job_end_time, quantity_processed,
             u_width, u_length,
             role_quantity_used, chemical_quantity_used,
             speed_impressions_per_hour, sheets_wasted, remark,
             activity_name, activity_time_minutes, device_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            batchNum,
            data.po_num || null,
            data.fg_num || null,
            data.job_name || null,
            data.operator_name || 'Operator',
            data.shift_type || 'day',
            data.machine_name || null,
            data.process_name || null,
            data.planned_qty || 0,
            data.job_start_time || null,
            data.job_end_time || null,
            data.quantity_processed || 0,
            data.u_width ?? data.U_Width ?? null,
            data.u_length ?? data.U_Length ?? null,
            data.role_quantity_used ?? null,
            data.chemical_quantity_used ?? null,
            data.speed_impressions_per_hour || 0,
            data.sheets_wasted || 0,
            data.remark || null,
            data.activity_name || null,
            data.activity_time_minutes || 0,
            data.device_id || null
        ];

        const [result] = await pool.query(query, values);
        return {
            unique_id: result.insertId,
            batch_num: batchNum
        };
    } catch (error) {
        console.error('Error inserting activity record:', error);
        throw error;
    }
}

// Insert multiple activity records for a job (batch insert)
async function resolveJobCompletionBatchNum(jobData) {
    const fgCode = (jobData.fg_num || jobData.item_no || '').trim();
    const processTag = jobData._batch_process_tag || getUnit1ProcessBatchTag(
        jobData.u_pcode || jobData.uPCode || jobData.process_code,
        jobData.process_name,
        jobData.machine_name,
        fgCode
    );
    if (jobData._preassigned_batch_num) {
        return String(jobData._preassigned_batch_num).trim();
    }
    if (jobData.use_item_code_batch || processTag === 'FG' || String(jobData.machine_name || '') === 'FG-Entry') {
        return getUnit1BatchNum(
            fgCode,
            processTag,
            jobData.po_num,
            jobData.job_start_time,
            Number(jobData._sap_batch_seq) || 0
        );
    }
    return getBatchNum(
        jobData.po_num,
        jobData.job_start_time,
        jobData.job_end_time
    );
}

async function insertJobActivities(jobData, activities) {
    try {
        const batchNum = await resolveJobCompletionBatchNum(jobData);

        const batchWidth = jobData.u_width ?? jobData.U_Width ?? null;
        const batchLength = jobData.u_length ?? jobData.U_Length ?? null;

        const rows = activities.map(activity => [
            batchNum,
            jobData.po_num,
            jobData.fg_num || null,
            jobData.job_name || null,
            jobData.operator_name || 'Operator',
            jobData.shift_type || 'day',
            jobData.machine_name || null,
            jobData.process_name || null,
            jobData.planned_qty || 0,
            jobData.job_start_time || null,
            jobData.job_end_time || null,
            jobData.quantity_processed || 0,
            batchWidth,
            batchLength,
            jobData.role_quantity_used ?? null,
            jobData.chemical_quantity_used ?? null,
            jobData.speed_impressions_per_hour || 0,
            jobData.sheets_wasted || 0,
            jobData.remark || null,
            activity.activity_name,
            activity.activity_time_minutes || 0,
            jobData.device_id || null
        ]);

        if (rows.length === 0) {
            return { batch_num: batchNum, inserted: 0 };
        }

        const COLS = 22;
        const placeholders = rows
            .map(() => `(${new Array(COLS).fill('?').join(', ')})`)
            .join(', ');

        const query = `
            INSERT INTO production_records 
            (batch_num, po_num, fg_num, job_name, operator_name, shift_type, machine_name, 
             process_name, planned_qty, job_start_time, job_end_time, quantity_processed,
             u_width, u_length,
             role_quantity_used, chemical_quantity_used,
             speed_impressions_per_hour, sheets_wasted, remark,
             activity_name, activity_time_minutes, device_id)
            VALUES ${placeholders}
        `;

        const [result] = await pool.query(query, rows.flat());
        return {
            batch_num: batchNum,
            inserted: result.affectedRows
        };
    } catch (error) {
        console.error('Error inserting job activities:', error);
        throw error;
    }
}

// Get all activities for a batch
async function getActivitiesByBatchNum(batchNum) {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM production_records WHERE batch_num = ? ORDER BY date_of_entry',
            [batchNum]
        );
        return rows;
    } catch (error) {
        console.error('Error fetching activities:', error);
        throw error;
    }
}

/** Sum actual output (KGS) from finish reports for one PO only — one row per output batch. */
async function sumCompletedQtyByPO(poNum) {
    const po = String(poNum || '').trim();
    if (!po) return 0;
    try {
        const [rows] = await pool.query(
            `SELECT COALESCE(SUM(batch_qty), 0) AS total
               FROM (
                   SELECT MAX(quantity_processed) AS batch_qty
                     FROM production_records
                    WHERE po_num = ?
                    GROUP BY batch_num
               ) per_batch`,
            [po]
        );
        return Number(rows[0]?.total) || 0;
    } catch (error) {
        console.error('Error summing completed qty for PO:', error);
        throw error;
    }
}

/** Sum wastage (KGS) from finish reports for one PO — one row per output batch. */
async function sumWastageQtyByPO(poNum) {
    const po = String(poNum || '').trim();
    if (!po) return 0;
    try {
        const [rows] = await pool.query(
            `SELECT COALESCE(SUM(batch_waste), 0) AS total
               FROM (
                   SELECT MAX(sheets_wasted) AS batch_waste
                     FROM production_records
                    WHERE po_num = ?
                    GROUP BY batch_num
               ) per_batch`,
            [po]
        );
        return Number(rows[0]?.total) || 0;
    } catch (error) {
        console.error('Error summing wastage for PO:', error);
        throw error;
    }
}

// Get all finish-report batches for a PO (strict po_num filter — no cross-PO mixing)
async function getBatchesByPO(poNum) {
    const po = String(poNum || '').trim();
    if (!po) return [];
    try {
        const [rows] = await pool.query(
            `SELECT batch_num,
                    po_num,
                    MAX(fg_num)                 AS fg_num,
                    MAX(job_name)               AS job_name,
                    MAX(machine_name)           AS machine_name,
                    MAX(operator_name)        AS operator_name,
                    MAX(shift_type)             AS shift_type,
                    MIN(job_start_time)         AS job_start,
                    MAX(job_end_time)           AS job_end,
                    MAX(planned_qty)            AS planned_qty,
                    MAX(quantity_processed)     AS quantity_processed,
                    MAX(role_quantity_used)     AS role_quantity_used,
                    MAX(chemical_quantity_used) AS chemical_quantity_used,
                    SUM(sheets_wasted)            AS total_sheets_wasted,
                    SUM(activity_time_minutes)    AS total_minutes,
                    COUNT(*)                      AS activity_count
               FROM production_records
              WHERE po_num = ?
              GROUP BY batch_num, po_num
              ORDER BY job_start IS NULL, job_start DESC`,
            [po]
        );
        return rows;
    } catch (error) {
        console.error('Error fetching batches:', error);
        throw error;
    }
}

/** Cumulative embossing role/chemical from finish reports on this PO only. */
async function getEmbossingQuantitiesByPO(poNum) {
    const po = String(poNum || '').trim();
    if (!po) {
        return { roleUsed: 0, chemicalUsed: 0, trackedBatches: 0 };
    }
    try {
        const [rows] = await pool.query(
            `SELECT
                COALESCE(SUM(CASE WHEN batch_role > 0 THEN batch_role ELSE 0 END), 0) AS role_used,
                COALESCE(SUM(CASE WHEN batch_chem > 0 THEN batch_chem ELSE 0 END), 0) AS chemical_used,
                SUM(CASE WHEN batch_chem > 0 OR batch_role > 0 THEN 1 ELSE 0 END) AS tracked_batches
             FROM (
                SELECT MAX(role_quantity_used)     AS batch_role,
                       MAX(chemical_quantity_used) AS batch_chem
                  FROM production_records
                 WHERE po_num = ?
                 GROUP BY batch_num
             ) per_batch`,
            [po]
        );
        const row = rows[0] || {};
        return {
            roleUsed: Number(row.role_used) || 0,
            chemicalUsed: Number(row.chemical_used) || 0,
            trackedBatches: Number(row.tracked_batches) || 0
        };
    } catch (error) {
        console.error('Error fetching embossing quantities:', error);
        throw error;
    }
}

// Get job summary using view
async function getJobSummary(batchNum) {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM vw_job_summary WHERE batch_num = ?',
            [batchNum]
        );
        return rows[0] || null;
    } catch (error) {
        console.error('Error fetching job summary:', error);
        throw error;
    }
}

// Get shift summary
async function getShiftSummary(machineName, date, shiftType) {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM vw_shift_summary WHERE machine_name = ? AND shift_date = ? AND shift_type = ?',
            [machineName, date, shiftType]
        );
        return rows[0] || null;
    } catch (error) {
        console.error('Error fetching shift summary:', error);
        throw error;
    }
}

// Get activities by machine and date
async function getActivitiesByMachineAndDate(machineName, date) {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM production_records WHERE machine_name = ? AND DATE(job_start_time) = ? ORDER BY job_start_time, batch_num',
            [machineName, date]
        );
        return rows;
    } catch (error) {
        console.error('Error fetching activities:', error);
        throw error;
    }
}

// Update activity record
async function updateActivityRecord(uniqueId, data) {
    try {
        const updates = [];
        const values = [];

        const allowedFields = [
            'activity_time_minutes', 'quantity_processed', 'speed_impressions_per_hour',
            'sheets_wasted', 'remark', 'job_end_time'
        ];

        allowedFields.forEach(field => {
            if (data[field] !== undefined) {
                updates.push(`${field} = ?`);
                values.push(data[field]);
            }
        });

        if (updates.length === 0) {
            return false;
        }

        values.push(uniqueId);
        const query = `UPDATE production_records SET ${updates.join(', ')} WHERE unique_id = ?`;

        const [result] = await pool.query(query, values);
        return result.affectedRows > 0;
    } catch (error) {
        console.error('Error updating activity record:', error);
        throw error;
    }
}

// Update all activities in a batch (for job completion)
async function updateBatchActivities(batchNum, data) {
    try {
        const updates = [];
        const values = [];

        const allowedFields = [
            'job_end_time', 'quantity_processed', 'speed_impressions_per_hour',
            'sheets_wasted', 'remark'
        ];

        allowedFields.forEach(field => {
            if (data[field] !== undefined) {
                updates.push(`${field} = ?`);
                values.push(data[field]);
            }
        });

        if (updates.length === 0) {
            return false;
        }

        values.push(batchNum);
        const query = `UPDATE production_records SET ${updates.join(', ')} WHERE batch_num = ?`;

        const [result] = await pool.query(query, values);
        return result.affectedRows > 0;
    } catch (error) {
        console.error('Error updating batch activities:', error);
        throw error;
    }
}

// Delete activity record
async function deleteActivityRecord(uniqueId) {
    try {
        const [result] = await pool.query(
            'DELETE FROM production_records WHERE unique_id = ?',
            [uniqueId]
        );
        return result.affectedRows > 0;
    } catch (error) {
        console.error('Error deleting activity record:', error);
        throw error;
    }
}

// Delete all activities in a batch
async function deleteBatch(batchNum) {
    try {
        const [result] = await pool.query(
            'DELETE FROM production_records WHERE batch_num = ?',
            [batchNum]
        );
        return result.affectedRows > 0;
    } catch (error) {
        console.error('Error deleting batch:', error);
        throw error;
    }
}

/** Delete all local production records for a PO (not SAP — local DB only). */
async function deleteRecordsByPO(poNum) {
    const po = String(poNum || '').trim();
    if (!po) return { deleted: 0, batches: [] };

    const [batchRows] = await pool.query(
        `SELECT DISTINCT batch_num FROM production_records WHERE po_num = ? ORDER BY batch_num`,
        [po]
    );
    const batches = (batchRows || []).map((r) => r.batch_num).filter(Boolean);

    const [result] = await pool.query(
        'DELETE FROM production_records WHERE po_num = ?',
        [po]
    );

    await markPOLocalReset(po);

    return {
        deleted: result.affectedRows || 0,
        batches
    };
}

/** Mark PO so Already Done shows 0 until next successful SAP completion. */
async function markPOLocalReset(poNum) {
    const po = String(poNum || '').trim();
    if (!po) return;
    await pool.query(
        `INSERT INTO po_local_reset (po_num, reset_at) VALUES (?, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE reset_at = CURRENT_TIMESTAMP`,
        [po]
    );
}

async function clearPOLocalReset(poNum) {
    const po = String(poNum || '').trim();
    if (!po) return;
    await pool.query('DELETE FROM po_local_reset WHERE po_num = ?', [po]);
}

async function isPOLocallyReset(poNum) {
    const po = String(poNum || '').trim();
    if (!po) return false;
    const [rows] = await pool.query(
        'SELECT po_num FROM po_local_reset WHERE po_num = ? LIMIT 1',
        [po]
    );
    return !!(rows && rows[0]);
}

// Get best historical performance for a finished goods number (fg_num)
// Returns minimum MakeReady time and minimum per-unit running time from past jobs
async function getBestPerformance(fgNum, machineName = null) {
    try {
        const whereClause = 'fg_num = ?';
        const params = [fgNum];

        const makeReadyQuery = `
            SELECT 
                MIN(activity_time_minutes) as best_makeready_minutes,
                COUNT(DISTINCT batch_num) as job_count
            FROM production_records 
            WHERE ${whereClause}
              AND activity_name = 'makeready'
              AND activity_time_minutes >= 1
        `;

        const bestMakeReadyMachineQuery = `
            SELECT machine_name, activity_time_minutes
            FROM production_records 
            WHERE ${whereClause}
              AND activity_name = 'makeready'
              AND activity_time_minutes >= 1
            ORDER BY activity_time_minutes ASC
            LIMIT 1
        `;

        const runningQuery = `
            SELECT 
                MIN(activity_time_minutes / NULLIF(quantity_processed, 0)) as best_running_per_unit,
                AVG(activity_time_minutes / NULLIF(quantity_processed, 0)) as avg_running_per_unit
            FROM production_records 
            WHERE ${whereClause}
              AND activity_name = 'running'
              AND activity_time_minutes >= 1
              AND quantity_processed > 0
        `;

        const bestRunningMachineQuery = `
            SELECT 
                machine_name,
                activity_time_minutes,
                quantity_processed,
                (activity_time_minutes / NULLIF(quantity_processed, 0)) as running_per_unit
            FROM production_records 
            WHERE ${whereClause}
              AND activity_name = 'running'
              AND activity_time_minutes >= 1
              AND quantity_processed > 0
            ORDER BY running_per_unit ASC
            LIMIT 1
        `;

        const speedQuery = `
            SELECT 
                MAX(speed_impressions_per_hour) as best_speed,
                AVG(speed_impressions_per_hour) as avg_speed
            FROM production_records 
            WHERE ${whereClause}
              AND speed_impressions_per_hour > 0
            GROUP BY fg_num
        `;

        const [makeReadyResult] = await pool.query(makeReadyQuery, params);
        const [bestMakeReadyMachineResult] = await pool.query(bestMakeReadyMachineQuery, params);
        const [runningResult] = await pool.query(runningQuery, params);
        const [bestRunningMachineResult] = await pool.query(bestRunningMachineQuery, params);
        const [speedResult] = await pool.query(speedQuery, params);

        const makeReadyData = makeReadyResult[0] || {};
        const bestMakeReadyMachine = bestMakeReadyMachineResult[0] || {};
        const runningData = runningResult[0] || {};
        const bestRunningMachine = bestRunningMachineResult[0] || {};
        const speedData = speedResult[0] || {};

        return {
            fgNum: fgNum,
            machineName: machineName,
            hasHistory: (makeReadyData.job_count || 0) > 0,
            jobCount: parseInt(makeReadyData.job_count, 10) || 0,
            bestMakeReadyMinutes: parseFloat(makeReadyData.best_makeready_minutes) || null,
            bestMakeReadyMachine: bestMakeReadyMachine.machine_name || null,
            bestRunningPerUnit: parseFloat(runningData.best_running_per_unit) || null,
            avgRunningPerUnit: parseFloat(runningData.avg_running_per_unit) || null,
            bestRunningMachine: bestRunningMachine.machine_name || null,
            bestSpeed: parseFloat(speedData.best_speed) || null,
            avgSpeed: parseFloat(speedData.avg_speed) || null
        };
    } catch (error) {
        console.error('Error fetching best performance:', error);
        throw error;
    }
}

// Detect duplicate submit (same PO + start time + qty within 2 minutes)
async function findRecentDuplicateJobCompletion(poNum, jobStartTime, quantityProcessed) {
    if (!poNum || !jobStartTime) return null;
    try {
        const [rows] = await pool.query(
            `SELECT batch_num, MAX(job_end_time) AS job_end_time
             FROM production_records
             WHERE po_num = ? AND job_start_time = ? AND quantity_processed = ?
               AND job_end_time >= NOW() - INTERVAL 2 MINUTE
             GROUP BY batch_num
             ORDER BY job_end_time DESC
             LIMIT 1`,
            [String(poNum), jobStartTime, Number(quantityProcessed) || 0]
        );
        return rows[0] || null;
    } catch (error) {
        console.warn('Duplicate job check failed:', error.message);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Material issue traceability (input rolls/batches → output batch genealogy)
// ---------------------------------------------------------------------------

/**
 * Merge duplicate material_issue_log rows (same PO + batch from app issue + SAP backfill).
 * Keeps earliest issue_id; sums qty across different SAP docs, MAX for same doc replay.
 */
async function dedupeMaterialIssueLog(poNum) {
    try {
        const poFilter = poNum != null ? 'WHERE po_num = ?' : '';
        const params = poNum != null ? [String(poNum)] : [];
        const [dupes] = await pool.query(
            `SELECT po_num, batch_number
               FROM material_issue_log
              ${poFilter}
              GROUP BY po_num, batch_number
             HAVING COUNT(*) > 1`,
            params
        );
        if (!dupes.length) return 0;

        let removed = 0;
        for (const d of dupes) {
            const [rows] = await pool.query(
                `SELECT issue_id, quantity, sap_doc_entry, output_batch, remarks,
                        warehouse, operator_name, machine_name, absolute_entry, line_number, item_code
                   FROM material_issue_log
                  WHERE po_num = ? AND batch_number = ?
                  ORDER BY issue_id ASC`,
                [d.po_num, d.batch_number]
            );
            if (rows.length < 2) continue;

            const keeper = rows[0];
            const keeperId = keeper.issue_id;
            let mergedQty = Number(keeper.quantity) || 0;
            let sapDoc = keeper.sap_doc_entry;
            let outputBatch = keeper.output_batch;
            let remarks = keeper.remarks;
            const seenSapDocs = new Set(sapDoc ? [String(sapDoc)] : []);

            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                const rowQty = Number(row.quantity) || 0;
                const rowDoc = row.sap_doc_entry != null ? String(row.sap_doc_entry) : '';
                if (rowDoc && seenSapDocs.has(rowDoc)) {
                    mergedQty = Math.max(mergedQty, rowQty);
                } else {
                    if (rowDoc) seenSapDocs.add(rowDoc);
                    mergedQty += rowQty;
                }
                if (!sapDoc && row.sap_doc_entry) sapDoc = row.sap_doc_entry;
                if (!outputBatch && row.output_batch) outputBatch = row.output_batch;
                if ((!remarks || String(remarks).includes('Backfilled')) && row.remarks
                    && !String(row.remarks).includes('Backfilled')) {
                    remarks = row.remarks;
                }
            }

            await pool.query(
                `UPDATE material_issue_log
                    SET quantity = ?,
                        sap_doc_entry = COALESCE(sap_doc_entry, ?),
                        output_batch = COALESCE(NULLIF(output_batch, ''), ?),
                        remarks = COALESCE(?, remarks)
                  WHERE issue_id = ?`,
                [mergedQty, sapDoc, outputBatch, remarks, keeperId]
            );

            const dupeIds = rows.slice(1).map((r) => r.issue_id);
            for (const dupeId of dupeIds) {
                await pool.query(
                    `UPDATE role_batch_usage SET issue_id = ? WHERE issue_id = ?`,
                    [keeperId, dupeId]
                );
            }
            const placeholders = dupeIds.map(() => '?').join(',');
            const [del] = await pool.query(
                `DELETE FROM material_issue_log WHERE issue_id IN (${placeholders})`,
                dupeIds
            );
            removed += del.affectedRows || 0;
        }
        if (removed > 0) {
            vlog(`🧹 Deduped material_issue_log: removed ${removed} duplicate row(s)${poNum ? ` for PO ${poNum}` : ''}`);
        }
        return removed;
    } catch (error) {
        console.warn('⚠️ dedupeMaterialIssueLog failed (non-blocking):', error.message);
        return 0;
    }
}

/** Record one issued roll/batch against a PO. Skips duplicate (po, batch). Best-effort; never throws. */
async function recordMaterialIssue(entry) {
    return recordMaterialIssueIfAbsent(entry);
}

/** Record many issued batches at once for a PO. Best-effort. */
async function recordMaterialIssues(common, allocations) {
    if (!Array.isArray(allocations) || allocations.length === 0) return 0;
    let count = 0;
    for (const a of allocations) {
        const id = await recordMaterialIssue({
            ...common,
            batch_number: a.batch_number || a.batchNumber || a.batch || a.BatchNumber,
            quantity: a.quantity != null ? a.quantity : a.Quantity,
            sap_doc_entry: a.sap_doc_entry || a.docEntry || common.sap_doc_entry,
            source_po_num: a.source_po_num || a.sourcePoNum || common.source_po_num || null
        });
        if (id) count++;
    }
    return count;
}

/** Upsert one issued roll/batch per (po, batch) — incremental only; use upsertMaterialIssueSapTotal for SAP totals. */
async function recordMaterialIssueIfAbsent(entry) {
    try {
        const poNum = entry.po_num != null ? String(entry.po_num).trim() : null;
        const batchNumber = String(entry.batch_number || '').trim();
        const quantity = Number(entry.quantity) || 0;
        if (!poNum || !batchNumber || quantity <= 0) return null;

        const [result] = await pool.query(
            `INSERT INTO material_issue_log
                (po_num, absolute_entry, line_number, item_code, batch_number,
                 quantity, warehouse, operator_name, machine_name, sap_doc_entry, output_batch, remarks, source_po_num)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                quantity = CASE
                    WHEN VALUES(sap_doc_entry) IS NOT NULL
                         AND material_issue_log.sap_doc_entry IS NOT NULL
                         AND material_issue_log.sap_doc_entry = VALUES(sap_doc_entry)
                    THEN GREATEST(material_issue_log.quantity, VALUES(quantity))
                    ELSE material_issue_log.quantity
                END,
                sap_doc_entry = COALESCE(material_issue_log.sap_doc_entry, VALUES(sap_doc_entry)),
                output_batch = COALESCE(NULLIF(material_issue_log.output_batch, ''), VALUES(output_batch)),
                warehouse = COALESCE(material_issue_log.warehouse, VALUES(warehouse)),
                operator_name = COALESCE(material_issue_log.operator_name, VALUES(operator_name)),
                machine_name = COALESCE(material_issue_log.machine_name, VALUES(machine_name)),
                absolute_entry = COALESCE(material_issue_log.absolute_entry, VALUES(absolute_entry)),
                line_number = COALESCE(material_issue_log.line_number, VALUES(line_number)),
                item_code = COALESCE(material_issue_log.item_code, VALUES(item_code)),
                source_po_num = COALESCE(material_issue_log.source_po_num, VALUES(source_po_num)),
                remarks = CASE
                    WHEN material_issue_log.remarks IS NULL OR material_issue_log.remarks LIKE '%Backfilled%'
                    THEN VALUES(remarks) ELSE material_issue_log.remarks END`,
            [
                poNum,
                entry.absolute_entry != null ? Number(entry.absolute_entry) : null,
                entry.line_number != null ? Number(entry.line_number) : null,
                entry.item_code || null,
                batchNumber,
                quantity,
                entry.warehouse || null,
                entry.operator_name || null,
                entry.machine_name || null,
                entry.sap_doc_entry != null ? String(entry.sap_doc_entry) : null,
                entry.output_batch || null,
                entry.remarks || null,
                entry.source_po_num != null ? String(entry.source_po_num).trim() : null
            ]
        );
        if (result.insertId) return result.insertId;
        const [existing] = await pool.query(
            'SELECT issue_id FROM material_issue_log WHERE po_num = ? AND batch_number = ? LIMIT 1',
            [poNum, batchNumber]
        );
        return existing[0]?.issue_id || null;
    } catch (error) {
        if (String(error.message || '').includes('uq_mil_po_batch')
            || String(error.message || '').includes('duplicate key')
            || error.code === 'ER_DUP_ENTRY') {
            await dedupeMaterialIssueLog(entry.po_num);
            return recordMaterialIssueIfAbsent(entry);
        }
        console.warn('⚠️ recordMaterialIssueIfAbsent failed (non-blocking):', error.message);
        return null;
    }
}

/** Set local issued qty to SAP total for (po, batch) — never exceeds SAP goods-issue sum. */
async function upsertMaterialIssueSapTotal(entry) {
    try {
        const poNum = entry.po_num != null ? String(entry.po_num).trim() : null;
        const batchNumber = String(entry.batch_number || '').trim();
        const quantity = Number(entry.quantity) || 0;
        if (!poNum || !batchNumber || quantity <= 0) return null;

        const [result] = await pool.query(
            `INSERT INTO material_issue_log
                (po_num, absolute_entry, line_number, item_code, batch_number,
                 quantity, warehouse, operator_name, machine_name, sap_doc_entry, output_batch, remarks, source_po_num)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                quantity = VALUES(quantity),
                sap_doc_entry = COALESCE(material_issue_log.sap_doc_entry, VALUES(sap_doc_entry)),
                output_batch = COALESCE(NULLIF(material_issue_log.output_batch, ''), VALUES(output_batch)),
                warehouse = COALESCE(material_issue_log.warehouse, VALUES(warehouse)),
                operator_name = COALESCE(material_issue_log.operator_name, VALUES(operator_name)),
                machine_name = COALESCE(material_issue_log.machine_name, VALUES(machine_name)),
                absolute_entry = COALESCE(material_issue_log.absolute_entry, VALUES(absolute_entry)),
                line_number = COALESCE(material_issue_log.line_number, VALUES(line_number)),
                item_code = COALESCE(material_issue_log.item_code, VALUES(item_code)),
                source_po_num = COALESCE(material_issue_log.source_po_num, VALUES(source_po_num)),
                remarks = CASE
                    WHEN material_issue_log.remarks IS NULL OR material_issue_log.remarks LIKE '%Backfilled%'
                         OR material_issue_log.remarks LIKE '%Synced from SAP%'
                    THEN VALUES(remarks) ELSE material_issue_log.remarks END`,
            [
                poNum,
                entry.absolute_entry != null ? Number(entry.absolute_entry) : null,
                entry.line_number != null ? Number(entry.line_number) : null,
                entry.item_code || null,
                batchNumber,
                quantity,
                entry.warehouse || null,
                entry.operator_name || null,
                entry.machine_name || null,
                entry.sap_doc_entry != null ? String(entry.sap_doc_entry) : null,
                entry.output_batch || null,
                entry.remarks || null,
                entry.source_po_num != null ? String(entry.source_po_num).trim() : null
            ]
        );
        if (result.insertId) return result.insertId;
        const [existing] = await pool.query(
            'SELECT issue_id FROM material_issue_log WHERE po_num = ? AND batch_number = ? LIMIT 1',
            [poNum, batchNumber]
        );
        return existing[0]?.issue_id || null;
    } catch (error) {
        console.warn('⚠️ upsertMaterialIssueSapTotal failed (non-blocking):', error.message);
        return null;
    }
}

/** Link all not-yet-linked issued rolls of a PO to the produced output batch. */
async function linkOutputBatchToIssues(poNum, outputBatch) {
    try {
        const po = String(poNum || '').trim();
        const batch = String(outputBatch || '').trim();
        if (!po || !batch) return 0;
        const [result] = await pool.query(
            `UPDATE material_issue_log
                SET output_batch = ?
              WHERE po_num = ? AND (output_batch IS NULL OR output_batch = '')`,
            [batch, po]
        );
        const n = result.affectedRows || 0;
        if (n > 0) vlog(`   🔗 Linked ${n} issued roll(s) to output batch ${batch} (PO ${po})`);
        return n;
    } catch (error) {
        console.warn('⚠️ linkOutputBatchToIssues failed (non-blocking):', error.message);
        return 0;
    }
}

/** Issued input rolls for a PO with remaining qty (one row per batch; issued − prior completions). */
async function getIssuedRolesWithRemaining(poNum) {
    const po = String(poNum);
    const [rows] = await pool.query(
        `SELECT MIN(mil.issue_id) AS issue_id,
                mil.batch_number,
                MAX(mil.item_code) AS item_code,
                COALESCE(MAX(mil.quantity), 0) AS issued_qty,
                MAX(mil.warehouse) AS warehouse,
                MIN(mil.issued_at) AS issued_at,
                MAX(mil.source_po_num) AS source_po_num,
                COALESCE((
                    SELECT SUM(rbu.quantity_used)
                      FROM role_batch_usage rbu
                     WHERE rbu.po_num = mil.po_num
                       AND rbu.input_batch_number = mil.batch_number
                       AND (
                           (mil.source_po_num IS NULL OR TRIM(mil.source_po_num) = '')
                           AND (rbu.source_po_num IS NULL OR TRIM(rbu.source_po_num) = '')
                           OR COALESCE(rbu.source_po_num, '') = mil.source_po_num
                           OR (
                               mil.source_po_num IS NOT NULL AND TRIM(mil.source_po_num) <> ''
                               AND (rbu.source_po_num IS NULL OR TRIM(rbu.source_po_num) = '')
                           )
                       )
                ), 0) AS used_qty
           FROM material_issue_log mil
          WHERE mil.po_num = ?
          GROUP BY mil.po_num, mil.batch_number, mil.source_po_num
          ORDER BY MIN(mil.issued_at) IS NULL, MIN(mil.issued_at) ASC, MIN(mil.issue_id) ASC`,
        [po]
    );
    return rows.map((r) => {
        const issued = Number(r.issued_qty) || 0;
        const used = Number(r.used_qty) || 0;
        const sourcePo = r.source_po_num != null ? String(r.source_po_num).trim() : null;
        const isProcess = Boolean(sourcePo);
        return {
            issue_id: isProcess
                ? makeProcessBatchIssueId(sourcePo, r.batch_number)
                : r.issue_id,
            batch_number: r.batch_number,
            item_code: r.item_code,
            issued_qty: issued,
            used_qty: used,
            remaining_qty: Math.max(0, issued - used),
            warehouse: r.warehouse,
            issued_at: r.issued_at,
            source_po_num: sourcePo,
            input_type: isProcess ? 'process_batch' : 'raw_roll'
        };
    });
}

/** Record roll/batch consumption for one report completion (source of truth for traceability). */
async function recordRoleBatchUsages(poNum, outputBatch, usages, completionMeta = {}) {
    if (!Array.isArray(usages) || usages.length === 0) return 0;
    const { operatorName, machineName } = await resolveCompletionOperatorMeta(outputBatch, completionMeta);
    let count = 0;
    for (const u of usages) {
        const qty = Number(u.quantity_used ?? u.quantityUsed) || 0;
        const batch = String(u.batch_number ?? u.batchNumber ?? '').trim();
        if (!batch || qty <= 0) continue;
        const inputType = String(u.input_type || u.inputType || '').trim()
            || (u.issue_id != null && Number.isFinite(Number(u.issue_id)) ? 'raw_roll' : 'process_batch');
        const issueId = inputType === 'raw_roll' && u.issue_id != null ? Number(u.issue_id) : null;
        const sourcePo = u.source_po_num != null ? String(u.source_po_num).trim()
            : (u.sourcePoNum != null ? String(u.sourcePoNum).trim() : null);
        await pool.query(
            `INSERT INTO role_batch_usage
                (po_num, issue_id, input_batch_number, item_code, output_batch,
                 quantity_used, input_type, operator_name, machine_name, source_po_num)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                String(poNum),
                issueId,
                batch,
                u.item_code || u.itemCode || null,
                outputBatch || null,
                qty,
                inputType,
                operatorName,
                machineName,
                sourcePo
            ]
        );
        count++;
    }
    return count;
}

/**
 * Backfill role_batch_usage for outputs that were saved without Finish Job input selection.
 * Allocates issued inputs to unlinked outputs in job_start_time order (FIFO).
 */
async function reconcileUnlinkedOutputBatchUsages(poNum) {
    const po = String(poNum || '').trim();
    if (!po) return { linked: 0, outputs: [] };

    const [outputRows] = await pool.query(
        `SELECT batch_num,
                MAX(quantity_processed) AS quantity_processed,
                MAX(fg_num) AS fg_num,
                MAX(operator_name) AS operator_name,
                MAX(machine_name) AS machine_name,
                MIN(job_start_time) AS job_start_time
           FROM production_records
          WHERE po_num = ? AND batch_num IS NOT NULL AND TRIM(batch_num) <> ''
          GROUP BY batch_num
          ORDER BY MIN(job_start_time) IS NULL, MIN(job_start_time) ASC, batch_num ASC`,
        [po]
    );

    const inputs = await getIssuedRolesWithRemaining(po);
    const inputPool = inputs.map((i) => ({ ...i, avail: Number(i.remaining_qty) || 0 }));

    let linked = 0;
    const outputs = [];

    for (const out of outputRows) {
        const batch = String(out.batch_num || '').trim();
        if (!batch) continue;

        const [usageRows] = await pool.query(
            `SELECT COUNT(*) AS c FROM role_batch_usage WHERE po_num = ? AND output_batch = ?`,
            [po, batch]
        );
        if (Number(usageRows[0]?.c) > 0) {
            outputs.push({ outputBatch: batch, skipped: true, reason: 'already_linked' });
            continue;
        }

        const need = Number(out.quantity_processed) || 0;
        if (need <= 0) {
            outputs.push({ outputBatch: batch, skipped: true, reason: 'no_output_qty' });
            continue;
        }

        const usages = [];
        let remaining = need;
        for (const inp of inputPool) {
            if (remaining <= 1e-6) break;
            if (inp.avail <= 1e-6) continue;
            const take = Math.min(inp.avail, remaining);
            usages.push({
                issue_id: inp.input_type === 'raw_roll' ? inp.issue_id : null,
                batch_number: inp.batch_number,
                item_code: inp.item_code,
                input_type: inp.input_type || 'raw_roll',
                source_po_num: inp.source_po_num || null,
                quantity_used: take
            });
            inp.avail -= take;
            remaining -= take;
        }

        if (!usages.length) {
            outputs.push({ outputBatch: batch, linked: 0, unmetQty: remaining });
            continue;
        }

        const recorded = await recordRoleBatchUsages(po, batch, usages, {
            operator_name: out.operator_name,
            machine_name: out.machine_name
        });
        linked += recorded;
        outputs.push({
            outputBatch: batch,
            linked: recorded,
            allocatedQty: need - remaining,
            unmetQty: remaining > 1e-6 ? remaining : 0
        });
    }

    if (linked > 0) {
        try {
            await backfillRoleBatchUsageOperators(po);
        } catch (_) { /* non-blocking */ }
    }

    return { linked, outputs };
}

/** Link specific issued rolls to an output batch (traceability). */
async function linkIssuesToOutputBatch(issueIds, outputBatch) {
    const batch = String(outputBatch || '').trim();
    if (!batch || !Array.isArray(issueIds) || issueIds.length === 0) return 0;
    const ids = issueIds.map((id) => Number(id)).filter((id) => id > 0);
    if (!ids.length) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const [result] = await pool.query(
        `UPDATE material_issue_log
            SET output_batch = ?
          WHERE issue_id IN (${placeholders})
            AND (output_batch IS NULL OR output_batch = '')`,
        [batch, ...ids]
    );
    return result.affectedRows || 0;
}

/** PO that produced this output batch (report completion on that PO). */
async function getOutputBatchOwnerPO(outputBatch, poNum = null) {
    const batch = String(outputBatch || '').trim();
    const po = poNum != null ? String(poNum).trim() : '';
    if (!batch) return null;
    const poParams = po ? [batch, po] : [batch];
    const poClause = po ? ' AND po_num = ?' : '';
    const [prodRows] = await pool.query(
        `SELECT po_num, process_name
           FROM production_records
          WHERE batch_num = ?${poClause}
          ORDER BY job_end_time IS NULL, job_end_time DESC, unique_id DESC
          LIMIT 1`,
        poParams
    );
    if (prodRows[0]?.po_num) {
        return {
            poNum: String(prodRows[0].po_num).trim(),
            processName: prodRows[0].process_name || null
        };
    }
    const rbuParams = po ? [batch, po] : [batch];
    const rbuPoClause = po ? ' AND po_num = ?' : '';
    const [rbuRows] = await pool.query(
        `SELECT po_num FROM role_batch_usage
          WHERE output_batch = ?${rbuPoClause}
          GROUP BY po_num
          ORDER BY MAX(created_at) IS NULL, MAX(created_at) DESC
          LIMIT 1`,
        rbuParams
    );
    if (rbuRows[0]?.po_num) {
        return { poNum: String(rbuRows[0].po_num).trim(), processName: null };
    }
    return null;
}

/** True only when this output batch was produced on the given PO. */
async function outputBatchBelongsToPO(poNum, outputBatch) {
    const po = String(poNum || '').trim();
    const batch = String(outputBatch || '').trim();
    if (!po || !batch) return false;
    const owner = await getOutputBatchOwnerPO(batch, po);
    if (!owner?.poNum) return false;
    return po === owner.poNum;
}

/** Inputs consumed to produce an output batch (from report completion only). */
async function getGenealogyByOutputBatch(outputBatch, poNum = null) {
    const batch = String(outputBatch || '').trim();
    if (!batch) return [];
    const po = poNum != null ? String(poNum).trim() : '';
    const params = po ? [batch, po] : [batch];
    const poClause = po ? ' AND rbu.po_num = ?' : '';
    const [rows] = await pool.query(
        `SELECT rbu.usage_id,
                rbu.po_num,
                rbu.input_batch_number AS batch_number,
                rbu.item_code,
                rbu.quantity_used AS quantity,
                rbu.input_type,
                rbu.created_at AS used_at,
                rbu.operator_name AS usage_operator,
                rbu.machine_name AS usage_machine,
                rbu.source_po_num,
                mil.warehouse,
                mil.operator_name AS issue_operator,
                mil.machine_name AS issue_machine,
                mil.issued_at,
                pr_out.operator_name AS completion_operator,
                pr_out.machine_name AS completion_machine
           FROM role_batch_usage rbu
           LEFT JOIN material_issue_log mil
                  ON mil.issue_id = rbu.issue_id
           LEFT JOIN (${PR_COMPLETION_SUBQUERY}) pr_out
                  ON pr_out.batch_num = rbu.output_batch
          WHERE rbu.output_batch = ?${poClause}
          ORDER BY rbu.created_at ASC, rbu.usage_id ASC`,
        params
    );
    return rows.map((r) => ({
        output_batch: batch,
        batch_number: r.batch_number,
        item_code: r.item_code,
        quantity: Number(r.quantity) || 0,
        input_type: r.input_type || 'raw_roll',
        used_at: r.used_at,
        warehouse: r.warehouse || null,
        operator_name: r.usage_operator || r.completion_operator || r.issue_operator || null,
        machine_name: r.usage_machine || r.completion_machine || r.issue_machine || null,
        issued_at: r.issued_at || null,
        source_po_num: r.source_po_num || null,
        po_num: r.po_num
    }));
}

/** All output batches for a PO with their consumed inputs (report completion links only). */
async function getGenealogyByPO(poNum) {
    const po = String(poNum || '').trim();
    if (!po) return [];
    const [rows] = await pool.query(
        `SELECT rbu.output_batch,
                rbu.input_batch_number AS batch_number,
                rbu.item_code,
                rbu.quantity_used AS quantity,
                rbu.input_type,
                rbu.created_at AS used_at,
                rbu.operator_name AS usage_operator,
                rbu.machine_name AS usage_machine,
                rbu.source_po_num,
                mil.warehouse,
                mil.operator_name AS issue_operator,
                mil.machine_name AS issue_machine,
                mil.issued_at,
                pr_out.operator_name AS completion_operator,
                pr_out.machine_name AS completion_machine
           FROM role_batch_usage rbu
           LEFT JOIN material_issue_log mil ON mil.issue_id = rbu.issue_id
           LEFT JOIN (${PR_COMPLETION_SUBQUERY}) pr_out ON pr_out.batch_num = rbu.output_batch
          WHERE rbu.po_num = ?
          ORDER BY rbu.output_batch IS NULL, rbu.output_batch ASC, rbu.created_at ASC`,
        [po]
    );
    return rows.map((r) => ({
        output_batch: r.output_batch,
        batch_number: r.batch_number,
        item_code: r.item_code,
        quantity: Number(r.quantity) || 0,
        input_type: r.input_type || 'raw_roll',
        used_at: r.used_at,
        warehouse: r.warehouse || null,
        operator_name: r.usage_operator || r.completion_operator || r.issue_operator || null,
        machine_name: r.usage_machine || r.completion_machine || r.issue_machine || null,
        issued_at: r.issued_at || null,
        source_po_num: r.source_po_num || null
    }));
}

/** @deprecated Use getGenealogyByOutputBatch — material_issue_log.output_batch is not authoritative. */
async function getTraceabilityByOutputBatch(outputBatch) {
    return getGenealogyByOutputBatch(outputBatch);
}

/** @deprecated Use getGenealogyByPO */
async function getTraceabilityByPO(poNum) {
    return getGenealogyByPO(poNum);
}

/** Merge trace rows keyed only by batch into the sourced process-batch row (same batch, different keys). */
function collapseDuplicateProcessInputMap(inputMap) {
    const byBatch = new Map();
    for (const [key, inp] of inputMap.entries()) {
        const batch = String(inp.batchNumber || '').trim();
        if (!batch) continue;
        if (!byBatch.has(batch)) byBatch.set(batch, []);
        byBatch.get(batch).push({ key, inp });
    }
    for (const entries of byBatch.values()) {
        if (entries.length <= 1) continue;
        const withSource = entries.filter((e) => Boolean(String(e.inp.sourcePoNum || '').trim()));
        const withoutSource = entries.filter((e) => !String(e.inp.sourcePoNum || '').trim());
        if (!withSource.length || !withoutSource.length) continue;
        const canonical = withSource.sort(
            (a, b) => (Number(b.inp.issuedQty) || 0) - (Number(a.inp.issuedQty) || 0)
        )[0];
        const c = canonical.inp;
        for (const { key, inp: o } of withoutSource) {
            c.totalQtyUsed = Math.max(Number(c.totalQtyUsed) || 0, Number(o.totalQtyUsed) || 0);
            for (const out of o.usedInOutputs) c.usedInOutputs.add(out);
            if (c.issuedQty == null && o.issuedQty != null) c.issuedQty = o.issuedQty;
            if (!c.itemCode && o.itemCode) c.itemCode = o.itemCode;
            if (!c.issuedAt && o.issuedAt) c.issuedAt = o.issuedAt;
            if (c.issuedQty != null) {
                c.remainingQty = Math.max(0, Number(c.issuedQty) - (Number(c.totalQtyUsed) || 0));
            }
            inputMap.delete(key);
        }
    }
}

/** PO-level trace summary: all issued input batches + output batches with usage from report completion. */
async function getPOTraceabilitySummary(poNum, options = {}) {
    const po = String(poNum || '').trim();
    if (!po) {
        return { poNum: po, inputBatches: [], outputBatches: [], genealogy: [] };
    }

    try {
        await backfillRoleBatchUsageOperators(po);
        await backfillRoleBatchUsageSourcePo(po);
    } catch (_) { /* non-blocking */ }

    let fgItemCode = options.fgItemCode || options.fg_num || null;
    if (!fgItemCode) {
        try {
            const [fgRows] = await pool.query(
                `SELECT fg_num FROM production_records
                  WHERE po_num = ? AND fg_num IS NOT NULL AND TRIM(fg_num) <> ''
                  ORDER BY job_start_time IS NULL, job_start_time DESC
                  LIMIT 1`,
                [po]
            );
            fgItemCode = fgRows[0]?.fg_num || null;
        } catch (_) { /* non-blocking */ }
    }
    const processTag = String(
        options.processTag || options.process_tag || inferUnit1ProcessTagFromItemCode(fgItemCode) || ''
    ).toUpperCase();
    const bomInputs = Array.isArray(options.bomProcessInputs) ? options.bomProcessInputs : [];
    const sourcePoNums = Array.isArray(options.sourcePoNums) ? options.sourcePoNums : [];
    const bomTags = bomInputs.map((b) => b.processTag).filter(Boolean);

    let prevProcessInputs = [];
    if (bomInputs.length && sourcePoNums.length) {
        const prevLists = await Promise.all(
            bomInputs.map((inp) => getPreviousProcessOutputBatchesByItemCode(po, inp.itemCode, sourcePoNums))
        );
        prevProcessInputs = prevLists.flat();
    }

    const [genealogyRows, issuedRows] = await Promise.all([
        getGenealogyByPO(po),
        getIssuedRolesWithRemaining(po)
    ]);

    const inputMap = new Map();
    const outputMap = new Map();

    const issuedBatchKeys = new Set();
    for (const iss of issuedRows) {
        const inKey = traceInputKey(iss.batch_number, iss.source_po_num, iss.input_type);
        if (!inKey || inputMap.has(inKey)) continue;
        issuedBatchKeys.add(inKey);
        const isProcessBatch = Boolean(String(iss.source_po_num || '').trim())
            || (bomTags.length
                ? bomTags.some((t) => String(iss.batch_number).includes(`-${t}-`))
                : false);
        inputMap.set(inKey, {
            batchNumber: iss.batch_number,
            itemCode: iss.item_code,
            inputType: isProcessBatch ? 'process_batch' : 'raw_roll',
            warehouse: iss.warehouse,
            issuedQty: Number(iss.issued_qty) || 0,
            totalQtyUsed: Number(iss.used_qty) || 0,
            remainingQty: Number(iss.remaining_qty) || 0,
            issuedAt: iss.issued_at,
            sourcePoNum: iss.source_po_num || null,
            usedInOutputs: new Set()
        });
    }

    for (const prev of prevProcessInputs) {
        const inKey = traceInputKey(prev.batch_number, prev.source_po_num, 'process_batch');
        if (!inKey) continue;
        if (inputMap.has(inKey)) {
            const inp = inputMap.get(inKey);
            const issuedQty = Math.max(Number(inp.issuedQty) || 0, Number(prev.issued_qty) || 0);
            inp.issuedQty = issuedQty;
            inp.totalQtyUsed = Math.max(Number(inp.totalQtyUsed) || 0, Number(prev.used_qty) || 0);
            inp.remainingQty = Math.max(0, issuedQty - (Number(inp.totalQtyUsed) || 0));
            inp.inputType = 'process_batch';
            inp.sourcePoNum = prev.source_po_num || inp.sourcePoNum;
            if (!inp.itemCode) inp.itemCode = prev.item_code;
            if (!inp.issuedAt) inp.issuedAt = prev.issued_at;
            continue;
        }
        issuedBatchKeys.add(inKey);
        inputMap.set(inKey, {
            batchNumber: prev.batch_number,
            itemCode: prev.item_code,
            inputType: 'process_batch',
            warehouse: null,
            issuedQty: Number(prev.issued_qty) || 0,
            totalQtyUsed: Number(prev.used_qty) || 0,
            remainingQty: Number(prev.remaining_qty) || 0,
            issuedAt: prev.issued_at,
            sourcePoNum: prev.source_po_num,
            usedInOutputs: new Set()
        });
    }

    for (const r of genealogyRows) {
        const inKey = traceInputKey(r.batch_number, r.source_po_num, r.input_type);
        const fromIssueLog = issuedBatchKeys.has(inKey);
        if (!inputMap.has(inKey)) {
            inputMap.set(inKey, {
                batchNumber: r.batch_number,
                itemCode: r.item_code,
                inputType: r.input_type || 'raw_roll',
                warehouse: r.warehouse,
                issuedQty: null,
                totalQtyUsed: 0,
                remainingQty: null,
                issuedAt: r.issued_at || null,
                sourcePoNum: r.source_po_num || null,
                usedInOutputs: new Set()
            });
        }
        const inp = inputMap.get(inKey);
        if (!fromIssueLog) {
            inp.totalQtyUsed += Number(r.quantity) || 0;
        }
        if (r.output_batch) inp.usedInOutputs.add(r.output_batch);
        if (!inp.itemCode && r.item_code) inp.itemCode = r.item_code;
        if (!inp.warehouse && r.warehouse) inp.warehouse = r.warehouse;
        if (!inp.issuedAt && r.issued_at) inp.issuedAt = r.issued_at;
        if (r.input_type === 'process_batch') inp.inputType = 'process_batch';

        const outKey = r.output_batch;
        if (!outKey) continue;
        if (!outputMap.has(outKey)) {
            outputMap.set(outKey, {
                outputBatch: outKey,
                inputs: [],
                totalInputQty: 0,
                inputCount: 0
            });
        }
        const out = outputMap.get(outKey);
        out.inputs.push({
            batchNumber: r.batch_number,
            itemCode: r.item_code,
            quantity: Number(r.quantity) || 0,
            inputType: r.input_type || 'raw_roll',
            warehouse: r.warehouse,
            operator: r.operator_name,
            machine: formatMachineDisplayName(r.machine_name) || r.machine_name,
            usedAt: r.used_at,
            sourcePoNum: r.source_po_num || null
        });
        out.totalInputQty += Number(r.quantity) || 0;
        out.inputCount = out.inputs.length;
    }

    const [prodRows] = await pool.query(
        `SELECT batch_num,
                MAX(quantity_processed) AS quantity_processed,
                MAX(fg_num)             AS fg_num,
                MAX(u_width)            AS u_width,
                MAX(u_length)           AS u_length,
                MIN(job_start_time)       AS job_start_time,
                MAX(operator_name)      AS operator_name,
                MAX(machine_name)       AS machine_name,
                MAX(process_name)       AS process_name
           FROM production_records
          WHERE po_num = ?
          GROUP BY batch_num
          ORDER BY batch_num ASC`,
        [po]
    );
    for (const pr of prodRows) {
        const bn = pr.batch_num;
        if (!bn) continue;
        const completionOperator = isUsableOperatorName(pr.operator_name) ? pr.operator_name : null;
        const completionMachine = pr.machine_name || null;
        const batchWidth = pr.u_width != null ? Number(pr.u_width) : null;
        const batchLength = pr.u_length != null ? Number(pr.u_length) : null;
        if (!outputMap.has(bn)) {
            outputMap.set(bn, {
                outputBatch: bn,
                inputs: [],
                totalInputQty: 0,
                inputCount: 0,
                outputQty: Number(pr.quantity_processed) || 0,
                itemCode: pr.fg_num,
                producedAt: pr.job_start_time,
                completionOperator,
                completionMachine,
                processName: pr.process_name || null,
                uWidth: batchWidth,
                uLength: batchLength,
                noInputsRecorded: true
            });
        } else {
            const o = outputMap.get(bn);
            o.outputQty = Number(pr.quantity_processed) || 0;
            o.itemCode = pr.fg_num;
            o.producedAt = pr.job_start_time;
            o.completionOperator = completionOperator || o.completionOperator;
            o.completionMachine = completionMachine || o.completionMachine;
            o.uWidth = batchWidth;
            o.uLength = batchLength;
            o.noInputsRecorded = o.inputs.length === 0;
        }
    }

    collapseDuplicateProcessInputMap(inputMap);

    const inputBatches = Array.from(inputMap.values())
        .map((i) => {
            const issuedQty = i.issuedQty != null ? Number(i.issuedQty) : null;
            const totalQtyUsed = Number(i.totalQtyUsed) || 0;
            const remainingQty = i.remainingQty != null
                ? Number(i.remainingQty)
                : (issuedQty != null ? Math.max(0, issuedQty - totalQtyUsed) : null);
            let usageStatus = 'unused';
            if (totalQtyUsed > 0 && (remainingQty == null || remainingQty <= 0)) usageStatus = 'used';
            else if (totalQtyUsed > 0) usageStatus = 'partial';
            else if (issuedQty != null) usageStatus = 'issued';
            return {
                batchNumber: i.batchNumber,
                itemCode: i.itemCode,
                inputType: i.inputType,
                warehouse: i.warehouse,
                sourcePoNum: i.sourcePoNum || null,
                issuedQty,
                totalQtyUsed,
                remainingQty,
                issuedAt: i.issuedAt || null,
                usageStatus,
                usedInOutputs: Array.from(i.usedInOutputs).sort()
            };
        })
        .sort((a, b) => {
            const ta = a.issuedAt ? new Date(a.issuedAt).getTime() : 0;
            const tb = b.issuedAt ? new Date(b.issuedAt).getTime() : 0;
            if (ta !== tb) return ta - tb;
            return String(a.batchNumber).localeCompare(String(b.batchNumber));
        });

    const finalizedInputMeta = new Map();
    for (const [key, i] of inputMap.entries()) {
        const issuedQty = i.issuedQty != null ? Number(i.issuedQty) : null;
        const totalQtyUsed = Number(i.totalQtyUsed) || 0;
        const remainingQty = i.remainingQty != null
            ? Number(i.remainingQty)
            : (issuedQty != null ? Math.max(0, issuedQty - totalQtyUsed) : null);
        finalizedInputMeta.set(key, { issuedQty, remainingQty, sourcePoNum: i.sourcePoNum || null });
    }

    const outputBatches = enrichOutputInputRunBalances(
        Array.from(outputMap.values())
            .map((out) => {
                for (const inp of out.inputs) {
                    const meta = finalizedInputMeta.get(inp.batchNumber);
                    if (meta) {
                        if (!inp.sourcePoNum) inp.sourcePoNum = meta.sourcePoNum;
                    }
                    if (!inp.operator && out.completionOperator) {
                        inp.operator = out.completionOperator;
                    }
                    if (!inp.machine && out.completionMachine) {
                        inp.machine = out.completionMachine;
                    }
                }
                return out;
            })
            .sort((a, b) => String(a.outputBatch).localeCompare(String(b.outputBatch))),
        inputMap
    );

    const groups = {};
    for (const r of genealogyRows) {
        const key = r.output_batch || '__pending__';
        if (!groups[key]) {
            groups[key] = { outputBatch: r.output_batch || null, inputs: [], totalQty: 0 };
        }
        groups[key].inputs.push({
            itemCode: r.item_code,
            batchNumber: r.batch_number,
            quantity: Number(r.quantity) || 0,
            inputType: r.input_type || 'raw_roll',
            warehouse: r.warehouse,
            operator: r.operator_name,
            machine: formatMachineDisplayName(r.machine_name) || r.machine_name,
            usedAt: r.used_at,
            issuedAt: r.issued_at
        });
        groups[key].totalQty += Number(r.quantity) || 0;
    }

    return {
        poNum: po,
        inputBatches,
        outputBatches,
        count: genealogyRows.length,
        genealogy: Object.values(groups)
    };
}

/** Process-step inputs must have source_po_num; drop legacy rows without PO. */
function dropUnsourcedProcessBatchDupes(rows, processTagsOrTag) {
    const tags = Array.isArray(processTagsOrTag)
        ? processTagsOrTag.map((t) => String(t || '').trim().toUpperCase()).filter(Boolean)
        : (processTagsOrTag ? [String(processTagsOrTag).trim().toUpperCase()] : []);
    const isProcessBatch = (r) => {
        const batch = String(r.batch_number || '').trim();
        if (!batch) return false;
        if (r.input_type === 'raw_roll') return false;
        return r.input_type === 'process_batch'
            || Boolean(String(r.source_po_num || '').trim())
            || isProcessBatchNumber(batch, tags);
    };
    return rows.filter((r) => {
        if (!isProcessBatch(r)) return true;
        return Boolean(String(r.source_po_num || '').trim());
    });
}

/** Stable client/server id for previous-process batch (batch codes repeat per source PO). */
function makeProcessBatchIssueId(sourcePoNum, batchNumber) {
    const po = String(sourcePoNum || '').trim();
    const batch = String(batchNumber || '').trim();
    return po ? `${po}:${batch}` : batch;
}

/** Map key for traceability / issued-input rows (process batches need source PO). */
function traceInputKey(batchNumber, sourcePoNum, inputType = null) {
    const batch = String(batchNumber || '').trim();
    const sourcePo = String(sourcePoNum || '').trim();
    const type = String(inputType || '').trim();
    if (sourcePo || type === 'process_batch') return makeProcessBatchIssueId(sourcePo, batch);
    return batch;
}

/** Sum consumption on a consuming PO for one input batch, scoped by source PO when known. */
async function sumRoleBatchUsageForInput(poNum, batchNumber, sourcePoNum = null) {
    const po = String(poNum || '').trim();
    const batch = String(batchNumber || '').trim();
    const sourcePo = String(sourcePoNum || '').trim();
    if (!po || !batch) return 0;
    if (sourcePo) {
        const [rows] = await pool.query(
            `SELECT COALESCE(SUM(quantity_used), 0) AS used_qty
               FROM role_batch_usage
              WHERE po_num = ?
                AND input_batch_number = ?
                AND (
                    COALESCE(source_po_num, '') = ?
                    OR (
                        COALESCE(source_po_num, '') = ''
                        AND NOT EXISTS (
                            SELECT 1 FROM role_batch_usage r2
                             WHERE r2.po_num = role_batch_usage.po_num
                               AND r2.input_batch_number = role_batch_usage.input_batch_number
                               AND COALESCE(r2.source_po_num, '') = ?
                        )
                    )
                )`,
            [po, batch, sourcePo, sourcePo]
        );
        return Number(rows[0]?.used_qty) || 0;
    }
    const [rows] = await pool.query(
        `SELECT COALESCE(SUM(quantity_used), 0) AS used_qty
           FROM role_batch_usage
          WHERE po_num = ?
            AND input_batch_number = ?
            AND (source_po_num IS NULL OR TRIM(source_po_num) = '')`,
        [po, batch]
    );
    return Number(rows[0]?.used_qty) || 0;
}

/** Backfill missing source_po_num on role_batch_usage from material_issue_log and producer PO. */
async function backfillRoleBatchUsageSourcePo(poNum = null) {
    const po = poNum != null ? String(poNum).trim() : '';
    const poClause = po ? 'AND rbu.po_num = ?' : '';
    const params = po ? [po] : [];
    let total = 0;
    try {
        const [milResult] = await pool.query(
            `UPDATE role_batch_usage rbu
                INNER JOIN material_issue_log mil
                    ON mil.po_num = rbu.po_num
                   AND mil.batch_number = rbu.input_batch_number
                   AND mil.source_po_num IS NOT NULL
                   AND TRIM(mil.source_po_num) <> ''
               SET rbu.source_po_num = mil.source_po_num
             WHERE (rbu.source_po_num IS NULL OR TRIM(rbu.source_po_num) = '')
               ${poClause}`,
            params
        );
        total += milResult.affectedRows || 0;

        const [prResult] = await pool.query(
            `UPDATE role_batch_usage rbu
                INNER JOIN production_records pr
                    ON pr.batch_num = rbu.input_batch_number
                   AND pr.po_num IS NOT NULL
                   AND TRIM(pr.po_num) <> ''
                   AND pr.po_num <> rbu.po_num
               SET rbu.source_po_num = pr.po_num
             WHERE (rbu.source_po_num IS NULL OR TRIM(rbu.source_po_num) = '')
               ${poClause}`,
            params
        );
        total += prResult.affectedRows || 0;
        return total;
    } catch (error) {
        console.warn('backfillRoleBatchUsageSourcePo failed:', error.message);
        return total;
    }
}

/**
 * Per output run: issued = opening balance before this run (carries forward remaining
 * from earlier outputs on the same PO); remaining = issued − used here.
 */
function enrichOutputInputRunBalances(outputBatches, inputMap) {
    const originalIssuedByBatch = new Map();
    for (const [key, i] of inputMap.entries()) {
        if (i.issuedQty != null) {
            originalIssuedByBatch.set(key, Number(i.issuedQty) || 0);
        }
    }

    const allUsages = [];
    for (const out of outputBatches) {
        for (const inp of out.inputs || []) {
            allUsages.push({ outputBatch: out.outputBatch, inp });
        }
    }
    allUsages.sort((a, b) => {
        const ta = a.inp.usedAt ? new Date(a.inp.usedAt).getTime() : 0;
        const tb = b.inp.usedAt ? new Date(b.inp.usedAt).getTime() : 0;
        if (ta !== tb) return ta - tb;
        return String(a.outputBatch).localeCompare(String(b.outputBatch));
    });

    const priorUsedByBatch = new Map();
    for (const { inp } of allUsages) {
        const batchKey = String(inp.batchNumber || '').trim();
        const trackKey = inp.sourcePoNum
            ? makeProcessBatchIssueId(inp.sourcePoNum, batchKey)
            : batchKey;
        const originalIssued = originalIssuedByBatch.get(batchKey)
            ?? originalIssuedByBatch.get(trackKey)
            ?? 0;
        const usedBefore = priorUsedByBatch.get(trackKey) || 0;
        const availableQty = Math.max(0, originalIssued - usedBefore);
        const usedHere = Number(inp.quantity) || 0;
        inp.originalIssuedQty = originalIssued;
        inp.availableQty = availableQty;
        inp.issuedQty = availableQty;
        inp.remainingAfter = Math.max(0, availableQty - usedHere);
        inp.remainingQty = inp.remainingAfter;
        priorUsedByBatch.set(trackKey, usedBefore + usedHere);
    }

    return outputBatches;
}

/** FG item code for the previous process step (e.g. …-MET → …-EMB). */
function derivePrevProcessInputItemCode(fgItemCode, prevTag) {
    const prev = String(prevTag || '').trim().toUpperCase();
    if (!prev) return null;
    const code = String(fgItemCode || '').trim().toUpperCase();
    if (!code) return null;
    const curTag = inferUnit1ProcessTagFromItemCode(code);
    const base = curTag && code.endsWith(`-${curTag}`)
        ? code.slice(0, -(curTag.length + 1))
        : code.replace(/-(EMB|MET|MTL|COT|SLT|REW)$/i, '');
    return base ? `${base}-${prev}` : null;
}

/** Build LIKE pattern for previous-process output batches (e.g. PET-…-HF-EMB-%). */
function buildPrevProcessBatchPattern(fgItemCode, prevTag) {
    const prev = String(prevTag || '').trim().toUpperCase();
    if (!prev) return null;
    const code = String(fgItemCode || '').trim().toUpperCase();
    if (code) {
        const curTag = inferUnit1ProcessTagFromItemCode(code);
        const base = curTag && code.endsWith(`-${curTag}`)
            ? code.slice(0, -(curTag.length + 1))
            : code.replace(/-(EMB|MET|MTL|COT|SLT|REW)$/i, '');
        if (base) return `${base}-${prev}-%`;
    }
    return `%-${prev}-%`;
}

/** Keep only the latest source PO number(s) strictly before the current PO in the chain. */
function pickLatestSourcePosBeforeCurrent(candidatePos, currentPoNum) {
    const currentNum = Number(currentPoNum);
    const bestByNum = new Map();
    for (const raw of Array.isArray(candidatePos) ? candidatePos : []) {
        const p = String(raw || '').trim();
        if (!p) continue;
        const n = Number(p);
        if (Number.isFinite(currentNum) && Number.isFinite(n) && n >= currentNum) continue;
        const score = Number.isFinite(n) ? n : 0;
        const prev = bestByNum.get(score);
        if (!prev || p.localeCompare(prev) > 0) bestByNum.set(score, p);
    }
    if (!bestByNum.size) return [];
    const maxScore = Math.max(...bestByNum.keys());
    return [bestByNum.get(maxScore)];
}

/** Source PO(s) that produced an intermediate item — from local finish reports (fallback when SAP ItemNo match fails). */
async function findSourceProcessPOsFromLocalDb(inputItemCode, excludePoNum = null) {
    const item = String(inputItemCode || '').trim().toUpperCase();
    const exclude = String(excludePoNum || '').trim();
    if (!item) return [];
    try {
        const [rows] = await pool.query(
            `SELECT DISTINCT po_num
               FROM production_records
              WHERE UPPER(TRIM(COALESCE(fg_num, ''))) = ?
                 OR UPPER(TRIM(batch_num)) LIKE ?
              ORDER BY po_num ASC`,
            [item, `${item}-%`]
        );
        const candidates = rows
            .map((r) => String(r.po_num || '').trim())
            .filter((p) => p && p !== exclude);
        return pickLatestSourcePosBeforeCurrent(candidates, exclude);
    } catch (error) {
        console.warn('findSourceProcessPOsFromLocalDb failed:', error.message);
        return [];
    }
}

async function getPreviousProcessOutputBatchesByItemCode(poNum, inputItemCode, sourcePoNums = null) {
    const po = String(poNum || '').trim();
    const item = String(inputItemCode || '').trim().toUpperCase();
    if (!po || !item) return [];

    const allowedPos = Array.isArray(sourcePoNums)
        ? sourcePoNums.map((p) => String(p).trim()).filter(Boolean)
        : [];
    if (!allowedPos.length) return [];

    const poPlaceholders = allowedPos.map(() => '?').join(', ');
    const params = [item, ...allowedPos];

    const [rows] = await pool.query(
        `SELECT pr.batch_num AS batch_number,
                MAX(pr.fg_num) AS item_code,
                MAX(pr.quantity_processed) AS output_qty,
                MIN(pr.job_start_time) AS produced_at,
                pr.po_num AS source_po_num,
                MAX(CASE WHEN pr.operator_name IS NOT NULL
                          AND TRIM(pr.operator_name) NOT IN ('', 'Operator', 'Unknown')
                     THEN pr.operator_name END) AS producer_operator,
                MAX(CASE WHEN pr.machine_name IS NOT NULL AND TRIM(pr.machine_name) <> ''
                     THEN pr.machine_name END) AS producer_machine
           FROM production_records pr
          WHERE UPPER(TRIM(COALESCE(pr.fg_num, ''))) = ?
            AND pr.po_num IN (${poPlaceholders})
          GROUP BY pr.batch_num, pr.po_num
          ORDER BY pr.po_num ASC, pr.batch_num ASC`,
        params
    );

    const results = [];
    for (const r of rows) {
        const issued = Number(r.output_qty) || 0;
        if (issued <= 0) continue;
        const sourcePo = String(r.source_po_num || '').trim();
        const used = await sumRoleBatchUsageForInput(po, r.batch_number, sourcePo || null);
        results.push({
            issue_id: makeProcessBatchIssueId(sourcePo, r.batch_number),
            batch_number: r.batch_number,
            item_code: r.item_code,
            issued_qty: issued,
            used_qty: used,
            remaining_qty: Math.max(0, issued - used),
            input_type: 'process_batch',
            source_batch: r.batch_number,
            source_po_num: sourcePo,
            issued_at: r.produced_at,
            producer_operator: r.producer_operator || null,
            producer_machine: r.producer_machine || null
        });
    }
    return results;
}

async function getPreviousProcessOutputBatches(poNum, prevTag, fgItemCode, sourcePoNums = null) {
    const derived = derivePrevProcessInputItemCode(fgItemCode, prevTag);
    if (!derived) return [];
    return getPreviousProcessOutputBatchesByItemCode(poNum, derived, sourcePoNums);
}

async function mergeProcessInputSources(poNum, bomInputs, sourcePoNums = null) {
    const po = String(poNum || '').trim();
    const inputs = Array.isArray(bomInputs) ? bomInputs : [];
    const processTags = inputs.map((b) => b.processTag).filter(Boolean);
    const issuedRows = await getIssuedRolesWithRemaining(po);

    const milSourcePos = [...new Set(
        issuedRows.map((r) => String(r.source_po_num || '').trim()).filter(Boolean)
    )];
    let allowedSourcePos = Array.isArray(sourcePoNums)
        ? sourcePoNums.map((p) => String(p).trim()).filter(Boolean)
        : [];
    if (milSourcePos.length > 0) {
        allowedSourcePos = milSourcePos;
    } else if (allowedSourcePos.length > 1) {
        allowedSourcePos = pickLatestSourcePosBeforeCurrent(allowedSourcePos, po);
    }

    const prevOutputLists = await Promise.all(
        inputs.map((inp) => getPreviousProcessOutputBatchesByItemCode(po, inp.itemCode, allowedSourcePos))
    );
    const prevOutputs = prevOutputLists.flat();
    const byKey = new Map();

    for (const r of issuedRows) {
        const sourcePo = r.source_po_num || null;
        const key = sourcePo ? makeProcessBatchIssueId(sourcePo, r.batch_number) : String(r.batch_number);
        const batchStr = String(r.batch_number || '');
        const isRawRoll = r.input_type === 'raw_roll';
        const isProcess = !isRawRoll && (
            r.input_type === 'process_batch'
            || Boolean(sourcePo)
            || isProcessBatchNumber(batchStr, processTags)
        );
        byKey.set(key, {
            ...r,
            issue_id: isProcess && sourcePo
                ? makeProcessBatchIssueId(sourcePo, r.batch_number)
                : r.issue_id,
            input_type: isProcess ? 'process_batch' : 'raw_roll',
            source_batch: r.batch_number,
            source_po_num: sourcePo,
            from_material_issue: true
        });
    }

    for (const r of prevOutputs) {
        if ((Number(r.remaining_qty) || 0) <= 0) continue;
        const key = makeProcessBatchIssueId(r.source_po_num, r.batch_number);
        const existing = byKey.get(key);
        if (!existing) {
            byKey.set(key, { ...r, from_material_issue: false });
            continue;
        }
        const milIssued = existing.from_material_issue ? (Number(existing.issued_qty) || 0) : 0;
        const prevIssued = Number(r.issued_qty) || 0;
        const issuedQty = existing.from_material_issue
            ? milIssued
            : Math.max(Number(existing.issued_qty) || 0, prevIssued);
        const usedQty = Math.max(Number(existing.used_qty) || 0, Number(r.used_qty) || 0);
        byKey.set(key, {
            ...existing,
            issued_qty: issuedQty,
            used_qty: usedQty,
            remaining_qty: Math.max(0, issuedQty - usedQty),
            input_type: 'process_batch',
            source_po_num: r.source_po_num || existing.source_po_num,
            item_code: existing.item_code || r.item_code
        });
    }

    return dropUnsourcedProcessBatchDupes(
        Array.from(byKey.values()).map((row) => {
            const issued = Number(row.issued_qty) || 0;
            const used = Number(row.used_qty) || 0;
            return {
                ...row,
                remaining_qty: Math.max(0, issued - used)
            };
        }).sort((a, b) => {
            const ta = a.issued_at ? new Date(a.issued_at).getTime() : 0;
            const tb = b.issued_at ? new Date(b.issued_at).getTime() : 0;
            if (ta !== tb) return ta - tb;
            const pa = String(a.source_po_num || '');
            const pb = String(b.source_po_num || '');
            if (pa !== pb) return pa.localeCompare(pb);
            return String(a.batch_number).localeCompare(String(b.batch_number));
        }),
        processTags
    );
}

/**
 * Inputs available for report completion: raw rolls (no process BOM line) or
 * previous-process output batches from source PO(s) per SAP BOM component lines.
 */
async function getProcessInputsWithRemaining(poNum, currentProcessTag, fgItemCode, sourcePoNums = null, bomProcessInputs = null) {
    const po = String(poNum || '').trim();
    await backfillRoleBatchUsageSourcePo(po);
    const bomInputs = Array.isArray(bomProcessInputs) ? bomProcessInputs : [];

    if (!bomInputs.length) {
        const rows = await getIssuedRolesWithRemaining(po);
        return rows.map((r) => ({
            ...r,
            input_type: 'raw_roll',
            source_batch: r.batch_number
        }));
    }

    return mergeProcessInputSources(po, bomInputs, sourcePoNums);
}

/** Cached SAP enrichment for a PO (customer, job, item — saved on PO load / job complete). */
function pickCacheField(...vals) {
    for (const v of vals) {
        const s = String(v ?? '').trim();
        if (s && s !== '—' && s !== '-') return s;
    }
    return '';
}

function normalizePOSapCachePayload(data = {}) {
    const abs = data.absoluteEntry ?? data.absolute_entry;
    const absNum = abs != null && abs !== '' ? Number(abs) : null;
    return {
        customer_name: pickCacheField(data.customerName, data.customer_name),
        customer_code: pickCacheField(data.customerCode, data.customer_code),
        job_no: pickCacheField(data.jobNo, data.job_no, data.jobNumber, data.job_number),
        item_code: pickCacheField(data.itemNo, data.item_no, data.item_code, data.fg_num),
        job_name: pickCacheField(data.jobName, data.job_name, data.productDescription),
        product_description: pickCacheField(data.productDescription, data.product_description, data.jobName),
        inventory_uom: pickCacheField(data.inventoryUOM, data.inventory_uom),
        item_code_label: pickCacheField(data.itemCodeLabel, data.item_code_label),
        u_job_ent: data.uJobEnt != null && data.uJobEnt !== ''
            ? String(data.uJobEnt).trim()
            : pickCacheField(data.u_job_ent),
        u_pcode: pickCacheField(data.uPCode, data.u_pcode),
        absolute_entry: Number.isFinite(absNum) ? absNum : null
    };
}

function hasPOSapCachePayload(payload) {
    return Boolean(
        payload.customer_name || payload.customer_code || payload.job_no
        || payload.item_code || payload.job_name || payload.product_description
    );
}

/** Full SAP cache row for a PO (MySQL po_customer_cache). */
async function getPOSapCache(poNum) {
    const po = String(poNum || '').trim();
    if (!po) return null;
    try {
        const [rows] = await pool.query(
            `SELECT po_num, customer_name, customer_code, job_no, item_code, job_name,
                    product_description, inventory_uom, item_code_label, u_job_ent,
                    u_pcode, absolute_entry, updated_at
               FROM po_customer_cache WHERE po_num = ?`,
            [po]
        );
        const row = rows[0];
        if (!row) return null;
        return {
            poNum: row.po_num,
            customerName: row.customer_name || '',
            customerCode: row.customer_code || '',
            jobNo: row.job_no || '',
            itemCode: row.item_code || '',
            jobName: row.job_name || '',
            productDescription: row.product_description || '',
            inventoryUOM: row.inventory_uom || '',
            itemCodeLabel: row.item_code_label || '',
            uJobEnt: row.u_job_ent || '',
            uPCode: row.u_pcode || '',
            absoluteEntry: row.absolute_entry != null ? Number(row.absolute_entry) : null,
            updatedAt: row.updated_at || null
        };
    } catch {
        return null;
    }
}

/** Save SAP enrichment snapshot for a PO (merges with existing row). */
async function upsertPOSapCache(poNum, data = {}) {
    const po = String(poNum || '').trim();
    if (!po) return false;
    const p = normalizePOSapCachePayload(data);
    if (!hasPOSapCachePayload(p)) return false;

    await pool.query(
        `INSERT INTO po_customer_cache (
            po_num, customer_name, customer_code, job_no, item_code, job_name,
            product_description, inventory_uom, item_code_label, u_job_ent,
            u_pcode, absolute_entry, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
            customer_name = COALESCE(NULLIF(VALUES(customer_name), ''), customer_name),
            customer_code = COALESCE(NULLIF(VALUES(customer_code), ''), customer_code),
            job_no = COALESCE(NULLIF(VALUES(job_no), ''), job_no),
            item_code = COALESCE(NULLIF(VALUES(item_code), ''), item_code),
            job_name = COALESCE(NULLIF(VALUES(job_name), ''), job_name),
            product_description = COALESCE(NULLIF(VALUES(product_description), ''), product_description),
            inventory_uom = COALESCE(NULLIF(VALUES(inventory_uom), ''), inventory_uom),
            item_code_label = COALESCE(NULLIF(VALUES(item_code_label), ''), item_code_label),
            u_job_ent = COALESCE(NULLIF(VALUES(u_job_ent), ''), u_job_ent),
            u_pcode = COALESCE(NULLIF(VALUES(u_pcode), ''), u_pcode),
            absolute_entry = COALESCE(VALUES(absolute_entry), absolute_entry),
            updated_at = CURRENT_TIMESTAMP`,
        [
            po,
            p.customer_name || null,
            p.customer_code || null,
            p.job_no || null,
            p.item_code || null,
            p.job_name || null,
            p.product_description || null,
            p.inventory_uom || null,
            p.item_code_label || null,
            p.u_job_ent || null,
            p.u_pcode || null,
            p.absolute_entry
        ]
    );
    return true;
}

/** Cached customer name for a PO (saved on PO load / job complete / label enrich). */
async function getPOCustomerName(poNum) {
    const cached = await getPOSapCache(poNum);
    return cached?.customerName || '';
}

async function upsertPOCustomerName(poNum, customerName) {
    return upsertPOSapCache(poNum, { customerName });
}

/**
 * Build process output label payload from saved production + traceability data.
 * Requires PO; optional output batch (latest batch for PO if omitted).
 */
async function getProcessLabelDataFromDB(poNum, outputBatch = null) {
    const po = String(poNum || '').trim();
    if (!po) return null;
    const batch = outputBatch != null ? String(outputBatch).trim() : '';

    const params = batch ? [po, batch] : [po];
    const batchClause = batch ? ' AND batch_num = ?' : '';
    const [prodRows] = await pool.query(
        `SELECT batch_num, po_num, fg_num, job_name, operator_name, machine_name,
                process_name, quantity_processed, job_end_time, job_start_time
           FROM production_records
          WHERE po_num = ?${batchClause}
          ORDER BY job_end_time IS NULL, job_end_time DESC, unique_id DESC
          LIMIT 1`,
        params
    );
    const prod = prodRows[0];
    if (!prod?.batch_num) return null;

    const inputs = await getGenealogyByOutputBatch(prod.batch_num, po);
    const sapCache = await getPOSapCache(po);
    const customerName = sapCache?.customerName || '';
    const packedDate = prod.job_end_time || prod.job_start_time;
    let packedOn = '';
    if (packedDate) {
        const dt = new Date(packedDate);
        packedOn = isNaN(dt) ? String(packedDate) : dt.toLocaleDateString('en-IN');
    }

    return {
        poNumber: po,
        po_num: po,
        outputBatch: prod.batch_num,
        batchNo: prod.batch_num,
        itemCode: prod.fg_num || sapCache?.itemCode || null,
        fgCode: prod.fg_num || sapCache?.itemCode || '—',
        itemDescription: prod.job_name || sapCache?.jobName || prod.fg_num || '—',
        jobName: prod.job_name || sapCache?.jobName || null,
        actualOutput: Number(prod.quantity_processed) || 0,
        quantity: Number(prod.quantity_processed) || 0,
        operator: prod.operator_name || '—',
        machineName: formatMachineDisplayName(prod.machine_name) || prod.machine_name || '—',
        processName: prod.process_name || null,
        packedOn,
        customerName: customerName || null,
        customerCode: sapCache?.customerCode || null,
        jobNo: sapCache?.jobNo || null,
        roleUsages: inputs.map((i) => ({
            batch_number: i.batch_number,
            quantity_used: Number(i.quantity) || 0,
            item_code: i.item_code,
            source_po_num: i.source_po_num || null
        }))
    };
}

/** List output batches for a PO (for label reprint picker). */
async function listOutputBatchesForPO(poNum) {
    const po = String(poNum || '').trim();
    if (!po) return [];
    const [rows] = await pool.query(
        `SELECT batch_num AS batch_num,
                MAX(fg_num) AS fg_num,
                MAX(quantity_processed) AS quantity_processed,
                MAX(u_width) AS u_width,
                MAX(u_length) AS u_length,
                MAX(job_end_time) AS job_end_time,
                MAX(operator_name) AS operator_name,
                MAX(process_name) AS process_name,
                MAX(machine_name) AS machine_name
           FROM production_records
          WHERE po_num = ?
          GROUP BY batch_num
          ORDER BY batch_num ASC`,
        [po]
    );
    return rows.map((r) => ({
        outputBatch: r.batch_num,
        itemCode: r.fg_num,
        quantity: Number(r.quantity_processed) || 0,
        uWidth: r.u_width != null ? Number(r.u_width) : null,
        uLength: r.u_length != null ? Number(r.u_length) : null,
        completedAt: r.job_end_time,
        operator: r.operator_name,
        processName: r.process_name,
        machineName: r.machine_name
    }));
}

/** Read item/operator for an existing output batch (no insert). */
async function getOutputBatchMeta(poNum, batchNum) {
    const po = String(poNum || '').trim();
    const batch = String(batchNum || '').trim();
    if (!po || !batch) return null;
    const [rows] = await pool.query(
        `SELECT MAX(fg_num) AS fg_num,
                MAX(operator_name) AS operator_name,
                COUNT(*) AS row_count
           FROM production_records
          WHERE po_num = ? AND batch_num = ?`,
        [po, batch]
    );
    const row = rows[0];
    if (!row || !Number(row.row_count)) return null;
    return {
        itemCode: row.fg_num || null,
        operatorName: row.operator_name || null,
        rowCount: Number(row.row_count) || 0
    };
}

/** Update width/length on every activity row for one output batch on a PO. */
async function updateOutputBatchDimensions(poNum, batchNum, width, length) {
    const po = String(poNum || '').trim();
    const batch = String(batchNum || '').trim();
    const w = Number(width);
    const l = Number(length);
    if (!po || !batch) {
        throw new Error('PO number and batch number are required');
    }
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(l) || l <= 0) {
        throw new Error('Width and length must be greater than 0');
    }
    const [result] = await pool.query(
        `UPDATE production_records
            SET u_width = ?, u_length = ?
          WHERE po_num = ? AND batch_num = ?`,
        [w, l, po, batch]
    );
    if (!result.affectedRows) {
        return { updated: 0, itemCode: null, operatorName: null };
    }
    const [metaRows] = await pool.query(
        `SELECT MAX(fg_num) AS fg_num, MAX(operator_name) AS operator_name
           FROM production_records
          WHERE po_num = ? AND batch_num = ?
          LIMIT 1`,
        [po, batch]
    );
    return {
        updated: result.affectedRows,
        itemCode: metaRows[0]?.fg_num || null,
        operatorName: metaRows[0]?.operator_name || null,
        uWidth: w,
    uLength: l
    };
}

/**
 * Ensure raw_material_mirror exists (safe to call before sync).
 */
async function ensureRawMaterialMirrorTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS raw_material_mirror (
            id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            item_code         VARCHAR(64)     NOT NULL,
            item_description  VARCHAR(255)    NULL,
            admission_date    DATETIME        NULL,
            batch_no          VARCHAR(80)     NOT NULL,
            balance_qty       DECIMAL(18,4)   NOT NULL DEFAULT 0,
            width             DECIMAL(18,4)   NULL,
            length            DECIMAL(18,4)   NULL,
            thickness         DECIMAL(18,4)   NULL,
            base_roll_no      VARCHAR(80)     NULL,
            grade             VARCHAR(64)     NULL,
            supplier_name     VARCHAR(255)    NULL,
            warehouse_code    VARCHAR(32)     NOT NULL DEFAULT 'FBD-RM',
            synced_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uk_rm_batch_item (batch_no, item_code),
            KEY idx_rm_batch (batch_no),
            KEY idx_rm_item (item_code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

function dedupeRawMaterialMirrorRows(rows) {
    const map = new Map();
    for (const r of rows || []) {
        const itemCode = String(r.item_code || r.itemCode || '').trim();
        const batchNo = String(r.batch_no || r.batchNo || '').trim();
        if (!itemCode || !batchNo) continue;
        const key = `${batchNo.toUpperCase()}||${itemCode.toUpperCase()}`;
        const qty = Number(r.balance_qty ?? r.balanceQty ?? r.quantity ?? 0) || 0;
        const existing = map.get(key);
        if (!existing) {
            map.set(key, {
                item_code: itemCode,
                item_description: r.item_description || r.itemDescription || null,
                admission_date: r.admission_date || r.admissionDate || null,
                batch_no: batchNo,
                balance_qty: qty,
                width: r.width != null && r.width !== '' ? Number(r.width) : null,
                length: r.length != null && r.length !== '' ? Number(r.length) : null,
                thickness: r.thickness != null && r.thickness !== '' ? Number(r.thickness) : null,
                base_roll_no: r.base_roll_no || r.baseRollNo || null,
                grade: r.grade || null,
                supplier_name: r.supplier_name || r.supplierName || null,
                warehouse_code: r.warehouse_code || r.warehouseCode || 'FBD-RM'
            });
            continue;
        }
        existing.balance_qty = (Number(existing.balance_qty) || 0) + qty;
        if (!existing.item_description && (r.item_description || r.itemDescription)) {
            existing.item_description = r.item_description || r.itemDescription;
        }
        if (!existing.admission_date && (r.admission_date || r.admissionDate)) {
            existing.admission_date = r.admission_date || r.admissionDate;
        }
        if (existing.width == null && r.width != null && r.width !== '') existing.width = Number(r.width);
        if (existing.length == null && r.length != null && r.length !== '') existing.length = Number(r.length);
        if (existing.thickness == null && r.thickness != null && r.thickness !== '') existing.thickness = Number(r.thickness);
        if (!existing.base_roll_no && (r.base_roll_no || r.baseRollNo)) {
            existing.base_roll_no = r.base_roll_no || r.baseRollNo;
        }
        if (!existing.grade && r.grade) existing.grade = r.grade;
        if (!existing.supplier_name && (r.supplier_name || r.supplierName)) {
            existing.supplier_name = r.supplier_name || r.supplierName;
        }
    }
    return Array.from(map.values());
}

/**
 * Upsert SAP FBD-RM rows into raw_material_mirror.
 * Never deletes local history — SAP-gone rolls stay for future label reprint.
 * Duplicates keyed by (batch_no, item_code) are updated in place.
 */
async function replaceRawMaterialMirror(rows) {
    const list = dedupeRawMaterialMirrorRows(rows);
    await ensureRawMaterialMirrorTable();
    const conn = await mysqlPool.getConnection();
    try {
        await conn.beginTransaction();
        let upserted = 0;
        const chunkSize = 200;
        for (let i = 0; i < list.length; i += chunkSize) {
            const chunk = list.slice(i, i + chunkSize);
            if (!chunk.length) continue;
            const values = chunk.map((r) => [
                r.item_code,
                r.item_description,
                r.admission_date,
                r.batch_no,
                Number(r.balance_qty) || 0,
                r.width,
                r.length,
                r.thickness,
                r.base_roll_no,
                r.grade,
                r.supplier_name,
                r.warehouse_code || 'FBD-RM'
            ]);
            await conn.query(
                `INSERT INTO raw_material_mirror
                    (item_code, item_description, admission_date, batch_no, balance_qty,
                     width, length, thickness, base_roll_no, grade, supplier_name, warehouse_code)
                 VALUES ?
                 ON DUPLICATE KEY UPDATE
                    item_description = VALUES(item_description),
                    admission_date   = VALUES(admission_date),
                    balance_qty      = VALUES(balance_qty),
                    width            = VALUES(width),
                    length           = VALUES(length),
                    thickness        = VALUES(thickness),
                    base_roll_no     = VALUES(base_roll_no),
                    grade            = VALUES(grade),
                    supplier_name    = VALUES(supplier_name),
                    warehouse_code   = VALUES(warehouse_code),
                    synced_at        = CURRENT_TIMESTAMP`,
                [values]
            );
            upserted += values.length;
        }
        await conn.commit();
        return {
            inserted: upserted,
            upserted,
            total: list.length,
            sapRows: Array.isArray(rows) ? rows.length : 0,
            retainedHistory: true
        };
    } catch (err) {
        try { await conn.rollback(); } catch (_) { /* ignore */ }
        throw err;
    } finally {
        conn.release();
    }
}

async function findRawMaterialByBatch(batchNo) {
    const batch = String(batchNo || '').trim();
    if (!batch) return [];
    const [rows] = await pool.query(
        `SELECT id, item_code, item_description, admission_date, batch_no, balance_qty,
                width, length, thickness, base_roll_no, grade, supplier_name,
                warehouse_code, synced_at
           FROM raw_material_mirror
          WHERE batch_no = ? OR UPPER(TRIM(batch_no)) = UPPER(?)
          ORDER BY item_code
          LIMIT 50`,
        [batch, batch]
    );
    if (rows.length) return rows.map(mapRawMaterialMirrorRow);
    const [likeRows] = await pool.query(
        `SELECT id, item_code, item_description, admission_date, batch_no, balance_qty,
                width, length, thickness, base_roll_no, grade, supplier_name,
                warehouse_code, synced_at
           FROM raw_material_mirror
          WHERE batch_no LIKE ?
          ORDER BY batch_no, item_code
          LIMIT 50`,
        [`%${batch}%`]
    );
    return likeRows.map(mapRawMaterialMirrorRow);
}

function mapRawMaterialMirrorRow(r) {
    return {
        id: r.id,
        itemCode: r.item_code,
        itemDescription: r.item_description,
        admissionDate: r.admission_date,
        batchNo: r.batch_no,
        balanceQty: r.balance_qty != null ? Number(r.balance_qty) : 0,
        width: r.width != null ? Number(r.width) : null,
        length: r.length != null ? Number(r.length) : null,
        thickness: r.thickness != null ? Number(r.thickness) : null,
        baseRollNo: r.base_roll_no,
        grade: r.grade,
        supplierName: r.supplier_name,
        warehouseCode: r.warehouse_code,
        syncedAt: r.synced_at
    };
}

async function getRawMaterialMirrorStats() {
    // Return wall-clock string from MySQL (no Date → JSON UTC shift in the browser).
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS cnt,
                DATE_FORMAT(MAX(synced_at), '%Y-%m-%d %H:%i:%s') AS last_synced
           FROM raw_material_mirror`
    );
    return {
        count: Number(rows[0]?.cnt) || 0,
        lastSynced: rows[0]?.last_synced || null
    };
}

module.exports = {
    pool,
    testConnection,
    ensureSchema,
    recordMaterialIssue,
    recordMaterialIssues,
    recordMaterialIssueIfAbsent,
    upsertMaterialIssueSapTotal,
    dedupeMaterialIssueLog,
    linkOutputBatchToIssues,
    linkIssuesToOutputBatch,
    getIssuedRolesWithRemaining,
    getProcessInputsWithRemaining,
    getPreviousProcessOutputBatches,
    getPreviousProcessOutputBatchesByItemCode,
    findSourceProcessPOsFromLocalDb,
    pickLatestSourcePosBeforeCurrent,
    extractUnit1ProcessBomInputs,
    mergeProcessInputSources,
    buildPrevProcessBatchPattern,
    derivePrevProcessInputItemCode,
    makeProcessBatchIssueId,
    traceInputKey,
    sumRoleBatchUsageForInput,
    backfillRoleBatchUsageSourcePo,
    formatMachineDisplayName,
    getPreviousUnit1ProcessTag,
    getUnit1ProcessChainIndex,
    isTerminalUnit1Process,
    isUnit1OutsourcedMetallisationProcess,
    shouldSkipUnit1CrossPoAutoIssue,
    isDownstreamUnit1Process,
    UNIT1_PROCESS_CHAIN,
    recordRoleBatchUsages,
    reconcileUnlinkedOutputBatchUsages,
    backfillRoleBatchUsageOperators,
    resolveCompletionOperatorMeta,
    getGenealogyByPO,
    getGenealogyByOutputBatch,
    getOutputBatchOwnerPO,
    outputBatchBelongsToPO,
    getPOTraceabilitySummary,
    getProcessLabelDataFromDB,
    getPOCustomerName,
    upsertPOCustomerName,
    getPOSapCache,
    upsertPOSapCache,
    listOutputBatchesForPO,
    getOutputBatchMeta,
    updateOutputBatchDimensions,
    getTraceabilityByPO,
    getTraceabilityByOutputBatch,
    getBatchNum,
    getUnit1BatchNum,
    inferUnit1ProcessTagFromItemCode,
    getUnit1ProcessBatchTag,
    buildUnit1BatchPrefix,
    parseUnit1BatchSeq,
    normalizeProcessBatchTag,
    formatProcessBatchNumber,
    isProcessBatchNumber,
    insertActivityRecord,
    insertJobActivities,
    resolveJobCompletionBatchNum,
    getActivitiesByBatchNum,
    getBatchesByPO,
    sumCompletedQtyByPO,
    sumWastageQtyByPO,
    getEmbossingQuantitiesByPO,
    getJobSummary,
    getShiftSummary,
    getActivitiesByMachineAndDate,
    updateActivityRecord,
    updateBatchActivities,
    deleteActivityRecord,
    deleteBatch,
    deleteRecordsByPO,
    markPOLocalReset,
    findRecentDuplicateJobCompletion,
    clearPOLocalReset,
    isPOLocallyReset,
    getBestPerformance,
    ensureRawMaterialMirrorTable,
    replaceRawMaterialMirror,
    findRawMaterialByBatch,
    getRawMaterialMirrorStats
};
