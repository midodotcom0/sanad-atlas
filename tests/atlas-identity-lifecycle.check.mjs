/**
 * P4.5-Abnahme: kanonische ID, Alias, Merge, Split/Undo und erneuter Merge.
 *
 * Der Test laedt das echte database/schema.sql durch denselben SQLite-
 * Uebersetzer wie der Atlas-Build. Er bildet danach den redaktionellen
 * Zustandswechsel direkt in den historienfuehrenden Tabellen ab. So prueft er
 * nicht nur einen Mock-Resolver, sondern zugleich die produktiven Constraints:
 *
 *   A@r1 + B@r1 --Merge--> B@r2 --Split/Undo--> A@r1 + B@r3
 *                                      --erneuter Merge--> B@r4
 *
 * Die SA-P-ID von A bleibt ueber den gesamten Rundlauf unveraendert. Ihr
 * UNC-Alias folgt waehrend eines aktiven Redirects zu B und nach Undo wieder
 * zu A. Die inaktive Redirect-Historie verhindert keinen spaeteren Merge.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert";
import test from "node:test";
import { canonicalPersonKey, clusterIdForName } from "../scripts/atlas-id-scheme.mjs";
import { translateSchemaToSqlite } from "../scripts/atlas-schema-translate.mjs";
import { createNodeSqliteAdapter } from "../worker/src/adapters/node-sqlite-adapter.mjs";
import { resolveNarratorRef } from "../worker/src/core/identity.mjs";

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  DatabaseSync = null;
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaText = readFileSync(resolve(projectRoot, "database/schema.sql"), "utf8");

function insertFixture(db) {
  const aKey = canonicalPersonKey("identity-decision:A");
  const bKey = canonicalPersonKey("identity-decision:B");
  const aAlias = clusterIdForName("زيد بن ثابت");
  const bAlias = clusterIdForName("عمرو بن دينار");

  db.exec(`
    INSERT INTO editor (id, auth_subject, display_name, is_machine)
    VALUES ('editor-a', 'human:a', 'Editor A', 0),
           ('editor-b', 'human:b', 'Editor B', 0);
    INSERT INTO source_work (id, slug, title_ar, genre, provider)
    VALUES ('work-1', 'identity-source', 'مصدر الهوية', 'rijal', 'fixture');
    INSERT INTO import_batch
      (id, source_work_id, source_version, importer_version, raw_object_key, raw_sha256)
    VALUES ('batch-1', 'work-1', 'v1', 'fixture', 'fixture.json', 'sha');
    INSERT INTO source_passage
      (id, source_work_id, import_batch_id, source_locator, original_text_sha256)
    VALUES ('passage-1', 'work-1', 'batch-1', '{}', 'sha');
  `);

  const insertNarrator = db.prepare(`
    INSERT INTO narrator
      (id, stable_key, revision, canonical_arabic_name, normalized_name,
       identity_status, origin, review_status, data_version)
    VALUES (?, ?, 1, ?, ?, 'unresolved', 'machine', 'machine_unreviewed', 'v1')
  `);
  insertNarrator.run("narrator-a", aKey, "زيد بن ثابت", "زيد بن ثابت");
  insertNarrator.run("narrator-b", bKey, "عمرو بن دينار", "عمرو بن دينار");

  const insertAlias = db.prepare(`
    INSERT INTO narrator_public_alias
      (id, alias_key, narrator_id, narrator_stable_key, alias_kind, first_seen_data_version)
    VALUES (?, ?, ?, ?, 'occurrence_cluster', 'v1')
  `);
  insertAlias.run("alias-a", aAlias, "narrator-a", aKey);
  insertAlias.run("alias-b", bAlias, "narrator-b", bKey);

  return { aKey, bKey, aAlias, bAlias };
}

function applyMerge(db, { id, targetRevisionBefore, targetRevisionAfter, aKey, bKey }) {
  db.exec("BEGIN");
  try {
    db.prepare(`
      INSERT INTO narrator_merge
        (id, target_narrator_id, target_revision_before, target_revision_after,
         rationale, source_passage_id, proposed_by, approved_by, snapshot_before)
      VALUES (?, 'narrator-b', ?, ?, 'Zwei Identitaeten redaktionell zusammenfuehren',
              'passage-1', 'editor-a', 'editor-b', '{}')
    `).run(id, targetRevisionBefore, targetRevisionAfter);
    db.prepare(`
      INSERT INTO narrator_merge_member
        (id, merge_id, absorbed_narrator_id, absorbed_stable_key, absorbed_revision)
      VALUES (?, ?, 'narrator-a', ?, 1)
    `).run(`member-${id}`, id, aKey);
    db.prepare("UPDATE narrator SET revision = ? WHERE id = 'narrator-b'").run(targetRevisionAfter);
    db.exec("UPDATE narrator SET merged_into_id = 'narrator-b' WHERE id = 'narrator-a'");
    db.prepare(`
      INSERT INTO narrator_id_redirect
        (id, absorbed_stable_key, absorbed_narrator_id, target_narrator_id,
         target_stable_key, merge_id, is_active)
      VALUES (?, ?, 'narrator-a', 'narrator-b', ?, ?, 1)
    `).run(`redirect-${id}`, aKey, bKey, id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function undoMergeWithSplit(db, { aKey, mergeId }) {
  db.exec("BEGIN");
  try {
    db.prepare(`
      INSERT INTO narrator_split
        (id, source_narrator_id, source_revision_before, source_revision_after,
         rationale, source_passage_id, proposed_by, approved_by,
         reverses_merge_id, snapshot_before)
      VALUES ('split-1', 'narrator-b', 2, 3,
              'Merge wird anhand des Vorher-Snapshots zurueckgespielt',
              'passage-1', 'editor-a', 'editor-b', ?, '{}')
    `).run(mergeId);
    db.exec("UPDATE narrator SET revision = 3 WHERE id = 'narrator-b'");
    db.exec("UPDATE narrator SET merged_into_id = NULL WHERE id = 'narrator-a'");
    db.prepare(`
      UPDATE narrator_id_redirect
      SET is_active = 0
      WHERE absorbed_stable_key = ? AND merge_id = ? AND is_active = 1
    `).run(aKey, mergeId);
    db.prepare(`
      UPDATE narrator_merge
      SET reverted_by = 'editor-a',
          reverted_at = '2026-07-30T00:00:00Z',
          revert_rationale = 'Durch split-1 vollstaendig zurueckgespielt'
      WHERE id = ?
    `).run(mergeId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

test("Merge -> Split/Undo -> erneuter Merge behaelt IDs und Aliase aufloesbar", { skip: !DatabaseSync && "node:sqlite nicht verfuegbar" }, async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(translateSchemaToSqlite(schemaText).sql);
    const fixture = insertFixture(db);
    const adapter = createNodeSqliteAdapter(db);

    const initial = await resolveNarratorRef(adapter, fixture.aAlias);
    assert.equal(initial.canonicalId, fixture.aKey);
    assert.equal(initial.revision, 1);
    assert.deepEqual(initial.clusterIds, [fixture.aAlias]);

    applyMerge(db, {
      id: "merge-1",
      targetRevisionBefore: 1,
      targetRevisionAfter: 2,
      ...fixture,
    });
    const mergedByAlias = await resolveNarratorRef(adapter, fixture.aAlias);
    const mergedByStableId = await resolveNarratorRef(adapter, fixture.aKey);
    for (const resolved of [mergedByAlias, mergedByStableId]) {
      assert.equal(resolved.canonicalId, fixture.bKey);
      assert.equal(resolved.revision, 2);
      assert.deepEqual(resolved.redirectPath, [fixture.aKey]);
      assert.deepEqual(resolved.clusterIds.sort(), [fixture.aAlias, fixture.bAlias].sort());
    }

    undoMergeWithSplit(db, { aKey: fixture.aKey, mergeId: "merge-1" });
    const restoredByAlias = await resolveNarratorRef(adapter, fixture.aAlias);
    const restoredByStableId = await resolveNarratorRef(adapter, fixture.aKey);
    for (const resolved of [restoredByAlias, restoredByStableId]) {
      assert.equal(resolved.canonicalId, fixture.aKey, "stabile ID von A muss nach Split/Undo identisch sein");
      assert.equal(resolved.revision, 1);
      assert.deepEqual(resolved.redirectPath, []);
      assert.deepEqual(resolved.clusterIds, [fixture.aAlias]);
    }

    applyMerge(db, {
      id: "merge-2",
      targetRevisionBefore: 3,
      targetRevisionAfter: 4,
      ...fixture,
    });
    const mergedAgain = await resolveNarratorRef(adapter, fixture.aAlias);
    assert.equal(mergedAgain.canonicalId, fixture.bKey);
    assert.equal(mergedAgain.revision, 4);
    assert.equal(db.prepare("SELECT count(*) AS n FROM narrator_id_redirect WHERE absorbed_stable_key = ?").get(fixture.aKey).n, 2);
    assert.equal(db.prepare("SELECT count(*) AS n FROM narrator_id_redirect WHERE absorbed_stable_key = ? AND is_active = 1").get(fixture.aKey).n, 1);
  } finally {
    db.close();
  }
});

test("Alias- und Redirect-Constraints verhindern relative, inkonsistente oder doppelt aktive Zuordnungen", { skip: !DatabaseSync && "node:sqlite nicht verfuegbar" }, () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(translateSchemaToSqlite(schemaText).sql);
    const fixture = insertFixture(db);

    assert.throws(() => {
      db.prepare(`
        INSERT INTO narrator_public_alias
          (id, alias_key, narrator_id, narrator_stable_key, alias_kind, first_seen_data_version)
        VALUES ('bad-relative', 'UNC-REL-123456789abc', 'narrator-a', ?, 'occurrence_cluster', 'v1')
      `).run(fixture.aKey);
    }, /CHECK constraint failed/);

    assert.throws(() => {
      db.prepare(`
        INSERT INTO narrator_public_alias
          (id, alias_key, narrator_id, narrator_stable_key, alias_kind, first_seen_data_version)
        VALUES ('bad-owner', 'UNC-123456789abc', 'narrator-a', ?, 'occurrence_cluster', 'v1')
      `).run(fixture.bKey);
    }, /FOREIGN KEY constraint failed/);

    assert.throws(() => {
      db.prepare(`
        INSERT INTO narrator_public_alias
          (id, alias_key, narrator_id, narrator_stable_key, alias_kind, first_seen_data_version)
        VALUES ('duplicate-active', ?, 'narrator-a', ?, 'occurrence_cluster', 'v1')
      `).run(fixture.aAlias, fixture.aKey);
    }, /UNIQUE constraint failed/);
  } finally {
    db.close();
  }
});
