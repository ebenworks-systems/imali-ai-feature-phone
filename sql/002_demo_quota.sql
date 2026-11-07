-- Imali AI feature-phone ledger: how often each address may make demo shops, and how many demo shops the site may
-- make a day. Kept in the database, not in the memory of one serverless instance, so the limits hold across instances.
--
-- No begin or commit here: scripts/migrate.mjs runs each file in one transaction.
-- An applied migration is never edited; a change goes in a new file.
--
-- The address is never stored. address_hash is the SHA-256 of the server-side salt and the address, as 64 lower-case
-- hex digits, and the check below makes the database refuse anything that is not shaped like that (an IPv4 or IPv6
-- address, or the word "unknown", is shorter than 64 characters).
-- Rows older than 24 hours are removed by the store as part of each call, so the table stays small.

create table demo_quota (
  id            bigint generated always as identity,
  address_hash  text not null check (address_hash ~ '^[0-9a-f]{64}$'),
  -- 'call': a call to POST /api/phone/demo that was allowed. 'made': a demo shop that was really made.
  kind          text not null check (kind in ('call', 'made')),
  happened_at   timestamptz not null,
  constraint demo_quota_pkey primary key (id)
);

create index demo_quota_address_kind_time on demo_quota (address_hash, kind, happened_at);
create index demo_quota_kind_time on demo_quota (kind, happened_at);
