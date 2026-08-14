const { DatabaseSync } = require('node:sqlite')

const SCHEMA_VERSION = 19

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

const migrationEight = `
ALTER TABLE projects ADD COLUMN research_question TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN current_hypothesis TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN stage TEXT NOT NULL DEFAULT '探索中';

CREATE TABLE IF NOT EXISTS research_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  record_type TEXT NOT NULL
    CHECK (record_type IN ('log', 'experiment', 'dataset', 'decision', 'milestone')),
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('planned', 'active', 'completed', 'blocked', 'archived')),
  occurred_at TEXT NOT NULL,
  file_path TEXT,
  source_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(source_ids_json)),
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_research_records_project_time
  ON research_records(project_id, occurred_at DESC, updated_at DESC);
`

const migrationNine = `
ALTER TABLE projects ADD COLUMN mode TEXT NOT NULL DEFAULT 'exploration'
  CHECK (mode IN ('exploration', 'execution'));

CREATE TABLE IF NOT EXISTS research_project_history (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  changed_fields_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(changed_fields_json)),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'user'
    CHECK (created_by IN ('user', 'ai', 'system'))
) STRICT;

CREATE TABLE IF NOT EXISTS research_milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'active', 'completed', 'blocked', 'archived')),
  acceptance_criteria_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(acceptance_criteria_json)),
  due_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS research_run_templates (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  defaults_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(defaults_json)),
  built_in INTEGER NOT NULL DEFAULT 0 CHECK (built_in IN (0, 1)),
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((built_in = 1 AND project_id IS NULL) OR (built_in = 0 AND project_id IS NOT NULL))
) STRICT;

CREATE TABLE IF NOT EXISTS research_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  milestone_id TEXT REFERENCES research_milestones(id),
  template_id TEXT REFERENCES research_run_templates(id),
  title TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  hypothesis TEXT NOT NULL DEFAULT '',
  changed_variables_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(changed_variables_json)),
  command TEXT NOT NULL DEFAULT '',
  environment TEXT NOT NULL DEFAULT '',
  procedure TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT 'planned'
    CHECK (outcome IN ('planned', 'running', 'success', 'failure', 'invalid', 'interrupted')),
  observations TEXT NOT NULL DEFAULT '',
  anomaly TEXT NOT NULL DEFAULT '',
  next_step TEXT NOT NULL DEFAULT '',
  source_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(source_ids_json)),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS research_artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  run_id TEXT NOT NULL REFERENCES research_runs(id),
  label TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'other'
    CHECK (role IN ('raw_data', 'processed_data', 'figure', 'log', 'script', 'config', 'model', 'video', 'image', 'document', 'directory', 'other')),
  path_original TEXT NOT NULL,
  path_resolved TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('file', 'directory')),
  exists_state TEXT NOT NULL CHECK (exists_state IN ('found', 'missing', 'denied')),
  size_bytes INTEGER,
  modified_at TEXT,
  content_sha256 TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS reading_translation_segments (
  project_id TEXT NOT NULL REFERENCES projects(id),
  source_id TEXT NOT NULL REFERENCES sources(id),
  segment_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  source_text TEXT NOT NULL,
  translated_text TEXT NOT NULL DEFAULT '',
  source_language TEXT NOT NULL DEFAULT 'en',
  target_language TEXT NOT NULL DEFAULT 'zh',
  provider TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'translated', 'failed')),
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, source_id, segment_id, source_hash)
) WITHOUT ROWID, STRICT;

CREATE TABLE IF NOT EXISTS action_item_research_evidence (
  id TEXT PRIMARY KEY,
  action_item_id TEXT NOT NULL REFERENCES action_items(id),
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('milestone', 'run')),
  entity_id TEXT NOT NULL,
  milestone_id TEXT REFERENCES research_milestones(id),
  run_id TEXT REFERENCES research_runs(id),
  label TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  excerpt_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (
    (evidence_type = 'milestone' AND milestone_id IS NOT NULL AND run_id IS NULL)
    OR (evidence_type = 'run' AND run_id IS NOT NULL AND milestone_id IS NULL)
  )
) STRICT;

CREATE INDEX IF NOT EXISTS idx_research_project_history
  ON research_project_history(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_milestones_project
  ON research_milestones(project_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_runs_project
  ON research_runs(project_id, started_at DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_runs_milestone
  ON research_runs(milestone_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_artifacts_run
  ON research_artifacts(run_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_reading_translation_lookup
  ON reading_translation_segments(project_id, source_id, segment_id, source_hash);
CREATE INDEX IF NOT EXISTS idx_action_research_evidence_item
  ON action_item_research_evidence(action_item_id);

CREATE TRIGGER IF NOT EXISTS research_project_history_cannot_be_updated
BEFORE UPDATE ON research_project_history
BEGIN
  SELECT RAISE(ABORT, 'research project history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS research_project_history_cannot_be_deleted
BEFORE DELETE ON research_project_history
BEGIN
  SELECT RAISE(ABORT, 'research project history cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS action_item_research_evidence_is_immutable
BEFORE UPDATE ON action_item_research_evidence
BEGIN
  SELECT RAISE(ABORT, 'action research evidence is immutable');
END;

CREATE TRIGGER IF NOT EXISTS action_item_research_evidence_cannot_be_deleted
BEFORE DELETE ON action_item_research_evidence
BEGIN
  SELECT RAISE(ABORT, 'action research evidence cannot be deleted');
END;

INSERT OR IGNORE INTO research_run_templates(
  id, project_id, name, category, description, defaults_json, built_in, created_at, updated_at
) VALUES
  ('builtin-general-test', NULL, '通用测试', 'general', '适用于尚未归类的一次工科测试。', '{}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-ros-parameter', NULL, 'ROS 参数测试', 'ros', '记录 ROS/ROS 2 节点、launch 命令、参数变化、日志与 bag。', '{"environment":"ROS / ROS 2","procedure":"启动环境；运行测试；保存日志与参数快照；记录观察。"}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-python-algorithm', NULL, 'Python / 算法测试', 'python', '记录脚本、依赖环境、输入、参数和指标。', '{"environment":"Python","procedure":"确认环境；运行脚本；保存指标和输出文件。"}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-data-analysis', NULL, '数据分析', 'data-analysis', '记录数据来源、清洗、分析脚本和图表。', '{"procedure":"确认原始数据；执行处理；保存派生数据与图表。"}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-simulation-cae', NULL, '仿真 / CAE', 'simulation', '适用于有限元、动力学、控制或其他仿真。', '{"procedure":"保存模型与参数；运行求解；登记结果文件和关键图表。"}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('builtin-physical-test', NULL, '实物测试', 'physical', '适用于样机、台架、传感器和仪器测试。', '{"procedure":"确认设备与安全条件；运行测试；保存原始采集数据、照片和异常。"}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
`

const migrationTen = `
CREATE TABLE IF NOT EXISTS research_reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  report_type TEXT NOT NULL
    CHECK (report_type IN ('weekly', 'meeting', 'stage_review')),
  period TEXT NOT NULL DEFAULT '',
  markdown TEXT NOT NULL DEFAULT '',
  source_refs_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(source_refs_json)),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'confirmed')),
  revision_number INTEGER NOT NULL DEFAULT 1 CHECK (revision_number >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS research_report_revisions (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES research_reports(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  created_at TEXT NOT NULL,
  UNIQUE (report_id, revision_number)
) STRICT;

CREATE TABLE IF NOT EXISTS research_report_exports (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES research_reports(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  file_path TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  exported_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS research_claims (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  section TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'confirmed')),
  required_evidence TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(required_evidence)),
  evidence_refs_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_refs_json)),
  revision_number INTEGER NOT NULL DEFAULT 1 CHECK (revision_number >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT,
  archived_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS research_claim_revisions (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES research_claims(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  created_at TEXT NOT NULL,
  UNIQUE (claim_id, revision_number)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_research_reports_project
  ON research_reports(project_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_report_revisions_report
  ON research_report_revisions(report_id, revision_number DESC);
CREATE INDEX IF NOT EXISTS idx_research_report_exports_report
  ON research_report_exports(report_id, exported_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_claims_project
  ON research_claims(project_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_claim_revisions_claim
  ON research_claim_revisions(claim_id, revision_number DESC);

CREATE TRIGGER IF NOT EXISTS research_report_revisions_cannot_be_updated
BEFORE UPDATE ON research_report_revisions
BEGIN
  SELECT RAISE(ABORT, 'research report revisions are append-only');
END;

CREATE TRIGGER IF NOT EXISTS research_report_revisions_cannot_be_deleted
BEFORE DELETE ON research_report_revisions
BEGIN
  SELECT RAISE(ABORT, 'research report revisions cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS research_report_exports_cannot_be_updated
BEFORE UPDATE ON research_report_exports
BEGIN
  SELECT RAISE(ABORT, 'research report exports are append-only');
END;

CREATE TRIGGER IF NOT EXISTS research_report_exports_cannot_be_deleted
BEFORE DELETE ON research_report_exports
BEGIN
  SELECT RAISE(ABORT, 'research report exports cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS research_claim_revisions_cannot_be_updated
BEFORE UPDATE ON research_claim_revisions
BEGIN
  SELECT RAISE(ABORT, 'research claim revisions are append-only');
END;

CREATE TRIGGER IF NOT EXISTS research_claim_revisions_cannot_be_deleted
BEFORE DELETE ON research_claim_revisions
BEGIN
  SELECT RAISE(ABORT, 'research claim revisions cannot be deleted');
END;
`

const migrationEleven = `
ALTER TABLE bibliographic_items ADD COLUMN accessed TEXT;
ALTER TABLE bibliographic_items ADD COLUMN publisher TEXT;
ALTER TABLE bibliographic_items ADD COLUMN publisher_place TEXT;
`

const migrationTwelve = `
CREATE TABLE IF NOT EXISTS structured_reading_documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  source_id TEXT NOT NULL UNIQUE REFERENCES sources(id),
  source_fingerprint TEXT NOT NULL,
  current_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS structured_reading_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES structured_reading_documents(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  source_id TEXT NOT NULL REFERENCES sources(id),
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  source_fingerprint TEXT NOT NULL,
  source_version INTEGER NOT NULL CHECK (source_version >= 1),
  created_by TEXT NOT NULL CHECK (created_by IN ('rules', 'ai', 'user', 'restore')),
  model TEXT,
  blocks_json TEXT NOT NULL CHECK (json_valid(blocks_json)),
  toc_json TEXT NOT NULL CHECK (json_valid(toc_json)),
  diagnostics_json TEXT NOT NULL CHECK (json_valid(diagnostics_json)),
  quality_issues_json TEXT NOT NULL CHECK (json_valid(quality_issues_json)),
  change_summary_json TEXT NOT NULL CHECK (json_valid(change_summary_json)),
  note TEXT NOT NULL DEFAULT '',
  restored_from_version_id TEXT REFERENCES structured_reading_versions(id),
  created_at TEXT NOT NULL,
  UNIQUE (document_id, version_number)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_structured_reading_versions_document
  ON structured_reading_versions(document_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_structured_reading_versions_source
  ON structured_reading_versions(source_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS structured_reading_versions_cannot_be_updated
BEFORE UPDATE ON structured_reading_versions
BEGIN
  SELECT RAISE(ABORT, 'structured reading versions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS structured_reading_versions_cannot_be_deleted
BEFORE DELETE ON structured_reading_versions
BEGIN
  SELECT RAISE(ABORT, 'structured reading versions cannot be deleted');
END;
`

const migrationThirteen = `
CREATE TABLE IF NOT EXISTS research_resume_state (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  active_view TEXT NOT NULL DEFAULT 'today'
    CHECK (active_view IN ('today', 'research-workspace', 'research-review', 'sources', 'reader', 'dashboard', 'evidence', 'actions')),
  source_id TEXT REFERENCES sources(id),
  reader_page INTEGER CHECK (reader_page IS NULL OR reader_page >= 1),
  reader_mode TEXT CHECK (reader_mode IS NULL OR reader_mode IN ('original', 'markdown', 'parallel', 'bilingual')),
  active_run_id TEXT REFERENCES research_runs(id),
  last_opened_at TEXT,
  last_active_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS research_resume_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('opened', 'state_saved', 'closed')),
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  occurred_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_research_resume_events_project
  ON research_resume_events(project_id, occurred_at DESC);

CREATE TRIGGER IF NOT EXISTS research_resume_events_cannot_be_updated
BEFORE UPDATE ON research_resume_events
BEGIN
  SELECT RAISE(ABORT, 'research resume events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS research_resume_events_cannot_be_deleted
BEFORE DELETE ON research_resume_events
BEGIN
  SELECT RAISE(ABORT, 'research resume events cannot be deleted');
END;
`

const migrationFourteen = `
CREATE TABLE IF NOT EXISTS research_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'inbox'
    CHECK (status IN ('inbox', 'today', 'later', 'waiting', 'completed', 'abandoned', 'deferred')),
  source_type TEXT NOT NULL
    CHECK (source_type IN ('manual', 'paper', 'annotation', 'ai_suggestion', 'run', 'anomaly', 'milestone', 'review_document')),
  source_id TEXT,
  source_role TEXT NOT NULL DEFAULT 'primary',
  origin TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('user', 'ai', 'system')),
  approval_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (approval_status IN ('not_required', 'proposed', 'confirmed', 'rejected')),
  is_formal INTEGER NOT NULL DEFAULT 1 CHECK (is_formal IN (0, 1)),
  wait_condition TEXT NOT NULL DEFAULT '',
  deferred_until TEXT,
  return_target_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(return_target_json)),
  source_snapshot_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(source_snapshot_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, source_type, source_id, source_role)
) STRICT;

CREATE TABLE IF NOT EXISTS research_task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES research_tasks(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN ('created', 'legacy_synced', 'confirmed', 'rejected', 'status_changed', 'source_written_back')),
  from_status TEXT,
  to_status TEXT,
  actor TEXT NOT NULL CHECK (actor IN ('user', 'ai', 'system')),
  note TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_research_tasks_project_status
  ON research_tasks(project_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_task_events_task
  ON research_task_events(task_id, occurred_at DESC);

CREATE TRIGGER IF NOT EXISTS research_task_events_cannot_be_updated
BEFORE UPDATE ON research_task_events
BEGIN
  SELECT RAISE(ABORT, 'research task events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS research_task_events_cannot_be_deleted
BEFORE DELETE ON research_task_events
BEGIN
  SELECT RAISE(ABORT, 'research task events cannot be deleted');
END;
`

const migrationFifteen = `
CREATE TABLE IF NOT EXISTS reading_translation_overrides (
  project_id TEXT NOT NULL REFERENCES projects(id),
  source_id TEXT NOT NULL REFERENCES sources(id),
  segment_id TEXT NOT NULL,
  base_source_hash TEXT NOT NULL,
  working_source_hash TEXT NOT NULL,
  working_source_text TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
  locked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, source_id, segment_id, base_source_hash)
) WITHOUT ROWID, STRICT;

CREATE TABLE IF NOT EXISTS reading_translation_terms (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  source_id TEXT NOT NULL REFERENCES sources(id),
  source_term TEXT NOT NULL,
  target_term TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, source_id, source_term)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_reading_translation_overrides_lookup
  ON reading_translation_overrides(project_id, source_id, segment_id, base_source_hash);
CREATE INDEX IF NOT EXISTS idx_reading_translation_terms_source
  ON reading_translation_terms(project_id, source_id, source_term);
`

const migrationSixteen = `
CREATE TABLE IF NOT EXISTS bibliographic_external_refs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  item_id TEXT NOT NULL REFERENCES bibliographic_items(id),
  adapter TEXT NOT NULL,
  external_library_id TEXT NOT NULL,
  external_item_key TEXT NOT NULL,
  external_version TEXT,
  collections_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(collections_json)),
  attachment_keys_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(attachment_keys_json)),
  record_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, adapter, external_library_id, external_item_key)
) STRICT;

CREATE TABLE IF NOT EXISTS bibliographic_sync_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  adapter TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('preview', 'applied')),
  status TEXT NOT NULL CHECK (status IN ('completed', 'conflict')),
  source_fingerprint TEXT NOT NULL,
  plan_json TEXT NOT NULL CHECK (json_valid(plan_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS portable_markdown_exports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('reading_card', 'review_document', 'experiment_retrospective', 'research_report')),
  entity_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  exported_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_bibliographic_external_refs_item
  ON bibliographic_external_refs(project_id, item_id);
CREATE INDEX IF NOT EXISTS idx_bibliographic_sync_runs_project
  ON bibliographic_sync_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_portable_markdown_exports_entity
  ON portable_markdown_exports(project_id, entity_kind, entity_id, exported_at DESC);
`

const migrationSeventeen = `
CREATE TABLE IF NOT EXISTS agent_memory_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL CHECK (kind IN ('research_direction', 'preferred_term', 'reading_history', 'experiment_history', 'preference')),
  content TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('user', 'project', 'paper', 'run', 'agent')),
  source_id TEXT,
  importance INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  review_state TEXT NOT NULL DEFAULT 'draft' CHECK (review_state IN ('draft', 'confirmed', 'rejected', 'archived')),
  created_by TEXT NOT NULL CHECK (created_by IN ('user', 'ai', 'system')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT,
  UNIQUE (project_id, kind, content_sha256)
) STRICT;

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  scope_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(scope_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS agent_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_refs_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS agent_plans (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  objective TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'running', 'completed', 'cancelled')),
  created_by TEXT NOT NULL CHECK (created_by IN ('user', 'ai', 'system')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT,
  completed_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS agent_plan_steps (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES agent_plans(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  position INTEGER NOT NULL CHECK (position >= 0),
  tool_name TEXT NOT NULL CHECK (tool_name IN ('searchPaper', 'readPaper', 'extractEvidence', 'queryKnowledgeGraph', 'createTask', 'updateExperiment', 'generateReport')),
  title TEXT NOT NULL,
  rationale TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(input_json)),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'running', 'completed', 'failed', 'dismissed')),
  requires_confirmation INTEGER NOT NULL CHECK (requires_confirmation IN (0, 1)),
  output_json TEXT CHECK (output_json IS NULL OR json_valid(output_json)),
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT,
  completed_at TEXT,
  UNIQUE (plan_id, position)
) STRICT;

CREATE TABLE IF NOT EXISTS agent_tool_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  session_id TEXT NOT NULL REFERENCES agent_sessions(id),
  plan_id TEXT NOT NULL REFERENCES agent_plans(id),
  step_id TEXT NOT NULL REFERENCES agent_plan_steps(id),
  tool_name TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('proposed', 'confirmed', 'dismissed', 'started', 'completed', 'failed')),
  actor TEXT NOT NULL CHECK (actor IN ('user', 'ai', 'system')),
  snapshot_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(snapshot_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_agent_memory_project
  ON agent_memory_items(project_id, review_state, kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_project
  ON agent_sessions(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_turns_session
  ON agent_turns(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_plans_session
  ON agent_plans(session_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_steps_plan
  ON agent_plan_steps(plan_id, position);
CREATE INDEX IF NOT EXISTS idx_agent_tool_events_step
  ON agent_tool_events(step_id, created_at);

CREATE TRIGGER IF NOT EXISTS agent_turns_cannot_be_updated
BEFORE UPDATE ON agent_turns BEGIN SELECT RAISE(ABORT, 'agent turns are append-only'); END;
CREATE TRIGGER IF NOT EXISTS agent_turns_cannot_be_deleted
BEFORE DELETE ON agent_turns BEGIN SELECT RAISE(ABORT, 'agent turns cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS agent_tool_events_cannot_be_updated
BEFORE UPDATE ON agent_tool_events BEGIN SELECT RAISE(ABORT, 'agent tool events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS agent_tool_events_cannot_be_deleted
BEFORE DELETE ON agent_tool_events BEGIN SELECT RAISE(ABORT, 'agent tool events cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS agent_plan_step_definition_is_immutable
BEFORE UPDATE OF plan_id, position, tool_name, title, rationale, input_json, requires_confirmation ON agent_plan_steps
BEGIN SELECT RAISE(ABORT, 'agent plan step definition is immutable'); END;
`

const migrationEighteen = `
CREATE TABLE IF NOT EXISTS evidence_cards (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  paper_id TEXT REFERENCES bibliographic_items(id),
  source_id TEXT NOT NULL REFERENCES sources(id),
  source_fragment_id TEXT NOT NULL REFERENCES note_fragments(id),
  understanding_fragment_id TEXT REFERENCES note_fragments(id),
  page_number INTEGER CHECK (page_number IS NULL OR page_number >= 1),
  figure_label TEXT,
  table_label TEXT,
  algorithm_label TEXT,
  original_sha256 TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  related_experiment_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(related_experiment_ids_json)),
  origin TEXT NOT NULL CHECK (origin IN ('user', 'ai', 'import', 'system')),
  review_state TEXT NOT NULL DEFAULT 'draft' CHECK (review_state IN ('draft', 'confirmed', 'rejected', 'archived')),
  created_by TEXT NOT NULL CHECK (created_by IN ('user', 'ai', 'system')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT,
  UNIQUE (project_id, source_fragment_id)
) STRICT;

CREATE TABLE IF NOT EXISTS evidence_card_events (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES evidence_cards(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'updated', 'confirmed', 'rejected', 'archived', 'linked')),
  actor TEXT NOT NULL CHECK (actor IN ('user', 'ai', 'system')),
  snapshot_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(snapshot_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS knowledge_nodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  node_type TEXT NOT NULL CHECK (node_type IN ('paper', 'author', 'concept', 'method', 'experiment', 'dataset', 'code', 'idea', 'claim', 'evidence')),
  entity_id TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  properties_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(properties_json)),
  origin TEXT NOT NULL CHECK (origin IN ('source', 'user', 'ai_suggestion', 'import', 'system')),
  review_state TEXT NOT NULL DEFAULT 'draft' CHECK (review_state IN ('draft', 'confirmed', 'rejected', 'archived')),
  created_by TEXT NOT NULL CHECK (created_by IN ('user', 'ai', 'system')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT,
  UNIQUE (project_id, node_type, entity_id)
) STRICT;

CREATE TABLE IF NOT EXISTS knowledge_edges (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  from_node_id TEXT NOT NULL REFERENCES knowledge_nodes(id),
  to_node_id TEXT NOT NULL REFERENCES knowledge_nodes(id),
  edge_type TEXT NOT NULL CHECK (edge_type IN ('authored_by', 'mentions', 'proposes', 'uses', 'validated_by', 'derived_from', 'supports', 'contradicts', 'related_to')),
  evidence_refs_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_refs_json)),
  rationale TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL CHECK (origin IN ('source', 'user', 'ai_suggestion', 'import', 'system')),
  review_state TEXT NOT NULL DEFAULT 'draft' CHECK (review_state IN ('draft', 'confirmed', 'rejected', 'archived')),
  created_by TEXT NOT NULL CHECK (created_by IN ('user', 'ai', 'system')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT,
  UNIQUE (project_id, from_node_id, to_node_id, edge_type)
) STRICT;

CREATE TABLE IF NOT EXISTS knowledge_graph_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('node', 'edge')),
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'confirmed', 'rejected', 'archived', 'updated', 'bootstrapped')),
  actor TEXT NOT NULL CHECK (actor IN ('user', 'ai', 'system')),
  snapshot_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(snapshot_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_evidence_cards_project
  ON evidence_cards(project_id, review_state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_project
  ON knowledge_nodes(project_id, review_state, node_type, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_edges_project
  ON knowledge_edges(project_id, review_state, edge_type, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_edges_from
  ON knowledge_edges(project_id, from_node_id, review_state);
CREATE INDEX IF NOT EXISTS idx_knowledge_edges_to
  ON knowledge_edges(project_id, to_node_id, review_state);

CREATE TRIGGER IF NOT EXISTS evidence_card_events_cannot_be_updated
BEFORE UPDATE ON evidence_card_events BEGIN SELECT RAISE(ABORT, 'evidence card events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS evidence_card_events_cannot_be_deleted
BEFORE DELETE ON evidence_card_events BEGIN SELECT RAISE(ABORT, 'evidence card events cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS knowledge_graph_events_cannot_be_updated
BEFORE UPDATE ON knowledge_graph_events BEGIN SELECT RAISE(ABORT, 'knowledge graph events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS knowledge_graph_events_cannot_be_deleted
BEFORE DELETE ON knowledge_graph_events BEGIN SELECT RAISE(ABORT, 'knowledge graph events cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS confirmed_knowledge_edge_requires_evidence_on_insert
BEFORE INSERT ON knowledge_edges
WHEN NEW.review_state = 'confirmed' AND json_array_length(NEW.evidence_refs_json) = 0
BEGIN SELECT RAISE(ABORT, 'confirmed knowledge edge requires evidence'); END;
CREATE TRIGGER IF NOT EXISTS confirmed_knowledge_edge_requires_evidence_on_update
BEFORE UPDATE OF review_state, evidence_refs_json ON knowledge_edges
WHEN NEW.review_state = 'confirmed' AND json_array_length(NEW.evidence_refs_json) = 0
BEGIN SELECT RAISE(ABORT, 'confirmed knowledge edge requires evidence'); END;
`

const migrationNineteen = `
CREATE TABLE IF NOT EXISTS workbench_projects (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id),
  kind TEXT NOT NULL DEFAULT 'research'
    CHECK (kind IN ('general', 'research', 'engineering', 'document', 'code', 'data')),
  name TEXT NOT NULL,
  vault_path TEXT NOT NULL,
  external_roots_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(external_roots_json)),
  capability_packs_json TEXT NOT NULL DEFAULT '["research"]' CHECK (json_valid(capability_packs_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  workbench_project_id TEXT NOT NULL REFERENCES workbench_projects(id),
  legacy_session_id TEXT REFERENCES agent_sessions(id),
  objective TEXT NOT NULL,
  acceptance_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(acceptance_json)),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'awaiting_authorization', 'running', 'replanning', 'waiting_human', 'paused', 'verifying', 'completed', 'failed', 'cancelled')),
  plan_version INTEGER NOT NULL DEFAULT 1 CHECK (plan_version >= 1),
  permission_revision INTEGER NOT NULL DEFAULT 0 CHECK (permission_revision >= 0),
  budget_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(budget_json)),
  model_roles_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(model_roles_json)),
  current_step_id TEXT,
  current_checkpoint_id TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS agent_run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id),
  plan_version INTEGER NOT NULL CHECK (plan_version >= 1),
  position INTEGER NOT NULL CHECK (position >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('model', 'tool', 'verify', 'human')),
  tool_name TEXT,
  title TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  input_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(input_json)),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'waiting_confirmation', 'completed', 'failed', 'skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 2 CHECK (max_attempts BETWEEN 1 AND 5),
  high_risk INTEGER NOT NULL DEFAULT 0 CHECK (high_risk IN (0, 1)),
  output_json TEXT CHECK (output_json IS NULL OR json_valid(output_json)),
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  UNIQUE (run_id, plan_version, position)
) STRICT;

CREATE TABLE IF NOT EXISTS agent_permission_grants (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  scope_json TEXT NOT NULL CHECK (json_valid(scope_json)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  authorized_by TEXT NOT NULL DEFAULT 'user' CHECK (authorized_by IN ('user', 'system')),
  authorized_at TEXT NOT NULL,
  expires_at TEXT,
  invalidated_reason TEXT,
  UNIQUE (run_id, revision)
) STRICT;

CREATE TABLE IF NOT EXISTS agent_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id),
  step_id TEXT REFERENCES agent_run_steps(id),
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('user', 'agent', 'tool', 'system')),
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS agent_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id),
  step_id TEXT REFERENCES agent_run_steps(id),
  kind TEXT NOT NULL CHECK (kind IN ('file', 'report', 'patch', 'dataset', 'screenshot', 'trace', 'other')),
  label TEXT NOT NULL,
  path TEXT,
  sha256 TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS agent_decisions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id),
  step_id TEXT REFERENCES agent_run_steps(id),
  decision_type TEXT NOT NULL CHECK (decision_type IN ('authorization', 'high_risk', 'choice', 'formal_record', 'recovery')),
  prompt TEXT NOT NULL,
  options_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(options_json)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'answered', 'expired')),
  response_json TEXT CHECK (response_json IS NULL OR json_valid(response_json)),
  created_at TEXT NOT NULL,
  resolved_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS agent_checkpoints (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id),
  step_id TEXT REFERENCES agent_run_steps(id),
  reason TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS agent_evaluations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id),
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'partial')),
  score REAL NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 1),
  criteria_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(criteria_json)),
  summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS model_call_metrics (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id),
  step_id TEXT REFERENCES agent_run_steps(id),
  role TEXT NOT NULL CHECK (role IN ('planner', 'executor', 'vision', 'verifier', 'embedding')),
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
  completion_tokens INTEGER CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
  total_tokens INTEGER CHECK (total_tokens IS NULL OR total_tokens >= 0),
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  estimated_cost REAL CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('completed', 'failed', 'cancelled')),
  error TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_agent_runs_project ON agent_runs(workbench_project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_run_steps_run ON agent_run_steps(run_id, plan_version, position);
CREATE INDEX IF NOT EXISTS idx_agent_events_run ON agent_events(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_decisions_run ON agent_decisions(run_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_run ON agent_checkpoints(run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_metrics_run ON model_call_metrics(run_id, created_at);

CREATE TRIGGER IF NOT EXISTS agent_events_cannot_be_updated
BEFORE UPDATE ON agent_events BEGIN SELECT RAISE(ABORT, 'agent events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS agent_events_cannot_be_deleted
BEFORE DELETE ON agent_events BEGIN SELECT RAISE(ABORT, 'agent events cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS model_call_metrics_cannot_be_updated
BEFORE UPDATE ON model_call_metrics BEGIN SELECT RAISE(ABORT, 'model metrics are append-only'); END;
CREATE TRIGGER IF NOT EXISTS model_call_metrics_cannot_be_deleted
BEFORE DELETE ON model_call_metrics BEGIN SELECT RAISE(ABORT, 'model metrics cannot be deleted'); END;
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
  if (current < 8) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migrationEight)
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
        8,
        'project-research-journal',
        new Date().toISOString(),
      )
      database.exec('PRAGMA user_version = 8')
      database.exec('COMMIT')
      current = 8
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  if (current < 9) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migrationNine)
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
        9,
        'engineering-research-runs-and-parallel-translation-cache',
        new Date().toISOString(),
      )
      database.exec('PRAGMA user_version = 9')
      database.exec('COMMIT')
      current = 9
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  if (current < 10) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migrationTen)
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
        10,
        'traceable-research-reports-and-claims',
        new Date().toISOString(),
      )
      database.exec('PRAGMA user_version = 10')
      database.exec('COMMIT')
      current = 10
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  if (current < 11) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migrationEleven)
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
        11,
        'citation-publication-metadata',
        new Date().toISOString(),
      )
      database.exec('PRAGMA user_version = 11')
      database.exec('COMMIT')
      current = 11
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  if (current < 12) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migrationTwelve)
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
        12,
        'versioned-structured-reading-layer',
        new Date().toISOString(),
      )
      database.exec('PRAGMA user_version = 12')
      database.exec('COMMIT')
      current = 12
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  if (current < 13) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migrationThirteen)
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
        13,
        'today-research-resume-state',
        new Date().toISOString(),
      )
      database.exec('PRAGMA user_version = 13')
      database.exec('COMMIT')
      current = 13
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  if (current < 14) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migrationFourteen)
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
        14,
        'unified-research-tasks',
        new Date().toISOString(),
      )
      database.exec('PRAGMA user_version = 14')
      database.exec('COMMIT')
      current = 14
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  if (current < 15) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migrationFifteen)
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
        15,
        'translation-overrides-locks-and-glossary',
        new Date().toISOString(),
      )
      database.exec('PRAGMA user_version = 15')
      database.exec('COMMIT')
      current = 15
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  if (current < 16) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migrationSixteen)
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
        16,
        'zotero-metadata-sync-and-portable-markdown',
        new Date().toISOString(),
      )
      database.exec('PRAGMA user_version = 16')
      database.exec('COMMIT')
      current = 16
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  if (current < 17) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migrationSeventeen)
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
        17,
        'persistent-research-agent-memory-plans-and-tools',
        new Date().toISOString(),
      )
      database.exec('PRAGMA user_version = 17')
      database.exec('COMMIT')
      current = 17
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  if (current < 18) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migrationEighteen)
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
        18,
        'typed-knowledge-graph-and-evidence-cards',
        new Date().toISOString(),
      )
      database.exec('PRAGMA user_version = 18')
      database.exec('COMMIT')
      current = 18
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  if (current < 19) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migrationNineteen)
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
        19,
        'personal-agent-workbench-projects-runs-permissions-and-evaluation',
        new Date().toISOString(),
      )
      database.exec('PRAGMA user_version = 19')
      database.exec('COMMIT')
      current = 19
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
