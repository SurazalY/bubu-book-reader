-- T1-2 / 契约 3.1.1：community_posts 增加独立 book_id，承载「我要分享的书」。
-- 列可空（存量演示行没有该值）；应用层 submitPost 必填。不得加 NOT NULL / CHECK。
-- quote_book_id / quote_page / quote_text 三列与 033 CHECK 一律不动。
-- migrate.js 按 checksum 跳过已应用记录，本文件可重复跑迁移器。

ALTER TABLE community_posts ADD COLUMN book_id TEXT;
CREATE INDEX idx_community_posts_book ON community_posts(organization_id_at_creation, book_id, status);
