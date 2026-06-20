const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const config = require('../src/config');

if (!config.databaseUrl) throw new Error('Defina DATABASE_URL no arquivo .env');

async function main() {
  const pool = new Pool({ connectionString: config.databaseUrl, ssl: config.databaseSsl ? { rejectUnauthorized: false } : false });
  const client = await pool.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const directory = path.join(__dirname, '..', 'migrations');
    const files = fs.readdirSync(directory).filter(name => name.endsWith('.sql')).sort();
    for (const file of files) {
      const exists = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [file]);
      if (exists.rowCount) { console.log(`Ignorada: ${file}`); continue; }
      await client.query('BEGIN');
      try {
        await client.query(fs.readFileSync(path.join(directory, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [file]);
        await client.query('COMMIT');
        console.log(`Aplicada: ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
