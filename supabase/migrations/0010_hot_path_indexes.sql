-- Indexes for queries that run on every page view (review, November 2026).

-- Impression dedupe (lib/analytics: recordImpressions, markOpened) looks up a person's recent
-- impressions of one video in one place. Without this every Circle, list and search render scans
-- the whole table, which grows with every page view.
create index if not exists recommendation_impressions_lookup_idx
  on recommendation_impressions (user_id, resource_id, source_type, shown_at desc);

-- Topic filters, topic rules, onboarding and search join from a topic to its vouches and videos.
create index if not exists vouch_topics_topic_idx on vouch_topics (topic_id);
create index if not exists resource_topics_topic_idx on resource_topics (topic_id);

-- "Is this video already in my lists?" on the watch page, and list cleanup when a video goes away.
create index if not exists list_items_resource_idx on list_items (resource_id);
