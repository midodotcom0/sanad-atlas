const ENTITY_TYPES = new Set([
  "identity_candidate",
  "narrator",
  "rijal_entry",
  "date_assertion",
  "relationship_assertion",
  "hadith_cluster",
  "matn_variant",
  "parse_review_item",
]);
const ACTIONS = new Set(["accept", "reject", "merge", "verify"]);
const SENSITIVE_ACTIONS = new Set(["merge", "verify"]);

export class EditorialError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "EditorialError";
    this.status = status;
  }
}

function requiredText(value, label, minimum = 1, maximum = 2_000) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < minimum || text.length > maximum) {
    throw new EditorialError(422, `${label}: ${minimum}..${maximum} Zeichen erforderlich`);
  }
  return text;
}

function parseStoredJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function publicEditor(row, roles) {
  return {
    id: row.id,
    displayName: row.display_name,
    displayNameAr: row.display_name_ar ?? null,
    roles: roles.map((role) => role.role_key),
    permissions: {
      mayReview: roles.some((role) => Boolean(role.may_review)),
      mayApproveMerge: roles.some((role) => Boolean(role.may_approve_merge)),
      mayVerify: roles.some((role) => Boolean(role.may_verify)),
    },
  };
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function authenticateEditor(db, request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match || match[1].length < 32 || match[1].length > 512) {
    throw new EditorialError(401, "gueltiger Redaktions-Token erforderlich");
  }
  const tokenHash = await sha256Hex(match[1]);
  const editor = await db.get(
    `SELECT e.id, e.display_name, e.display_name_ar, e.is_machine, e.is_active,
            c.expires_at, c.revoked_at
       FROM editor_api_credential c
       JOIN editor e ON e.id = c.editor_id
      WHERE c.token_sha256 = ?`,
    tokenHash,
  );
  const now = Date.now();
  const expired = editor?.expires_at && Date.parse(editor.expires_at) <= now;
  if (!editor || !editor.is_active || editor.is_machine || editor.revoked_at || expired) {
    throw new EditorialError(401, "Redaktions-Token ungueltig, abgelaufen oder gesperrt");
  }
  const roles = await db.all(
    `SELECT r.role_key, r.may_review, r.may_approve_merge, r.may_verify
       FROM editor_role er
       JOIN role r ON r.id = er.role_id
      WHERE er.editor_id = ? AND er.revoked_at IS NULL`,
    editor.id,
  );
  const session = publicEditor(editor, roles);
  if (!session.permissions.mayReview) throw new EditorialError(403, "Rolle may_review erforderlich");
  return session;
}

function sourceReference(row) {
  return {
    id: row.source_passage_id,
    work: row.title_ar ?? null,
    stableReference: row.stable_reference ?? null,
    locator: parseStoredJson(row.source_locator),
  };
}

async function getSource(db, sourcePassageId) {
  return db.get(
    `SELECT sp.id AS source_passage_id, sp.stable_reference, sp.source_locator, sw.title_ar
       FROM source_passage sp
       JOIN source_work sw ON sw.id = sp.source_work_id
      WHERE sp.id = ?`,
    sourcePassageId,
  );
}

const DIRECT_SOURCE_TABLES = new Set(["rijal_entry", "date_assertion", "relationship_assertion"]);

async function sourceBelongsToEntity(db, entityType, entityId, sourcePassageId) {
  if (DIRECT_SOURCE_TABLES.has(entityType)) {
    return Boolean(await db.get(`SELECT id FROM ${entityType} WHERE id = ? AND source_passage_id = ?`, entityId, sourcePassageId));
  }
  if (entityType === "identity_candidate") {
    return Boolean(await db.get(
      `SELECT ic.id
         FROM identity_candidate ic
         JOIN narrator_occurrence no ON no.id = ic.occurrence_id
         JOIN isnad_chain ch ON ch.id = no.chain_id
         JOIN hadith_record hr ON hr.id = ch.hadith_record_id
        WHERE ic.id = ? AND hr.source_passage_id = ?`,
      entityId,
      sourcePassageId,
    ));
  }
  if (entityType === "parse_review_item") {
    return Boolean(await db.get(
      `SELECT pri.id
         FROM parse_review_item pri
         JOIN import_batch ib ON ib.id = pri.import_batch_id
         LEFT JOIN hadith_record hr
           ON hr.source_work_id = ib.source_work_id AND hr.external_record_id = pri.external_record_id
         LEFT JOIN rijal_entry re_payload
           ON re_payload.id = json_extract(pri.raw_payload, '$.entryId')
         LEFT JOIN rijal_entry re_external
           ON re_external.source_work_id = ib.source_work_id AND re_external.external_entry_id = pri.external_record_id
        WHERE pri.id = ?
          AND COALESCE(hr.source_passage_id, re_payload.source_passage_id, re_external.source_passage_id) = ?`,
      entityId,
      sourcePassageId,
    ));
  }
  return Boolean(await db.get(
    `SELECT id FROM evidence_link
      WHERE entity_type = ? AND entity_id = ? AND source_passage_id = ?
      LIMIT 1`,
    entityType,
    entityId,
    sourcePassageId,
  ));
}

const SNAPSHOT_SQL = {
  identity_candidate: `SELECT id, occurrence_id, candidate_narrator_id, candidate_rijal_entry_id,
      match_kind, confidence_score, confidence_level, matching_signals,
      conflicting_signals, review_status FROM identity_candidate WHERE id = ?`,
  narrator: `SELECT id, stable_key, revision, canonical_arabic_name, normalized_name,
      identity_status, merged_into_id, review_status FROM narrator WHERE id = ?`,
  rijal_entry: `SELECT id, external_entry_id, entry_number, name_head_raw, name_head_normalized,
      resolved_narrator_id, identity_status, review_status FROM rijal_entry WHERE id = ?`,
  date_assertion: `SELECT id, narrator_id, event_type, date_precision, year_min_ah, year_max_ah,
      original_phrase, confidence_level, review_status FROM date_assertion WHERE id = ?`,
  relationship_assertion: `SELECT id, subject_narrator_id, object_narrator_id, relationship_type,
      evidence_kind, chronology, confidence_level, review_status FROM relationship_assertion WHERE id = ?`,
  hadith_cluster: `SELECT id, stable_key, status, method, confidence_level, review_status FROM hadith_cluster WHERE id = ?`,
  matn_variant: `SELECT id, cluster_id, variant_kind, confidence_level, review_status FROM matn_variant WHERE id = ?`,
  parse_review_item: `SELECT id, queue_kind, external_record_id, error_code, error_detail,
      raw_payload, review_status, resolution_note FROM parse_review_item WHERE id = ?`,
};

async function entitySnapshot(db, entityType, entityId) {
  const row = await db.get(SNAPSHOT_SQL[entityType], entityId);
  if (!row) throw new EditorialError(404, "Redaktionsobjekt nicht gefunden");
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, parseStoredJson(value)]));
}

async function activeRevision(db, entityType, entityId) {
  return db.get(
    `SELECT er.*
       FROM editorial_revision er
      WHERE er.entity_type = ? AND er.entity_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM editorial_revision undo WHERE undo.reverts_revision_id = er.id
        )
      ORDER BY er.revision_index DESC, er.created_at DESC
      LIMIT 1`,
    entityType,
    entityId,
  );
}

export async function getSession(db, request) {
  return authenticateEditor(db, request);
}

export async function listReviewQueue(db, editor, { limit }) {
  if (!editor.permissions.mayReview) throw new EditorialError(403, "Rolle may_review erforderlich");
  const perKind = Math.max(1, limit);
  const [identityRows, parseRows] = await Promise.all([
    db.all(
      `SELECT ic.id, NULL AS created_at, no.raw_surface_form, no.normalized_surface_form,
              ic.match_kind, ic.confidence_score, ic.confidence_level,
              COALESCE(n.canonical_arabic_name, re.name_head_raw) AS proposed_value,
              hr.source_passage_id, sp.stable_reference, sp.source_locator, sw.title_ar
         FROM identity_candidate ic
         JOIN narrator_occurrence no ON no.id = ic.occurrence_id
         JOIN isnad_chain ch ON ch.id = no.chain_id
         JOIN hadith_record hr ON hr.id = ch.hadith_record_id
         JOIN source_passage sp ON sp.id = hr.source_passage_id
         JOIN source_work sw ON sw.id = sp.source_work_id
         LEFT JOIN narrator n ON n.id = ic.candidate_narrator_id
         LEFT JOIN rijal_entry re ON re.id = ic.candidate_rijal_entry_id
        WHERE ic.review_status IN ('machine_unreviewed', 'in_review')
          AND NOT EXISTS (SELECT 1 FROM editorial_proposal ep
                           WHERE ep.entity_type = 'identity_candidate' AND ep.entity_id = ic.id
                             AND NOT EXISTS (SELECT 1 FROM editorial_revision er WHERE er.proposal_id = ep.id))
          AND NOT EXISTS (SELECT 1 FROM editorial_revision er
                           WHERE er.entity_type = 'identity_candidate' AND er.entity_id = ic.id
                             AND NOT EXISTS (SELECT 1 FROM editorial_revision undo WHERE undo.reverts_revision_id = er.id))
        ORDER BY ic.confidence_score DESC, ic.id
        LIMIT ?`,
      perKind,
    ),
    db.all(
      `SELECT pri.id, pri.created_at, pri.queue_kind, pri.external_record_id,
              pri.error_code, pri.error_detail, pri.raw_payload,
              COALESCE(hr.source_passage_id, re_payload.source_passage_id, re_external.source_passage_id) AS source_passage_id,
              sp.stable_reference, sp.source_locator, sw.title_ar
         FROM parse_review_item pri
         JOIN import_batch ib ON ib.id = pri.import_batch_id
         JOIN source_work sw ON sw.id = ib.source_work_id
         LEFT JOIN hadith_record hr
           ON hr.source_work_id = ib.source_work_id AND hr.external_record_id = pri.external_record_id
         LEFT JOIN rijal_entry re_payload
           ON re_payload.id = json_extract(pri.raw_payload, '$.entryId')
         LEFT JOIN rijal_entry re_external
           ON re_external.source_work_id = ib.source_work_id AND re_external.external_entry_id = pri.external_record_id
         JOIN source_passage sp
           ON sp.id = COALESCE(hr.source_passage_id, re_payload.source_passage_id, re_external.source_passage_id)
        WHERE pri.review_status IN ('machine_unreviewed', 'in_review')
          AND NOT EXISTS (SELECT 1 FROM editorial_proposal ep
                           WHERE ep.entity_type = 'parse_review_item' AND ep.entity_id = pri.id
                             AND NOT EXISTS (SELECT 1 FROM editorial_revision er WHERE er.proposal_id = ep.id))
          AND NOT EXISTS (SELECT 1 FROM editorial_revision er
                           WHERE er.entity_type = 'parse_review_item' AND er.entity_id = pri.id
                             AND NOT EXISTS (SELECT 1 FROM editorial_revision undo WHERE undo.reverts_revision_id = er.id))
        ORDER BY pri.created_at, pri.id
        LIMIT ?`,
      perKind,
    ),
  ]);
  const identity = identityRows.map((row) => ({
    id: row.id,
    entityType: "identity_candidate",
    kind: "هوية",
    title: row.raw_surface_form,
    context: `${row.match_kind} · ${Number(row.confidence_score).toFixed(3)} · ${row.confidence_level}`,
    before: { normalizedSurface: row.normalized_surface_form, status: "unresolved" },
    proposal: { narrator: row.proposed_value, confidence: Number(row.confidence_score) },
    source: sourceReference(row),
    allowedActions: ["accept", "reject", "merge", "verify"],
    createdAt: row.created_at,
  }));
  const parse = parseRows.map((row) => ({
    id: row.id,
    entityType: "parse_review_item",
    kind: "استخراج",
    title: `${row.queue_kind} · ${row.external_record_id}`,
    context: `${row.error_code}: ${row.error_detail}`,
    before: parseStoredJson(row.raw_payload),
    proposal: { resolution: "editorial_review" },
    source: sourceReference(row),
    allowedActions: ["accept", "reject"],
    createdAt: row.created_at,
  }));
  const items = [...identity, ...parse]
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .slice(0, limit);
  return { items, count: items.length };
}

export async function listPendingProposals(db, editor, { limit }) {
  const rows = await db.all(
    `SELECT ep.*, e.display_name AS proposed_by_name,
            sp.stable_reference, sp.source_locator, sw.title_ar
       FROM editorial_proposal ep
       JOIN editor e ON e.id = ep.proposed_by
       JOIN source_passage sp ON sp.id = ep.source_passage_id
       JOIN source_work sw ON sw.id = sp.source_work_id
       LEFT JOIN editorial_revision er ON er.proposal_id = ep.id
      WHERE er.id IS NULL
      ORDER BY ep.created_at, ep.id
      LIMIT ?`,
    limit,
  );
  return {
    items: rows.map((row) => ({
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      action: row.action,
      rationale: row.rationale,
      before: parseStoredJson(row.before_value),
      after: parseStoredJson(row.after_value),
      proposedBy: { id: row.proposed_by, displayName: row.proposed_by_name },
      requiresFourEyes: SENSITIVE_ACTIONS.has(row.action),
      canFinalize: !SENSITIVE_ACTIONS.has(row.action)
        || (row.proposed_by !== editor.id && (row.action === "merge" ? editor.permissions.mayApproveMerge : editor.permissions.mayVerify)),
      source: sourceReference(row),
      createdAt: row.created_at,
    })),
  };
}

export async function listRevisions(db, _editor, { limit }) {
  const rows = await db.all(
    `SELECT er.*, e.display_name AS editor_name, a.display_name AS approved_by_name,
            sp.stable_reference, sp.source_locator, sw.title_ar,
            EXISTS (SELECT 1 FROM editorial_revision undo WHERE undo.reverts_revision_id = er.id) AS is_reverted
       FROM editorial_revision er
       JOIN editor e ON e.id = er.editor_id
       LEFT JOIN editor a ON a.id = er.approved_by
       JOIN source_passage sp ON sp.id = er.source_passage_id
       JOIN source_work sw ON sw.id = sp.source_work_id
      ORDER BY er.created_at DESC, er.id DESC
      LIMIT ?`,
    limit,
  );
  return {
    items: rows.map((row) => ({
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      action: row.action,
      rationale: row.rationale,
      before: parseStoredJson(row.before_value),
      after: parseStoredJson(row.after_value),
      editor: { id: row.editor_id, displayName: row.editor_name },
      approvedBy: row.approved_by ? { id: row.approved_by, displayName: row.approved_by_name } : null,
      source: sourceReference(row),
      revisionIndex: Number(row.revision_index),
      isReverted: Boolean(row.is_reverted),
      revertsRevisionId: row.reverts_revision_id ?? null,
      createdAt: row.created_at,
    })),
  };
}

export async function createProposal(db, editor, dataVersion, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new EditorialError(422, "JSON-Objekt erforderlich");
  const entityType = requiredText(input.entityType, "entityType", 1, 80);
  const entityId = requiredText(input.entityId, "entityId", 1, 128);
  const action = requiredText(input.action, "action", 1, 20);
  const rationale = requiredText(input.rationale, "rationale", 12, 2_000);
  const sourcePassageId = requiredText(input.sourcePassageId, "sourcePassageId", 1, 128);
  if (!ENTITY_TYPES.has(entityType)) throw new EditorialError(422, "entityType nicht redaktionell freigegeben");
  if (!ACTIONS.has(action)) throw new EditorialError(422, "action muss accept, reject, merge oder verify sein");
  if (!input.afterValue || typeof input.afterValue !== "object" || Array.isArray(input.afterValue)) {
    throw new EditorialError(422, "afterValue muss ein JSON-Objekt sein");
  }
  const afterJson = canonicalJson(input.afterValue);
  if (afterJson.length > 16_384) throw new EditorialError(413, "afterValue ist groesser als 16 KiB");
  const [snapshot, source, belongs, current] = await Promise.all([
    entitySnapshot(db, entityType, entityId),
    getSource(db, sourcePassageId),
    sourceBelongsToEntity(db, entityType, entityId, sourcePassageId),
    activeRevision(db, entityType, entityId),
  ]);
  if (!source) throw new EditorialError(422, "Quellenpassage nicht gefunden");
  if (!belongs) throw new EditorialError(422, "Quellenpassage belegt dieses Redaktionsobjekt nicht");
  const before = current ? parseStoredJson(current.after_value) : snapshot;
  const beforeJson = canonicalJson(before);
  if (beforeJson === afterJson) throw new EditorialError(422, "Vorher und Nachher muessen sich unterscheiden");
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  try {
    const row = await db.get(
      `INSERT INTO editorial_proposal
         (id, entity_type, entity_id, entity_stable_key, action, rationale,
          source_passage_id, proposed_by, before_value, after_value,
          baseline_revision_id, data_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id, entity_type, entity_id, action, created_at`,
      id,
      entityType,
      entityId,
      typeof input.entityStableKey === "string" ? input.entityStableKey.trim() || null : null,
      action,
      rationale,
      sourcePassageId,
      editor.id,
      beforeJson,
      afterJson,
      current?.id ?? null,
      dataVersion,
      createdAt,
    );
    return { ...row, status: "pending", requiresFourEyes: SENSITIVE_ACTIONS.has(action), before, after: input.afterValue, source: sourceReference(source) };
  } catch (error) {
    throw new EditorialError(409, `Vorschlag konnte nicht gespeichert werden: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function finalizeProposal(db, editor, proposalId) {
  const proposal = await db.get("SELECT * FROM editorial_proposal WHERE id = ?", proposalId);
  if (!proposal) throw new EditorialError(404, "Vorschlag nicht gefunden");
  if (await db.get("SELECT id FROM editorial_revision WHERE proposal_id = ?", proposalId)) {
    throw new EditorialError(409, "Vorschlag wurde bereits finalisiert");
  }
  if (proposal.action === "merge") {
    if (!editor.permissions.mayApproveMerge) throw new EditorialError(403, "Rolle may_approve_merge erforderlich");
    if (proposal.proposed_by === editor.id) throw new EditorialError(403, "Merge erfordert einen zweiten Editor");
  } else if (proposal.action === "verify") {
    if (!editor.permissions.mayVerify) throw new EditorialError(403, "Rolle may_verify erforderlich");
    if (proposal.proposed_by === editor.id) throw new EditorialError(403, "Verify erfordert einen zweiten Editor");
  }
  const current = await activeRevision(db, proposal.entity_type, proposal.entity_id);
  if ((current?.id ?? null) !== (proposal.baseline_revision_id ?? null)) {
    throw new EditorialError(409, "Vorschlag ist veraltet; der Redaktionsstand hat sich seitdem geaendert");
  }
  const maxRow = await db.get(
    "SELECT COALESCE(MAX(revision_index), 0) AS max_index FROM editorial_revision WHERE entity_type = ? AND entity_id = ?",
    proposal.entity_type,
    proposal.entity_id,
  );
  const revisionId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const sensitive = SENSITIVE_ACTIONS.has(proposal.action);
  try {
    const row = await db.get(
      `INSERT INTO editorial_revision
         (id, entity_type, entity_id, entity_stable_key, action, rationale,
          source_passage_id, editor_id, approved_by, approved_at, before_value,
          after_value, proposal_id, supersedes_id, revision_index, data_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id, action, revision_index, created_at`,
      revisionId,
      proposal.entity_type,
      proposal.entity_id,
      proposal.entity_stable_key,
      proposal.action,
      proposal.rationale,
      proposal.source_passage_id,
      proposal.proposed_by,
      sensitive ? editor.id : null,
      sensitive ? createdAt : null,
      proposal.before_value,
      proposal.after_value,
      proposal.id,
      proposal.baseline_revision_id,
      Number(maxRow?.max_index ?? 0) + 1,
      proposal.data_version,
      createdAt,
    );
    return { ...row, status: "finalized", approvedBy: sensitive ? editor : null };
  } catch (error) {
    throw new EditorialError(409, `Finalisierung fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function revertRevision(db, editor, dataVersion, revisionId, input) {
  const rationale = requiredText(input?.rationale, "rationale", 12, 2_000);
  const sourcePassageId = requiredText(input?.sourcePassageId, "sourcePassageId", 1, 128);
  const revision = await db.get("SELECT * FROM editorial_revision WHERE id = ?", revisionId);
  if (!revision) throw new EditorialError(404, "Revision nicht gefunden");
  if (await db.get("SELECT id FROM editorial_revision WHERE reverts_revision_id = ?", revisionId)) {
    throw new EditorialError(409, "Revision wurde bereits zurueckgenommen");
  }
  const source = await getSource(db, sourcePassageId);
  if (!source) throw new EditorialError(422, "Quellenpassage nicht gefunden");
  const maxRow = await db.get(
    "SELECT COALESCE(MAX(revision_index), 0) AS max_index FROM editorial_revision WHERE entity_type = ? AND entity_id = ?",
    revision.entity_type,
    revision.entity_id,
  );
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  try {
    const row = await db.get(
      `INSERT INTO editorial_revision
         (id, entity_type, entity_id, entity_stable_key, action, rationale,
          source_passage_id, editor_id, before_value, after_value, supersedes_id,
          reverts_revision_id, revision_index, data_version, created_at)
       VALUES (?, ?, ?, ?, 'revert', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id, action, revision_index, created_at`,
      id,
      revision.entity_type,
      revision.entity_id,
      revision.entity_stable_key,
      rationale,
      sourcePassageId,
      editor.id,
      revision.after_value,
      revision.before_value,
      revision.id,
      revision.id,
      Number(maxRow?.max_index ?? 0) + 1,
      dataVersion,
      createdAt,
    );
    return { ...row, status: "reverted", revertsRevisionId: revision.id, source: sourceReference(source) };
  } catch (error) {
    throw new EditorialError(409, `Ruecknahme fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
  }
}
