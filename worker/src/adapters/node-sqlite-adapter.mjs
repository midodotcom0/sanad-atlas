/**
 * Node:sqlite-Adapter (P3.2). Implementiert dieselbe kleine asynchrone
 * db.all()/db.get()-Schnittstelle wie der D1-Adapter (worker/src/adapters/
 * d1-adapter.ts), damit worker/src/core/** (Router, Queries) UNVERAENDERT
 * gegen beide laeuft. Node's node:sqlite DatabaseSync ist synchron; die
 * Methoden hier sind trotzdem `async`, damit ein Aufrufer nie zwischen den
 * beiden Adaptern unterscheiden muss.
 *
 * Zweck: Kernlogik ohne Cloudflare/wrangler testbar machen (Sandbox-Zwang:
 * kein npm install, kein wrangler) -- siehe tests/worker-*.check.mjs, die
 * ausschliesslich gegen diesen Adapter laufen.
 *
 * @param {any} db eine offene node:sqlite DatabaseSync-Instanz
 */
export function createNodeSqliteAdapter(db) {
  return {
    /**
     * @param {string} sql
     * @param {...any} params
     * @returns {Promise<any[]>}
     */
    async all(sql, ...params) {
      return db.prepare(sql).all(...params);
    },
    /**
     * @param {string} sql
     * @param {...any} params
     * @returns {Promise<any | undefined>}
     */
    async get(sql, ...params) {
      return db.prepare(sql).get(...params);
    },
  };
}
