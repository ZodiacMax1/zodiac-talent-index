import { getDatabase } from '@netlify/database';

let _db;
export function pool() {
  if (!_db) _db = getDatabase();
  return _db.pool;
}

export async function query(text, params = []) {
  const r = await pool().query(text, params);
  return r.rows;
}

// Bump the change counter and return the new version
export async function bump(client) {
  const run = client ? client.query.bind(client) : pool().query.bind(pool());
  const r = await run('UPDATE sync_state SET version = version + 1 WHERE id = 1 RETURNING version');
  return Number(r.rows[0].version);
}

export async function currentVersion() {
  const rows = await query('SELECT version FROM sync_state WHERE id = 1');
  return rows[0] ? Number(rows[0].version) : 0;
}
