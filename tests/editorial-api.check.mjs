import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { translateSchemaToSqlite } from "../scripts/atlas-schema-translate.mjs";
import { createNodeSqliteAdapter } from "../worker/src/adapters/node-sqlite-adapter.mjs";
import { route } from "../worker/src/core/router.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schema = readFileSync(resolve(projectRoot, "database/schema.sql"), "utf8");
const EDITOR_TOKEN = "editor-token-with-at-least-thirty-two-random-characters-A";
const SENIOR_TOKEN = "senior-token-with-at-least-thirty-two-random-characters-B";

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(translateSchemaToSqlite(schema).sql);
  db.exec(`
    INSERT INTO editor (id, auth_subject, display_name, is_machine, is_active)
    VALUES ('editor-a', 'test:editor-a', 'Editor A', 0, 1),
           ('editor-b', 'test:editor-b', 'Editor B', 0, 1);
    INSERT INTO editor_role (id, editor_id, role_id)
    VALUES ('er-a', 'editor-a', '11111111-1111-1111-1111-111111111103'),
           ('er-b', 'editor-b', '11111111-1111-1111-1111-111111111104');
    INSERT INTO source_work (id, slug, title_ar, genre, provider, rights_status)
    VALUES ('sw-1', 'test-work', 'كتاب الاختبار', 'rijal', 'test', 'cleared');
    INSERT INTO import_batch
      (id, source_work_id, source_version, importer_version, raw_object_key, raw_sha256)
    VALUES ('ib-1', 'sw-1', 'v1', 'test', 'test.json', 'sha');
    INSERT INTO source_passage
      (id, source_work_id, import_batch_id, source_locator, original_text_sha256, stable_reference)
    VALUES ('sp-1', 'sw-1', 'ib-1', '{"entry":"1"}', 'sha', 'test:1');
    INSERT INTO rijal_entry
      (id, source_work_id, source_passage_id, import_batch_id, external_entry_id,
       entry_number, name_head_raw, name_head_normalized, entry_text_sha256,
       parser_version, data_version)
    VALUES ('rijal-1', 'sw-1', 'sp-1', 'ib-1', 'entry-1', '1', 'زيد', 'زيد',
            'sha-entry', 'test', 'v-test');
    INSERT INTO parse_review_item
      (id, import_batch_id, queue_kind, external_record_id, raw_payload,
       error_code, error_detail, data_version)
    VALUES ('review-1', 'ib-1', 'relationship_assertion', 'rijal-1#teacher#0',
            '{"entryId":"rijal-1","raw":"زيد"}',
            'ambiguous-name', 'needs a human decision', 'v-test');
  `);
  db.prepare(`INSERT INTO editor_api_credential (id, editor_id, token_sha256, label)
              VALUES (?, ?, ?, ?), (?, ?, ?, ?)`)
    .run("cred-a", "editor-a", await sha256(EDITOR_TOKEN), "test editor", "cred-b", "editor-b", await sha256(SENIOR_TOKEN), "test senior");
  return { raw: db, db: createNodeSqliteAdapter(db) };
}

function request(path, token, init = {}) {
  return new Request(`https://api.example.test/api/v1/editorial${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
  });
}

async function call(db, path, token, init) {
  const response = await route(request(path, token, init), { db, gate: {}, registry: {}, dataVersion: "v-test" });
  return { response, body: await response.json() };
}

test("P5.8 authentifiziert, persistiert, prueft vier Augen und reversiert append-only", async () => {
  const { raw, db } = await fixture();
  try {
    const unauthenticated = await route(new Request("https://api.example.test/api/v1/editorial/session"), { db, gate: {}, registry: {}, dataVersion: "v-test" });
    assert.equal(unauthenticated.status, 401);

    const session = await call(db, "/session", EDITOR_TOKEN);
    assert.equal(session.response.status, 200, JSON.stringify(session.body));
    assert.equal(session.body.id, "editor-a");
    assert.equal(session.body.permissions.mayApproveMerge, false);
    assert.equal(session.response.headers.get("cache-control"), "no-store");

    const queue = await call(db, "/review-queue", EDITOR_TOKEN);
    assert.equal(queue.response.status, 200, JSON.stringify(queue.body));
    assert.equal(queue.body.items.length, 1);
    assert.equal(queue.body.items[0].source.id, "sp-1");

    const accept = await call(db, "/proposals", EDITOR_TOKEN, {
      method: "POST",
      body: JSON.stringify({
        entityType: "parse_review_item",
        entityId: "review-1",
        action: "accept",
        rationale: "Ausreichend begruendete Annahme",
        sourcePassageId: "sp-1",
        // Ein gefaelschtes beforeValue wird bewusst ignoriert; der Server liest
        // den Vorher-Zustand selbst aus der Datenbank.
        beforeValue: { forged: true },
        afterValue: { decision: "accept", normalized: "زيد" },
      }),
    });
    assert.equal(accept.response.status, 201);
    assert.equal(accept.body.before.forged, undefined);

    const finalized = await call(db, `/proposals/${accept.body.id}/finalize`, EDITOR_TOKEN, { method: "POST" });
    assert.equal(finalized.response.status, 201);
    assert.equal(raw.prepare("SELECT count(*) AS n FROM editorial_revision").get().n, 1);
    const secondFinalize = await call(db, `/proposals/${accept.body.id}/finalize`, EDITOR_TOKEN, { method: "POST" });
    assert.equal(secondFinalize.response.status, 409, "eine gespeicherte Revision darf nicht ueberschrieben werden");

    const merge = await call(db, "/proposals", EDITOR_TOKEN, {
      method: "POST",
      body: JSON.stringify({
        entityType: "rijal_entry",
        entityId: "rijal-1",
        action: "merge",
        rationale: "Zwei Belege fuer dieselbe Person",
        sourcePassageId: "sp-1",
        afterValue: { decision: "merge", target: "SA-P-ABCDEFGH" },
      }),
    });
    assert.equal(merge.response.status, 201);
    assert.equal(merge.body.requiresFourEyes, true);

    const selfApproval = await call(db, `/proposals/${merge.body.id}/finalize`, EDITOR_TOKEN, { method: "POST" });
    assert.equal(selfApproval.response.status, 403);

    const secondApproval = await call(db, `/proposals/${merge.body.id}/finalize`, SENIOR_TOKEN, { method: "POST" });
    assert.equal(secondApproval.response.status, 201);
    const mergeRow = raw.prepare("SELECT editor_id, approved_by FROM editorial_revision WHERE id = ?").get(secondApproval.body.id);
    assert.equal(mergeRow.editor_id, "editor-a");
    assert.equal(mergeRow.approved_by, "editor-b");

    const reverted = await call(db, `/revisions/${finalized.body.id}/revert`, EDITOR_TOKEN, {
      method: "POST",
      body: JSON.stringify({ rationale: "Ruecknahme wegen neuer Quellenlage", sourcePassageId: "sp-1" }),
    });
    assert.equal(reverted.response.status, 201);
    const undo = raw.prepare("SELECT before_value, after_value, reverts_revision_id FROM editorial_revision WHERE id = ?").get(reverted.body.id);
    const original = raw.prepare("SELECT before_value, after_value FROM editorial_revision WHERE id = ?").get(finalized.body.id);
    assert.equal(undo.before_value, original.after_value);
    assert.equal(undo.after_value, original.before_value);
    assert.equal(undo.reverts_revision_id, finalized.body.id);

    const duplicateUndo = await call(db, `/revisions/${finalized.body.id}/revert`, EDITOR_TOKEN, {
      method: "POST",
      body: JSON.stringify({ rationale: "Doppelte Ruecknahme ist verboten", sourcePassageId: "sp-1" }),
    });
    assert.equal(duplicateUndo.response.status, 409);
  } finally {
    raw.close();
  }
});
