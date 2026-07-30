/**
 * D1-Adapter (P3.2). Gegenstueck zu node-sqlite-adapter.mjs: dieselbe kleine
 * asynchrone `all()`/`get()`-Schnittstelle, damit worker/src/core/** UNVERAENDERT
 * gegen beide laeuft -- lokal gegen node:sqlite, in Cloudflare gegen D1.
 *
 * Es gibt bewusst KEINE weitere Methode. Kein `run()`, kein `batch()`, kein
 * `exec()`: der Worker ist read-only. Datenaenderungen und Release-Umschaltungen
 * laufen ausserhalb (worker/tools/atlas-release.mjs plus `wrangler d1 execute`),
 * damit ein oeffentlich erreichbarer Endpunkt den Fachbestand nicht schreiben
 * kann -- auch nicht durch einen Programmierfehler.
 *
 * @param {{ prepare(sql: string): any }} d1 das D1-Binding (env.DB)
 */
export function createD1Adapter(d1) {
  function bound(sql, params) {
    const statement = d1.prepare(sql);
    return params.length ? statement.bind(...params) : statement;
  }

  return {
    /**
     * @param {string} sql
     * @param {...any} params
     * @returns {Promise<any[]>}
     */
    async all(sql, ...params) {
      const result = await bound(sql, params).all();
      // D1 liefert { success, results, meta }. `results` fehlt bei Anweisungen
      // ohne Ergebnismenge -- dann eine leere Liste, nie undefined, damit die
      // Kernlogik keinen Adapter-Sonderfall kennen muss.
      return result?.results ?? [];
    },
    /**
     * @param {string} sql
     * @param {...any} params
     * @returns {Promise<any | undefined>}
     */
    async get(sql, ...params) {
      // D1s first() gibt null zurueck, node:sqlite's get() undefined. Die
      // Kernlogik prueft ueberall auf Falsy (`if (!row)`), aber der Contract-Test
      // vergleicht Antworten feldweise -- deshalb hier auf undefined
      // normalisiert, damit beide Adapter dieselbe Antwort erzeugen.
      const row = await bound(sql, params).first();
      return row === null ? undefined : row;
    },
  };
}
