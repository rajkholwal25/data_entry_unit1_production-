-- ============================================================================
-- Unit 1 Data Entry — MySQL schema
-- Run once on your MySQL server (create database first if needed):
--   CREATE DATABASE Sap CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--   USE Sap;
--   SOURCE schema.sql;
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- Batch number counter (legacy B000001, …)
CREATE TABLE IF NOT EXISTS batch_num_seq (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Global per-process batch sequence (EMB26000001, MET26000002, …)
CREATE TABLE IF NOT EXISTS process_batch_seq (
    process_tag VARCHAR(8) NOT NULL,
    last_seq    BIGINT UNSIGNED NOT NULL DEFAULT 26000000,
    PRIMARY KEY (process_tag)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
    u_width                    DECIMAL(18,4)   NULL,
    u_length                   DECIMAL(18,4)   NULL,
    role_quantity_used         DECIMAL(18,4)   NULL,
    chemical_quantity_used     DECIMAL(18,4)   NULL,
    speed_impressions_per_hour DECIMAL(18,4)   DEFAULT 0,
    sheets_wasted              INT             DEFAULT 0,
    remark                     TEXT            NULL,
    activity_name              VARCHAR(64)     NULL,
    activity_time_minutes      DECIMAL(18,4)   DEFAULT 0,
    device_id                  VARCHAR(64)     NULL,
    date_of_entry              DATETIME        DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (unique_id),
    KEY idx_pr_batch (batch_num),
    KEY idx_pr_po (po_num),
    KEY idx_pr_fg (fg_num),
    KEY idx_pr_machine (machine_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
    PRIMARY KEY (po_num),
    KEY idx_po_customer_cache_po (po_num)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS po_local_reset (
    po_num    VARCHAR(64) NOT NULL,
    reset_at  DATETIME    DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (po_num)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
    PRIMARY KEY (issue_id),
    UNIQUE KEY uq_mil_po_batch (po_num, batch_number),
    KEY idx_mil_po (po_num),
    KEY idx_mil_batch (batch_number),
    KEY idx_mil_output (output_batch)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
    PRIMARY KEY (usage_id),
    KEY idx_rbu_po (po_num),
    KEY idx_rbu_issue (issue_id),
    KEY idx_rbu_output (output_batch)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Live tracking tables
CREATE TABLE IF NOT EXISTS machine_shift_sessions (
    session_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    machine_id     VARCHAR(64)     NOT NULL,
    machine_name   VARCHAR(128)    NULL,
    category       VARCHAR(32)     NULL,
    process        VARCHAR(64)     NULL,
    operator_name  VARCHAR(128)    NOT NULL,
    shift_type     VARCHAR(8)      NOT NULL,
    shift_date     DATE            NOT NULL,
    login_time     DATETIME        NOT NULL,
    logout_time    DATETIME        NULL,
    logout_reason  VARCHAR(32)     NULL,
    device_id      VARCHAR(64)     NULL,
    status         VARCHAR(8)      NOT NULL DEFAULT 'active',
    created_at     DATETIME        DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (session_id),
    KEY idx_mss_machine_status (machine_id, status),
    KEY idx_mss_shift (shift_date, shift_type),
    KEY idx_mss_operator (operator_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS machine_status (
    machine_id          VARCHAR(64)  NOT NULL,
    machine_name        VARCHAR(128) NULL,
    category            VARCHAR(32)  NULL,
    process             VARCHAR(64)  NULL,
    current_session_id  BIGINT       NULL,
    current_operator    VARCHAR(128) NULL,
    shift_type          VARCHAR(8)   NULL,
    shift_date          DATE         NULL,
    is_online           TINYINT      NOT NULL DEFAULT 0,
    current_job_po      VARCHAR(64)  NULL,
    current_job_name    VARCHAR(255) NULL,
    current_fg_num      VARCHAR(64)  NULL,
    job_planned_qty     INT          NULL,
    job_loaded_at       DATETIME     NULL,
    current_state       VARCHAR(32)  NULL,
    state_started_at    DATETIME     NULL,
    last_event_at       DATETIME     NULL,
    updated_at          DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (machine_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS machine_state_history (
    id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    machine_id       VARCHAR(64)     NOT NULL,
    machine_name     VARCHAR(128)    NULL,
    session_id       BIGINT          NULL,
    operator_name    VARCHAR(128)    NULL,
    shift_type       VARCHAR(8)      NULL,
    shift_date       DATE            NULL,
    job_po           VARCHAR(64)     NULL,
    job_name         VARCHAR(255)    NULL,
    state            VARCHAR(32)     NOT NULL,
    started_at       DATETIME        NOT NULL,
    ended_at         DATETIME        NULL,
    duration_seconds INT             NULL,
    PRIMARY KEY (id),
    KEY idx_msh_machine (machine_id, started_at),
    KEY idx_msh_open (machine_id, ended_at),
    KEY idx_msh_session (session_id),
    KEY idx_msh_shift (shift_date, shift_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Views (drop first so column changes can be reapplied)
DROP VIEW IF EXISTS vw_shift_summary;
DROP VIEW IF EXISTS vw_job_summary;
DROP VIEW IF EXISTS vw_batch_summary;

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
 GROUP BY batch_num, po_num;

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
 GROUP BY batch_num, po_num;

CREATE VIEW vw_shift_summary AS
SELECT machine_name,
       DATE(job_start_time)        AS shift_date,
       shift_type,
       COUNT(DISTINCT batch_num)   AS job_count,
       SUM(quantity_processed)     AS total_quantity,
       SUM(sheets_wasted)          AS total_sheets_wasted,
       SUM(activity_time_minutes)  AS total_minutes
  FROM production_records
 GROUP BY machine_name, DATE(job_start_time), shift_type;

SET FOREIGN_KEY_CHECKS = 1;
