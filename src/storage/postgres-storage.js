const { Pool } = require('pg');

function createPostgresStorage({ connectionString, ssl, seed }) {
  const pool = new Pool({
    connectionString,
    ssl: ssl ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  return {
    async initialize() {
      const client = await pool.connect();
      try {
        await client.query('SELECT 1');
        const result = await client.query('SELECT state FROM app_state WHERE id = 1');
        if (!result.rowCount) {
          const state = seed();
          await client.query('INSERT INTO app_state (id, version, state) VALUES (1, $1, $2::jsonb)', [state.meta.version, JSON.stringify(state)]);
        }
      } finally { client.release(); }
    },
    async getState() {
      const result = await pool.query('SELECT state FROM app_state WHERE id = 1');
      if (!result.rowCount) throw new Error('Estado inicial não encontrado no PostgreSQL');
      return result.rows[0].state;
    },
    async saveState(state, expectedVersion) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const current = await client.query('SELECT version FROM app_state WHERE id = 1 FOR UPDATE');
        if (!current.rowCount || Number(current.rows[0].version) !== Number(expectedVersion)) {
          const error = new Error('Os dados foram atualizados por outra pessoa. Recarregue a página.');
          error.statusCode = 409;
          throw error;
        }
        const version = Number(expectedVersion) + 1;
        state.meta = { ...(state.meta || {}), updatedAt: new Date().toISOString(), version };
        await client.query('UPDATE app_state SET version=$1, state=$2::jsonb, updated_at=NOW() WHERE id=1', [version, JSON.stringify(state)]);
        await client.query('INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,$4,$5::jsonb)', [state.currentUser || null, 'state.updated', 'workspace', '1', JSON.stringify({ version })]);
        await client.query('COMMIT');
        return state;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    },
    async reset() {
      const current = await this.getState();
      const state = seed();
      state.meta.version = Number(current.meta?.version || 0);
      return this.saveState(state, state.meta.version);
    },
    async close() { await pool.end(); },
  };
}

module.exports = { createPostgresStorage };
