-- One HN comment can recommend several videos. 0005 keyed mentions by comment alone, so a
-- comment recommending two videos kept only the last one. Key by comment and video instead.
alter table hn_mentions drop constraint hn_mentions_pkey;
alter table hn_mentions add primary key (comment_id, resource_id);
