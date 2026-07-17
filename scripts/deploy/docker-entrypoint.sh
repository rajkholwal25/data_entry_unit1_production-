#!/bin/sh
set -e

if [ "${DB_WAIT_ON_START:-true}" = "true" ]; then
  echo "Waiting for MySQL at ${DB_HOST:-localhost}:${DB_PORT:-3306}..."
  node <<'EOF'
require('dotenv').config();
const mysql = require('mysql2/promise');

const maxAttempts = parseInt(process.env.DB_WAIT_MAX_ATTEMPTS || '30', 10);
const delayMs = parseInt(process.env.DB_WAIT_DELAY_MS || '2000', 10);

async function waitForDb() {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const conn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT, 10) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        connectTimeout: 5000
      });
      await conn.ping();
      await conn.end();
      console.log('MySQL is ready.');
      return;
    } catch (err) {
      console.log(`Attempt ${attempt}/${maxAttempts}: ${err.message}`);
      if (attempt === maxAttempts) {
        const h = process.env.DB_HOST || 'localhost';
        const p = process.env.DB_PORT || '3306';
        console.error('MySQL did not become ready in time.');
        if (String(err.message || '').includes('EHOSTUNREACH')) {
          console.error(`\n❌ Cannot route to ${h}:${p} from this container.`);
          console.error('   1) On saturn host run:  ping -c 2 ' + h);
          console.error('   2) If ping fails → connect VPN or fix DB_HOST in .env');
          console.error('   3) If ping works → use network_mode: host in docker-compose.yml');
          console.error('   4) Test: node scripts/test-db-connect.js\n');
        }
        process.exit(1);
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

waitForDb();
EOF
fi

exec node server.js
