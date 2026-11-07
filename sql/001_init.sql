-- Imali AI feature-phone ledger: the first schema.
--
-- No begin or commit here: scripts/migrate.mjs runs each file in one transaction.
-- The constraint and index names are part of the contract: src/store/postgres/store.ts maps errors by them.

create table shops (
  id          text not null,
  name        text not null check (char_length(name) between 1 and 24),
  phone       text not null,
  currency    text not null check (currency in ('ZAR','USD','KES','NGN','GHS','ZMW','BWP')),
  time_zone   text not null,
  created_at  timestamptz not null,
  constraint shops_pkey primary key (id),
  constraint shops_phone_unique unique (phone)
);

create table records (
  seq                    bigint generated always as identity,
  id                     text not null,
  shop_id                text not null references shops (id),
  kind                   text not null check (kind in ('sale','expense','debt','payment','reversal')),
  amount                 bigint not null check (amount >= 0 and amount <= 9007199254740991),
  item                   text,
  customer_display_name  text,
  customer_key           text,
  reverses_record_id     text,
  channel                text not null check (channel in ('ussd','sms','web')),
  original_words         text not null,
  created_at             timestamptz not null,
  -- The duplicate-save guard of the dialled menu: one record per id, checked before anything else.
  constraint records_pkey primary key (id),
  constraint records_shop_id_id_unique unique (shop_id, id),
  -- A reversal points at a record of the same shop (not enforced while reverses_record_id is null).
  constraint records_reverses_fk foreign key (shop_id, reverses_record_id) references records (shop_id, id),
  constraint records_amount_by_kind
    check ((kind = 'reversal' and amount = 0) or (kind <> 'reversal' and amount > 0)),
  constraint records_customer_by_kind
    check ((kind in ('debt','payment')) = (customer_display_name is not null and customer_key is not null)),
  constraint records_reverses_by_kind
    check ((kind = 'reversal') = (reverses_record_id is not null))
);

-- A record can be reversed once.
create unique index records_one_reversal_per_record on records (reverses_record_id)
  where reverses_record_id is not null;
create index records_shop_seq on records (shop_id, seq);

-- The question the text handler is waiting for the owner to answer. One per phone number.
create table pending_questions (
  phone       text primary key,
  kind        text not null check (kind in ('ambiguous','largeAmount','signup')),
  payload     jsonb not null,
  created_at  timestamptz not null,
  expires_at  timestamptz not null
);
create index pending_questions_expires on pending_questions (expires_at);

-- Text callbacks already handled (Africa's Talking can send one twice). The reply is kept to answer a repeat.
create table processed_texts (
  phone       text not null,
  message_id  text not null check (char_length(message_id) between 1 and 100),
  reply       text,
  created_at  timestamptz not null,
  constraint processed_texts_pkey primary key (phone, message_id)
);
create index processed_texts_created on processed_texts (created_at);
