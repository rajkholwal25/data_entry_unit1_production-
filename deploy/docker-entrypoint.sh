#!/bin/sh
set -e

if [ "${DB_WAIT_ON_START:-true}" = "true" ]; then
  echo "Waiting for MySQL at ${DB_HOST:-192.168.3.12}:${DB_PORT:-3306}..."
  node <<'EOF'
require('dotenv').config();
const mysql = require('mysql2/promise');

const host = process.env.DB_HOST;
const port = parseInt(process.env.DB_PORT, 10) || 3306;
const maxAttempts = parseInt(process.env.DB_WAIT_MAX_ATTEMPTS || '30', 10);
const delayMs = parseInt(process.env.DB_WAIT_DELAY_MS || '2000', 10);

if (!host) {
  console.error('DB_HOST is required in .env (server deploy only).');
  process.exit(1);
}

async function waitForDb() {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const conn = await mysql.createConnection({
        host,
        port,
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
        console.error(`MySQL did not become ready at ${host}:${port}.`);
        console.error('Check: MySQL server is on, DB_HOST in .env is correct, saturn can ping DB_HOST.');
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
