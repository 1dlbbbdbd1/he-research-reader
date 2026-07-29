const { DatabaseSync } = require('node:sqlite')

const SCHEMA_VERSION = 3

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
}

module.exports = {
  SCHEMA_VERSION,
  openWorkspaceDatabase,
}
