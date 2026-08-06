ALTER TABLE community_posts RENAME TO community_posts_v030;

CREATE TABLE community_posts (
  id TEXT PRIMARY KEY,
  organization_id_at_creation TEXT NOT NULL,
  workspace_id_at_creation TEXT NOT NULL,
  class_id_at_creation TEXT NOT NULL,
  actor_id_at_creation TEXT NOT NULL,
  author_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('class', 'school')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  quote_book_id TEXT,
  quote_page INTEGER,
  quote_text TEXT,
  status TEXT NOT NULL CHECK (status IN ('submitted', 'class_approved', 'approved', 'rejected', 'delisted')),
  ai_assisted INTEGER NOT NULL DEFAULT 0,
  organization_snapshot_json TEXT NOT NULL,
  workspace_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  CHECK (
    (quote_book_id IS NULL AND quote_page IS NULL AND quote_text IS NULL)
    OR (quote_book_id IS NOT NULL AND quote_page IS NOT NULL AND quote_page > 0 AND quote_text IS NOT NULL)
  )
);

INSERT INTO community_posts (
  id, organization_id_at_creation, workspace_id_at_creation, class_id_at_creation,
  actor_id_at_creation, author_id, scope, title, body, quote_book_id, quote_page, quote_text,
  status, ai_assisted, organization_snapshot_json, workspace_snapshot_json,
  created_at, updated_at, version
)
SELECT
  id,
  organization_id_at_creation,
  workspace_id_at_creation,
  COALESCE(
    json_extract(workspace_snapshot_json, '$.scopeId'),
    json_extract(workspace_snapshot_json, '$.classId'),
    workspace_id_at_creation
  ),
  actor_id_at_creation,
  author_id,
  'class',
  title,
  body,
  NULL,
  NULL,
  NULL,
  status,
  ai_assisted,
  organization_snapshot_json,
  workspace_snapshot_json,
  created_at,
  updated_at,
  version
FROM community_posts_v030;

DROP TABLE community_posts_v030;

ALTER TABLE post_reviews ADD COLUMN review_stage TEXT NOT NULL DEFAULT 'class' CHECK (review_stage IN ('class', 'school'));
ALTER TABLE post_reviews ADD COLUMN organization_id_at_review TEXT;
ALTER TABLE post_reviews ADD COLUMN class_id_at_review TEXT;

ALTER TABLE post_reactions RENAME TO post_reactions_v030;

CREATE TABLE post_reactions (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  organization_id_at_reaction TEXT,
  workspace_id_at_reaction TEXT,
  class_id_at_reaction TEXT,
  reaction_type TEXT NOT NULL CHECK (reaction_type IN ('appreciate', 'insight', 'bookmark', 'clap', 'same', 'learn', 'warm')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(post_id, actor_id, reaction_type)
);

INSERT INTO post_reactions (
  id, post_id, actor_id, organization_id_at_reaction, workspace_id_at_reaction,
  class_id_at_reaction, reaction_type, created_at, updated_at, version
)
SELECT
  reaction.id,
  reaction.post_id,
  reaction.actor_id,
  post.organization_id_at_creation,
  post.workspace_id_at_creation,
  post.class_id_at_creation,
  reaction.reaction_type,
  reaction.created_at,
  reaction.updated_at,
  reaction.version
FROM post_reactions_v030 AS reaction
JOIN community_posts AS post ON post.id = reaction.post_id;

DROP TABLE post_reactions_v030;

CREATE INDEX idx_community_posts_org_scope_status_class
  ON community_posts(organization_id_at_creation, scope, status, class_id_at_creation, created_at);
CREATE INDEX idx_community_posts_author_workspace
  ON community_posts(author_id, workspace_id_at_creation, created_at);
CREATE INDEX idx_post_reviews_post_stage
  ON post_reviews(post_id, review_stage, created_at);
CREATE INDEX idx_post_reactions_actor_post
  ON post_reactions(actor_id, post_id, reaction_type);
