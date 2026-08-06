CREATE UNIQUE INDEX IF NOT EXISTS users_id_organization_unique
  ON users(id, organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS workspaces_id_organization_unique
  ON workspaces(id, organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS book_versions_id_organization_unique
  ON book_versions(id, organization_id_at_creation);

CREATE TABLE student_book_favorites (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  book_version_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (organization_id, workspace_id, actor_id, book_version_id),
  FOREIGN KEY (actor_id, organization_id) REFERENCES users(id, organization_id),
  FOREIGN KEY (workspace_id, organization_id) REFERENCES workspaces(id, organization_id),
  FOREIGN KEY (book_version_id, organization_id) REFERENCES book_versions(id, organization_id_at_creation)
);

CREATE TABLE student_reading_lists (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (id, organization_id, workspace_id, actor_id),
  FOREIGN KEY (actor_id, organization_id) REFERENCES users(id, organization_id),
  FOREIGN KEY (workspace_id, organization_id) REFERENCES workspaces(id, organization_id)
);

CREATE TABLE student_reading_list_items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  book_version_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (list_id, book_version_id),
  FOREIGN KEY (list_id, organization_id, workspace_id, actor_id)
    REFERENCES student_reading_lists(id, organization_id, workspace_id, actor_id) ON DELETE CASCADE,
  FOREIGN KEY (book_version_id, organization_id) REFERENCES book_versions(id, organization_id_at_creation)
);

CREATE TABLE student_bookmarks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  book_version_id TEXT NOT NULL,
  page_no INTEGER NOT NULL CHECK (page_no > 0),
  label TEXT NOT NULL DEFAULT '' CHECK (length(label) <= 160),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  FOREIGN KEY (actor_id, organization_id) REFERENCES users(id, organization_id),
  FOREIGN KEY (workspace_id, organization_id) REFERENCES workspaces(id, organization_id),
  FOREIGN KEY (book_version_id, organization_id) REFERENCES book_versions(id, organization_id_at_creation),
  FOREIGN KEY (book_version_id, page_no) REFERENCES book_pages(book_version_id, page_no)
);

CREATE TABLE student_saved_excerpts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  book_version_id TEXT NOT NULL,
  page_no INTEGER NOT NULL CHECK (page_no > 0),
  block_id TEXT,
  char_start INTEGER CHECK (char_start IS NULL OR char_start >= 0),
  char_end INTEGER CHECK (char_end IS NULL OR char_end >= char_start),
  quote_text TEXT NOT NULL CHECK (length(trim(quote_text)) BETWEEN 1 AND 2000),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  FOREIGN KEY (actor_id, organization_id) REFERENCES users(id, organization_id),
  FOREIGN KEY (workspace_id, organization_id) REFERENCES workspaces(id, organization_id),
  FOREIGN KEY (book_version_id, organization_id) REFERENCES book_versions(id, organization_id_at_creation),
  FOREIGN KEY (book_version_id, page_no) REFERENCES book_pages(book_version_id, page_no)
);

CREATE TABLE student_annotations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  book_version_id TEXT NOT NULL,
  page_no INTEGER NOT NULL CHECK (page_no > 0),
  block_id TEXT,
  char_start INTEGER CHECK (char_start IS NULL OR char_start >= 0),
  char_end INTEGER CHECK (char_end IS NULL OR char_end >= char_start),
  quote_text TEXT NOT NULL DEFAULT '' CHECK (length(quote_text) <= 2000),
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
  color TEXT NOT NULL DEFAULT 'violet' CHECK (color IN ('violet', 'amber', 'green', 'blue', 'rose')),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  FOREIGN KEY (actor_id, organization_id) REFERENCES users(id, organization_id),
  FOREIGN KEY (workspace_id, organization_id) REFERENCES workspaces(id, organization_id),
  FOREIGN KEY (book_version_id, organization_id) REFERENCES book_versions(id, organization_id_at_creation),
  FOREIGN KEY (book_version_id, page_no) REFERENCES book_pages(book_version_id, page_no)
);

CREATE INDEX student_book_favorites_scope_order
  ON student_book_favorites(organization_id, workspace_id, actor_id, position, created_at);

CREATE INDEX student_reading_lists_scope_order
  ON student_reading_lists(organization_id, workspace_id, actor_id, position, created_at);

CREATE INDEX student_reading_list_items_scope_order
  ON student_reading_list_items(organization_id, workspace_id, actor_id, list_id, position, created_at);

CREATE INDEX student_bookmarks_scope_order
  ON student_bookmarks(organization_id, workspace_id, actor_id, book_version_id, position, created_at);

CREATE INDEX student_saved_excerpts_scope_order
  ON student_saved_excerpts(organization_id, workspace_id, actor_id, book_version_id, position, created_at);

CREATE INDEX student_annotations_scope_order
  ON student_annotations(organization_id, workspace_id, actor_id, book_version_id, position, created_at);
