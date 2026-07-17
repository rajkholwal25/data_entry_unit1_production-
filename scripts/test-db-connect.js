#!/usr/bin/env node
/**
 * Quick MySQL connectivity test (run on saturn host or inside container).
 *   node scripts/test-db-connect.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const net = require('net');

const host = process.env.DB_HOST || 'localhost';
const port = parseInt(process.env.DB_PORT, 10) || 3306;
const user = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD || '';
const database = process.env.DB_NAME || 'sap';

function tcpProbe(h, p, ms = 5000) {
    return new Promise((resolve) => {
        const sock = net.connect({ host: h, port: p, timeout: ms });
        sock.on('connect', () => { sock.destroy(); resolve({ ok: true }); });
        sock.on('error', (err) => { sock.destroy(); resolve({ ok: false, error: err.message }); });
        sock.on('timeout', () => { sock.destroy(); resolve({ ok: false, error: 'timeout' }); });
    });
}

(async () => {
    console.log(`\n🔌 DB probe: ${host}:${port} (db=${database}, user=${user})`);
    const probe = await tcpProbe(host, port);
    if (!probe.ok) {
        console.error(`❌ TCP failed: ${probe.error}`);
        console.error('   → Fix DB_HOST / VPN / firewall. On Linux Docker use network_mode: host.');
        process.exit(1);
    }
    console.log('✅ TCP port open');

    try {
        const conn = await mysql.createConnection({
            host, port, user, password, database, connectTimeout: 8000
        });
        await conn.ping();
        await conn.end();
        console.log('✅ MySQL login OK\n');
    } catch (err) {
        console.error(`❌ MySQL auth/db error: ${err.message}\n`);
        process.exit(1);
    }
})();
