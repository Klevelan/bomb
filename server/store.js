'use strict';
// Leaderboard storage.
// With DATABASE_URL set (e.g. a free Neon Postgres database), rankings are saved permanently.
// Without it, they live in memory: fine for testing on your PC, but they reset whenever the
// server restarts or goes to sleep.

const { START_RATING } = require('../public/ranks.js');

function memoryStore() {
  const rows = new Map();
  return {
    kind: 'memory',
    async init() {},
    async get(ids) {
      const out = {};
      for (const id of ids) if (rows.has(id)) out[id] = { ...rows.get(id) };
      return out;
    },
    async save(results) {
      for (const r of results) {
        const cur = rows.get(r.id) || { id: r.id, rating: START_RATING, wins: 0, matches: 0, kills: 0 };
        rows.set(r.id, {
          ...cur, name: r.name, rating: r.rating,
          wins: cur.wins + (r.won ? 1 : 0), matches: cur.matches + 1, kills: cur.kills + r.kills,
        });
      }
    },
    async top(limit) {
      return [...rows.values()]
        .sort((a, b) => b.rating - a.rating || b.wins - a.wins)
        .slice(0, limit)
        .map(({ id, name, rating, wins, matches }) => ({ id, name, rating, wins, matches }));
    },
    async position(rating) {
      let n = 1;
      for (const r of rows.values()) if (r.rating > rating) n++;
      return n;
    },
    async count() { return rows.size; },
  };
}

function postgresStore(url) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 20000 });
  // Neon pauses idle databases and drops connections; don't let that crash the server.
  pool.on('error', (err) => console.error('Database connection dropped (will reconnect):', err.message));

  return {
    kind: 'postgres',
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS players (
          id         TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
          rating     INTEGER NOT NULL DEFAULT ${START_RATING},
          wins       INTEGER NOT NULL DEFAULT 0,
          matches    INTEGER NOT NULL DEFAULT 0,
          kills      INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await pool.query('CREATE INDEX IF NOT EXISTS players_rating_idx ON players (rating DESC)');
    },
    async get(ids) {
      if (!ids.length) return {};
      const { rows } = await pool.query(
        'SELECT id, name, rating, wins, matches, kills FROM players WHERE id = ANY($1::text[])', [ids]);
      const out = {};
      for (const r of rows) out[r.id] = r;
      return out;
    },
    async save(results) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const r of results) {
          await client.query(
            `INSERT INTO players (id, name, rating, wins, matches, kills)
             VALUES ($1, $2, $3, $4, 1, $5)
             ON CONFLICT (id) DO UPDATE SET
               name = EXCLUDED.name,
               rating = EXCLUDED.rating,
               wins = players.wins + EXCLUDED.wins,
               matches = players.matches + 1,
               kills = players.kills + EXCLUDED.kills,
               updated_at = now()`,
            [r.id, r.name, r.rating, r.won ? 1 : 0, r.kills]);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async top(limit) {
      const { rows } = await pool.query(
        'SELECT id, name, rating, wins, matches FROM players ORDER BY rating DESC, wins DESC LIMIT $1', [limit]);
      return rows;
    },
    async position(rating) {
      const { rows } = await pool.query('SELECT COUNT(*)::int + 1 AS pos FROM players WHERE rating > $1', [rating]);
      return rows[0].pos;
    },
    async count() {
      const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM players');
      return rows[0].n;
    },
  };
}

function createStore() {
  const url = process.env.DATABASE_URL;
  if (url) return postgresStore(url);
  console.warn('DATABASE_URL is not set: the leaderboard is kept in memory and resets when the server restarts.');
  return memoryStore();
}

module.exports = { createStore };
