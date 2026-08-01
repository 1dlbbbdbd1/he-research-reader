const { DatabaseSync } = require('node:sqlite')

const SCHEMA_VERSION = 7

const migrationOne = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS bibliographic_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  item_type TEXT NOT NULL,
  title TEXT NOT NULL,
  authors_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(authors_json)),
  issued TEXT,
  container_title TEXT,
  volume TEXT,
  issue TEXT,
  pages TEXT,
  abstract TEXT,
  language TEXT,
  keywords_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(keywords_json)),
  identifiers_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(identifiers_json)),
  needs_metadata_review INTEGER NOT NULL DEFAULT 0 CHECK (needs_metadata_review IN (0, 1)),
  import_format TEXT NOT NULL CHECK (import_format IN ('endnote-xml', 'ris', 'bibtex', 'legacy', 'manual')),
  import_batch_id TEXT NOT NULL,
  source_file_name TEXT,
  source_file_sha256 TEXT,
  record_ordinal INTEGER NOT NULL,
  raw_record_id TEXT,
  raw_record_id_field TEXT,
  raw_payload TEXT NOT NULL,
  raw_fields_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(raw_fields_json)),
  parser_name TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  bibliographic_item_id TEXT REFERENCES bibliographic_items(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  pages INTEGER,
  path_relative TEXT,
  content_sha256 TEXT,
  extracted_text TEXT,
  derived_markdown TEXT,
  source_metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(source_metadata_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS bibliographic_attachments (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES bibliographic_items(id),
  source_id TEXT REFERENCES sources(id),
  role TEXT NOT NULL CHECK (role IN ('primary', 'supplement', 'snapshot', 'other')),
  path_original TEXT NOT NULL,
  path_resolved TEXT,
  exists_state TEXT NOT NULL CHECK (exists_state IN ('unknown', 'found', 'missing', 'denied')),
  content_sha256 TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  source_id TEXT REFERENCES sources(id),
  category TEXT NOT NULL,
  anchor_json TEXT NOT NULL CHECK (json_valid(anchor_json)),
  created_at TEXT NOT NULL,
  archived_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS note_fragments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  bibliographic_item_id TEXT REFERENCES bibliographic_items(id),
  source_id TEXT REFERENCES sources(id),
  annotation_id TEXT REFERENCES annotations(id),
  origin TEXT NOT NULL CHECK (origin IN ('source_evidence', 'user', 'ai')),
  kind TEXT NOT NULL CHECK (kind IN ('quote', 'note', 'translation', 'question', 'answer', 'summary', 'figure_caption')),
  content TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  language TEXT,
  purpose_tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(purpose_tags_json)),
  anchor_json TEXT NOT NULL CHECK (json_valid(anchor_json)),
  ai_provenance_json TEXT CHECK (ai_provenance_json IS NULL OR json_valid(ai_provenance_json)),
  supersedes_id TEXT REFERENCES note_fragments(id),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL CHECK (created_by IN ('user', 'ai', 'system')),
  CHECK (origin != 'source_evidence' OR source_id IS NOT NULL),
  CHECK (origin != 'ai' OR ai_provenance_json IS NOT NULL)
) STRICT;

CREATE TABLE IF NOT EXISTS fragment_relations (
  id TEXT PRIMARY KEY,
  from_fragment_id TEXT NOT NULL REFERENCES note_fragments(id),
  to_fragment_id TEXT NOT NULL REFERENCES note_fragments(id),
  relation TEXT NOT NULL CHECK (relation IN ('derived_from', 'comments_on', 'supports', 'refutes', 'mentions')),
  created_at TEXT NOT NULL,
  UNIQUE (from_fragment_id, to_fragment_id, relation)
) STRICT;

CREATE TABLE IF NOT EXISTS review_documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  template_id TEXT,
  template_version TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'reviewed', 'exported')),
  generation_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS review_document_items (
  document_id TEXT NOT NULL REFERENCES review_documents(id),
  item_id TEXT NOT NULL REFERENCES bibliographic_items(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (document_id, item_id)
) WITHOUT ROWID, STRICT;

CREATE TABLE IF NOT EXISTS review_document_fragments (
  document_id TEXT NOT NULL REFERENCES review_documents(id),
  fragment_id TEXT NOT NULL REFERENCES note_fragments(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (document_id, fragment_id)
) WITHOUT ROWID, STRICT;

CREATE TABLE IF NOT EXISTS review_blocks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES review_documents(id),
  position INTEGER NOT NULL,
  block_type TEXT NOT NULL CHECK (block_type IN ('heading', 'source_evidence', 'user_note', 'ai_organization')),
  content TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  source_fragment_id TEXT REFERENCES note_fragments(id),
  unsupported INTEGER NOT NULL DEFAULT 0 CHECK (unsupported IN (0, 1)),
  UNIQUE (document_id, position)
) STRICT;

CREATE TABLE IF NOT EXISTS review_citations (
  id TEXT PRIMARY KEY,
  block_id TEXT NOT NULL REFERENCES review_blocks(id),
  item_id TEXT NOT NULL REFERENCES bibliographic_items(id),
  source_id TEXT NOT NULL REFERENCES sources(id),
  fragment_id TEXT REFERENCES note_fragments(id),
  page_number INTEGER,
  anchor_json TEXT CHECK (anchor_json IS NULL OR json_valid(anchor_json)),
  quoted_text_sha256 TEXT,
  label TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS export_records (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES review_documents(id),
  format TEXT NOT NULL CHECK (format IN ('markdown', 'docx')),
  revision_hash TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  exported_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS migration_runs (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'rolled_back')),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS migration_map (
  run_id TEXT NOT NULL REFERENCES migration_runs(id),
  legacy_kind TEXT NOT NULL,
  legacy_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  content_sha256 TEXT,
  PRIMARY KEY (run_id, legacy_kind, legacy_id, target_kind)
) WITHOUT ROWID, STRICT;

CREATE INDEX IF NOT EXISTS idx_items_project ON bibliographic_items(project_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_sources_project ON sources(project_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_fragments_item ON note_fragments(bibliographic_item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_fragments_source ON note_fragments(source_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_project ON review_documents(project_id, updated_at);

CREATE TRIGGER IF NOT EXISTS note_fragments_origin_is_immutable
BEFORE UPDATE OF origin ON note_fragments
WHEN NEW.origin != OLD.origin
BEGIN
  SELECT RAISE(ABORT, 'note fragment origin is immutable');
END;

CREATE TRIGGER IF NOT EXISTS protected_note_fragments_are_append_only
BEFORE UPDATE ON note_fragments
WHEN OLD.origin IN ('source_evidence', 'user')
BEGIN
  SELECT RAISE(ABORT, 'source evidence and user notes are append-only; create a revision');
END;

CREATE TRIGGER IF NOT EXISTS protected_note_fragments_cannot_be_deleted
BEFORE DELETE ON note_fragments
WHEN OLD.origin IN ('source_evidence', 'user')
BEGIN
  SELECT RAISE(ABORT, 'source evidence and user notes cannot be deleted; archive their parent');
END;

CREATE TRIGGER IF NOT EXISTS protected_review_blocks_are_append_only
BEFORE UPDATE ON review_blocks
WHEN OLD.block_type IN ('source_evidence', 'user_note')
BEGIN
  SELECT RAISE(ABORT, 'evidence and user-note review blocks are append-only');
END;

CREATE TRIGGER IF NOT EXISTS protected_review_blocks_cannot_be_deleted
BEFORE DELETE ON review_blocks
WHEN OLD.block_type IN ('source_evidence', 'user_note')
BEGIN
  SELECT RAISE(ABORT, 'evidence and user-note review blocks cannot be deleted');
END;
`

const migrationTwo = `
CREATE TABLE IF NOT EXISTS bibliographic_reading_states (
  item_id TEXT PRIMARY KEY REFERENCES bibliographic_items(id),
  reading_status TEXT NOT NULL DEFAULT 'unread'
    CHECK (reading_status IN ('unread', 'title_only', 'skimming', 'reading', 'finished')),
  relevance TEXT NOT NULL DEFAULT 'undecided'
    CHECK (relevance IN ('undecided', 'core', 'relevant', 'supplemental', 'mismatched')),
  idea_state TEXT NOT NULL DEFAULT 'undecided'
    CHECK (idea_state IN ('undecided', 'has_ideas', 'no_new_ideas')),
  question_state TEXT NOT NULL DEFAULT 'undecided'
    CHECK (question_state IN ('undecided', 'has_questions', 'no_questions')),
  purpose_tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(purpose_tags_json)),
  decision_note TEXT,
  last_page INTEGER,
  total_pages INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS reading_state_events (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES bibliographic_items(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN ('reading_status', 'relevance', 'idea_state', 'question_state', 'purpose_tags', 'decision_note', 'position')),
  from_value TEXT,
  to_value TEXT,
  note TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_reading_state_status
  ON bibliographic_reading_states(reading_status, relevance, idea_state, question_state);
CREATE INDEX IF NOT EXISTS idx_reading_events_item
  ON reading_state_events(item_id, created_at);

CREATE TRIGGER IF NOT EXISTS reading_state_events_are_append_only
BEFORE UPDATE ON reading_state_events
BEGIN
  SELECT RAISE(ABORT, 'reading state history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS reading_state_events_cannot_be_deleted
BEFORE DELETE ON reading_state_events
BEGIN
  SELECT RAISE(ABORT, 'reading state history cannot be deleted');
END;
`

const migrationThree = `
CREATE TABLE IF NOT EXISTS search_index_state (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  dirty INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0, 1)),
  indexed_at TEXT
) STRICT;

CREATE VIRTUAL TABLE IF NOT EXISTS library_search_fts USING fts5(
  project_id UNINDEXED,
  entity_type UNINDEXED,
  entity_id UNINDEXED,
  source_id UNINDEXED,
  item_id UNINDEXED,
  item_ids_json UNINDEXED,
  review_document_id UNINDEXED,
  page_number UNINDEXED,
  anchor_json UNINDEXED,
  origin UNINDEXED,
  title,
  subtitle,
  body,
  tags,
  metadata,
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS search_items_insert_dirty
AFTER INSERT ON bibliographic_items
BEGIN
  INSERT INTO search_index_state(project_id, dirty) VALUES (NEW.project_id, 1)
  ON CONFLICT(project_id) DO UPDATE SET dirty = 1;
END;

CREATE TRIGGER IF NOT EXISTS search_items_update_dirty
AFTER UPDATE ON bibliographic_items
BEGIN
  INSERT INTO search_index_state(project_id, dirty) VALUES (NEW.project_id, 1)
  ON CONFLICT(project_id) DO UPDATE SET dirty = 1;
END;

CREATE TRIGGER IF NOT EXISTS search_items_delete_dirty
AFTER DELETE ON bibliographic_items
BEGIN
  INSERT INTO search_index_state(project_id, dirty) VALUES (OLD.project_id, 1)
  ON CONFLICT(project_id) DO UPDATE SET dirty = 1;
END;

CREATE TRIGGER IF NOT EXISTS search_sources_insert_dirty
AFTER INSERT ON sources
BEGIN
  INSERT INTO search_index_state(project_id, dirty) VALUES (NEW.project_id, 1)
  ON CONFLICT(project_id) DO UPDATE SET dirty = 1;
END;

CREATE TRIGGER IF NOT EXISTS search_sources_update_dirty
AFTER UPDATE ON sources
BEGIN
  INSERT INTO search_index_state(project_id, dirty) VALUES (NEW.project_id, 1)
  ON CONFLICT(project_id) DO UPDATE SET dirty = 1;
END;

CREATE TRIGGER IF NOT EXISTS search_sources_delete_dirty
AFTER DELETE ON sources
BEGIN
  INSERT INTO search_index_state(project_id, dirty) VALUES (OLD.project_id, 1)
  ON CONFLICT(project_id) DO UPDATE SET dirty = 1;
END;

CREATE TRIGGER IF NOT EXISTS search_annotations_insert_dirty
AFTER INSERT ON annotations
BEGIN
  INSERT INTO search_index_state(project_id, dirty) VALUES (NEW.project_id, 1)
  ON CONFLICT(project_id) DO UPDATE SET dirty = 1;
END;

CREATE TRIGGER IF NOT EXISTS search_annotations_update_dirty
AFTER UPDATE ON annotations
BEGIN
  INSERT INTO search_index_state(project_id, dirty) VALUES (NEW.project_id, 1)
  ON CONFLICT(project_id) DO UPDATE SET dirty = 1;
END;

CREATE TRIGGER IF NOT EXISTS search_annotations_delete_dirty
AFTER DELETE ON annotations
BEGIN
  INSERT INTO search_index_state(project_id, dirty) VALUES (OLD.project_id, 1)
  ON CONFLICT(project_id) DO UPDATE SET dirty = 1;
END;

CREATE TRIGGER IF NOT EXISTS search_fragments_insert_dirty
AFTER INSERT ON note_fragments
BEGIN
  INSERT INTO search_index_state(project_id, dirty) VALUES (NEW.project_id, 1)
  ON CONFLICT(project_id) DO UPDATE SET dirty = 1;
END;

CREATE TRIGGER IF NOT EXISTS search_fragments_update_dirty
AFTER UPDATE ON note_fragments
BEGIN
  INSERT INTO search_index_state(project_id, dirty) VALUES (NEW.project_id, 1)
  ON CONFLICT(project_id) DO UPDATE SET dirty = 1;
END;

CREATE TRIGGER IF NOT EXISTS search_fragments_delete_dirty
AFTER DELETE ON note_fragments
BEGIN
  INSERT INTO search_index_state(project_id, dirty) VALUES (OLD.project_id, 1)
  ON CONFLICT(project_id) DO UPDATE SET dirty = 1;
END;

CREATE TRIGGER IF NOT EXISTS search_reading_insert_dirty
AFTER INSERT ON bibliographic_reading_states
BEGIN
  INSERT INTO search_index_state(project_id, dirty)
  SELECT project_id, 1 FROM bibliographic_items WHERE id = NEW.item_id
  ON CONFLICT(project_id) DO UPDATE SET dirty = 1;
END;

CREATE TRIGGER IF NOT EXISTS search_reading_update_dirty
AFTER UPDATE ON bibliographic_reading_states
BEGIN
  INSERT INTO search_index_state(project_id, dirty)
  SELECT project_id, 1 FROM bibliographic_items WHERE id = NEW.item_id
  ON CONFLICT(project_id) DO UPDATE SET dirty = 1;
END;

CREATE TRIGGER IF NOT EXISTS search_reading_delete_dirty
AFTER DELETE ON bibliographic_reading_states
BEGIN
  INSERT INTO search_index_state(project_id, dirty)
  SELECT project_id, 1 FROM bibliographic_items WHERE id = OLD.item_id
  ON CONFLICT(project_id) DO UPDATE SET dirty = 1;
END;

CREATE TRIGGER IF NOT EXISTS search_reviews_insert_dirty
AFTER INSERT ON review_documents
BEGIN
  INSERT INTO search_index_state(project_id, dirty) VALUES (NEW.project_id, 1)
  ON CONFLICT(project_id) DO UPDATE SET dirty = 1;
END;

CREATE TRIGGER IF NOT EXISTS search_reviews_update_dirty
AFTER UPDATE ON review_documents
BEGIN
  INSERT INTO search_index_state(project_id, dirty) VALUES (NEW.project_id, 1)
  ON CONFLICT(project_id) DO UPDATE SET dirty = 1;
END;

CREATE TRIGGER IF NOT EXISTS search_reviews_delete_dirty
AFTER DELETE ON review_documents
BEGIN
  INSERT INTO search_index_state(project_id, dirty) VALUES (OLD.project_id, 1)
  ON CONFLICT(project_id) DO UPDATE SET dirty = 1;
END;

CREATE TRIGGER IF NOT EXISTS search_review_blocks_insert_dirty
AFTER INSERT ON review_blocks
BEGIN
  INSERT INTO search_index_state(project_id, dirty)
  SELECT project_id, 1 FROM review_documents WHERE id = NEW.document_id
  ON CONFLICT(project_id) DO UPDATE SET dirty = 1;
END;

CREATE TRIGGER IF NOT EXISTS search_review_blocks_update_dirty
AFTER UPDATE ON review_blocks
BEGIN
  INSERT INTO search_index_state(project_id, dirty)
  SELECT project_id, 1 FROM review_documents WHERE id = NEW.document_id
  ON CONFLICT(project_id) DO UPDATE SET dirty = 1;
END;

CREATE TRIGGER IF NOT EXISTS search_review_blocks_delete_dirty
AFTER DELETE ON review_blocks
BEGIN
  INSERT INTO search_index_state(project_id, dirty)
  SELECT project_id, 1 FROM review_documents WHERE id = OLD.document_id
  ON CONFLICT(project_id) DO UPDATE SET dirty = 1;
END;
`

const migrationFour = `
ALTER TABLE annotations ADD COLUMN current_note_fragment_id TEXT REFERENCES note_fragments(id);
ALTER TABLE annotations ADD COLUMN updated_at TEXT;

UPDATE annotations
SET current_note_fragment_id = (
      SELECT nf.id
      FROM note_fragments nf
      WHERE nf.annotation_id = annotations.id AND nf.origin = 'user'
      ORDER BY nf.created_at DESC, nf.rowid DESC
      LIMIT 1
    ),
    updated_at = created_at;

CREATE TABLE IF NOT EXISTS annotation_events (
  id TEXT PRIMARY KEY,
  annotation_id TEXT NOT NULL REFERENCES annotations(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN ('created', 'note_revised', 'category_changed', 'archived', 'restored')),
  from_value TEXT,
  to_value TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS annotation_exports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  source_id TEXT REFERENCES sources(id),
  format TEXT NOT NULL CHECK (format IN ('markdown')),
  annotation_count INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  exported_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_annotations_project_active
  ON annotations(project_id, archived_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_annotation_events_annotation
  ON annotation_events(annotation_id, created_at);

CREATE TRIGGER IF NOT EXISTS annotation_events_are_append_only
BEFORE UPDATE ON annotation_events
BEGIN
  SELECT RAISE(ABORT, 'annotation history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS annotation_events_cannot_be_deleted
BEFORE DELETE ON annotation_events
BEGIN
  SELECT RAISE(ABORT, 'annotation history cannot be deleted');
END;
`

const migrationFive = `
CREATE TABLE IF NOT EXISTS semantic_index_state (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  model TEXT NOT NULL,
  dimension INTEGER NOT NULL CHECK (dimension > 0 AND dimension <= 4096),
  source_indexed_at TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  chunk_count INTEGER NOT NULL CHECK (chunk_count >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS semantic_chunks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  source_id TEXT,
  item_id TEXT,
  item_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(item_ids_json)),
  review_document_id TEXT,
  page_number TEXT,
  anchor_json TEXT CHECK (anchor_json IS NULL OR json_valid(anchor_json)),
  origin TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  body TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
  end_offset INTEGER NOT NULL CHECK (end_offset >= start_offset),
  content_sha256 TEXT NOT NULL,
  model TEXT NOT NULL,
  dimension INTEGER NOT NULL CHECK (dimension > 0 AND dimension <= 4096),
  vector_blob BLOB NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_semantic_chunks_project_model
  ON semantic_chunks(project_id, model, origin);
CREATE INDEX IF NOT EXISTS idx_semantic_chunks_item
  ON semantic_chunks(project_id, item_id);
CREATE INDEX IF NOT EXISTS idx_semantic_chunks_entity
  ON semantic_chunks(project_id, entity_type, entity_id);
`

const migrationSix = `
ALTER TABLE fragment_relations ADD COLUMN created_by TEXT NOT NULL DEFAULT 'system'
  CHECK (created_by IN ('user', 'ai', 'system'));
ALTER TABLE fragment_relations ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'
  CHECK (status IN ('proposed', 'confirmed', 'rejected'));
ALTER TABLE fragment_relations ADD COLUMN rationale TEXT NOT NULL DEFAULT '';
ALTER TABLE fragment_relations ADD COLUMN reviewed_at TEXT;

UPDATE fragment_relations
SET created_by = 'user', status = 'confirmed', reviewed_at = created_at
WHERE relation = 'comments_on';

UPDATE fragment_relations
SET created_by = 'ai',
    status = CASE
      WHEN EXISTS (
        SELECT 1 FROM note_fragments nf
        WHERE nf.id = fragment_relations.from_fragment_id
          AND json_extract(nf.ai_provenance_json, '$.status') = 'accepted'
      ) THEN 'confirmed'
      ELSE 'proposed'
    END,
    reviewed_at = CASE
      WHEN EXISTS (
        SELECT 1 FROM note_fragments nf
        WHERE nf.id = fragment_relations.from_fragment_id
          AND json_extract(nf.ai_provenance_json, '$.status') = 'accepted'
      ) THEN created_at
      ELSE NULL
    END
WHERE relation = 'derived_from';

CREATE TABLE IF NOT EXISTS fragment_relation_events (
  id TEXT PRIMARY KEY,
  relation_id TEXT NOT NULL REFERENCES fragment_relations(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN ('migrated', 'created', 'proposed', 'confirmed', 'rejected', 'reopened')),
  actor TEXT NOT NULL CHECK (actor IN ('user', 'ai', 'system')),
  rationale TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
) STRICT;

INSERT OR IGNORE INTO fragment_relation_events(
  id, relation_id, event_type, actor, rationale, created_at
)
SELECT 'migration:' || id, id, 'migrated', 'system', rationale, created_at
FROM fragment_relations;

CREATE INDEX IF NOT EXISTS idx_fragment_relations_status
  ON fragment_relations(status, relation, created_at);
CREATE INDEX IF NOT EXISTS idx_fragment_relation_events_relation
  ON fragment_relation_events(relation_id, created_at);

CREATE TRIGGER IF NOT EXISTS fragment_relation_events_are_append_only
BEFORE UPDATE ON fragment_relation_events
BEGIN
  SELECT RAISE(ABORT, 'fragment relation history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS fragment_relation_events_cannot_be_deleted
BEFORE DELETE ON fragment_relation_events
BEGIN
  SELECT RAISE(ABORT, 'fragment relation history cannot be deleted');
END;
`

const migrationSeven = `
CREATE TABLE IF NOT EXISTS action_packs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  scope_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(scope_json)),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'confirmed', 'dismissed', 'completed')),
  created_by TEXT NOT NULL CHECK (created_by IN ('user', 'ai', 'system')),
  provider TEXT,
  model TEXT,
  generation_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT,
  completed_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS action_items (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL REFERENCES action_packs(id),
  position INTEGER NOT NULL CHECK (position >= 0),
  action_type TEXT NOT NULL
    CHECK (action_type IN ('read', 'compare', 'verify', 'experiment', 'review', 'note')),
  title TEXT NOT NULL,
  rationale TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'confirmed', 'dismissed', 'completed')),
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (pack_id, position)
) STRICT;

CREATE TABLE IF NOT EXISTS action_item_evidence (
  id TEXT PRIMARY KEY,
  action_item_id TEXT NOT NULL REFERENCES action_items(id),
  evidence_type TEXT NOT NULL
    CHECK (evidence_type IN ('fragment', 'review', 'source', 'bibliography')),
  entity_id TEXT NOT NULL,
  fragment_id TEXT REFERENCES note_fragments(id),
  review_block_id TEXT REFERENCES review_blocks(id),
  review_document_id TEXT REFERENCES review_documents(id),
  source_id TEXT REFERENCES sources(id),
  item_id TEXT REFERENCES bibliographic_items(id),
  label TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  excerpt_sha256 TEXT NOT NULL,
  page_number INTEGER CHECK (page_number IS NULL OR page_number > 0),
  anchor_json TEXT CHECK (anchor_json IS NULL OR json_valid(anchor_json)),
  created_at TEXT NOT NULL,
  CHECK (
    (evidence_type = 'fragment' AND fragment_id IS NOT NULL)
    OR (evidence_type = 'review' AND review_block_id IS NOT NULL AND review_document_id IS NOT NULL)
    OR (evidence_type = 'source' AND source_id IS NOT NULL)
    OR (evidence_type = 'bibliography' AND item_id IS NOT NULL)
  )
) STRICT;

CREATE TABLE IF NOT EXISTS action_pack_events (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL REFERENCES action_packs(id),
  item_id TEXT REFERENCES action_items(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN ('created', 'item_confirmed', 'item_dismissed', 'item_reopened', 'item_completed', 'pack_status_changed', 'migrated')),
  actor TEXT NOT NULL CHECK (actor IN ('user', 'ai', 'system')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_action_packs_project_status
  ON action_packs(project_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_action_items_pack_status
  ON action_items(pack_id, status, position);
CREATE INDEX IF NOT EXISTS idx_action_evidence_item
  ON action_item_evidence(action_item_id);
CREATE INDEX IF NOT EXISTS idx_action_events_pack
  ON action_pack_events(pack_id, created_at);

CREATE TRIGGER IF NOT EXISTS action_pack_events_are_append_only
BEFORE UPDATE ON action_pack_events
BEGIN
  SELECT RAISE(ABORT, 'action pack history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS action_pack_events_cannot_be_deleted
BEFORE DELETE ON action_pack_events
BEGIN
  SELECT RAISE(ABORT, 'action pack history cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS action_item_content_is_immutable
BEFORE UPDATE OF action_type, title, rationale, payload_json ON action_items
BEGIN
  SELECT RAISE(ABORT, 'action item content is immutable; create another proposal');
END;

CREATE TRIGGER IF NOT EXISTS action_item_evidence_is_immutable
BEFORE UPDATE ON action_item_evidence
BEGIN
  SELECT RAISE(ABORT, 'action item evidence is immutable');
END;

CREATE TRIGGER IF NOT EXISTS action_item_evidence_cannot_be_deleted
BEFORE DELETE ON action_item_evidence
BEGIN
  SELECT RAISE(ABORT, 'action item evidence cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS action_items_cannot_be_deleted
BEFORE DELETE ON action_items
BEGIN
  SELECT RAISE(ABORT, 'action items cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS action_packs_cannot_be_deleted
BEFORE DELETE ON action_packs
BEGIN
  SELECT RAISE(ABORT, 'action packs cannot be deleted');
END;
`

function openWorkspaceDatabase(filePath) {
  const database = new DatabaseSync(filePath)
  database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
  migrate(database)
  return database
}

function migrate(database) {
  let current = database.prepare('PRAGMA user_version').get().user_version
  if (current > SCHEMA_VERSION) {
    throw new Error(`研究库版本 ${current} 高于客户端支持的版本 ${SCHEMA_VERSION}，请升级客户端。`)
  }
  if (current < 1) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migrationOne)
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
        1,
        'confirmed-core-models',
        new Date().toISOString(),
      )
      database.exec('PRAGMA user_version = 1')
      database.exec('COMMIT')
      current = 1
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  if (current < 2) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migrationTwo)
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
        2,
        'paper-reading-state-and-history',
        new Date().toISOString(),
      )
      database.exec('PRAGMA user_version = 2')
      database.exec('COMMIT')
      current = 2
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  if (current < 3) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migrationThree)
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
        3,
        'local-unified-search-index',
        new Date().toISOString(),
      )
      database.exec('PRAGMA user_version = 3')
      database.exec('COMMIT')
      current = 3
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  if (current < 4) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migrationFour)
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
        4,
        'annotation-revisions-archive-and-export',
        new Date().toISOString(),
      )
      database.exec('PRAGMA user_version = 4')
      database.exec('COMMIT')
      current = 4
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  if (current < 5) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migrationFive)
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
        5,
        'local-semantic-vector-cache',
        new Date().toISOString(),
      )
      database.exec('PRAGMA user_version = 5')
      database.exec('COMMIT')
      current = 5
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  if (current < 6) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migrationSix)
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
        6,
        'auditable-evidence-relations',
        new Date().toISOString(),
      )
      database.exec('PRAGMA user_version = 6')
      database.exec('COMMIT')
      current = 6
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  if (current < 7) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migrationSeven)
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
        7,
        'auditable-action-packs',
        new Date().toISOString(),
      )
      database.exec('PRAGMA user_version = 7')
      database.exec('COMMIT')
      current = 7
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
}

module.exports = {
  SCHEMA_VERSION,
  openWorkspaceDatabase,
}
