import type { SqlDriver } from './driver';

/**
 * The client cache schema — deliberately simpler than the server's: no RLS
 * (single-user device), no triggers, jsonb flattened to TEXT. The server
 * remains the source of truth; this holds what a device needs to read
 * offline plus sync bookkeeping.
 */
export const SCHEMA_VERSION = 2;

const DDL = `
create table if not exists meta (
  key text primary key,
  value text not null
);

create table if not exists books (
  id text primary key,
  title text not null,
  author text,
  language text not null default 'en',
  source text not null default 'pdf',
  chapter_count integer not null default 0,
  created_at text not null,
  updated_at text not null
);

create table if not exists chapters (
  book_id text not null,
  chapter_index integer not null,
  title text not null,
  paragraphs_json text not null,
  primary key (book_id, chapter_index)
);

create table if not exists annotations (
  id text primary key,
  book_id text not null,
  kind text not null,
  chapter_index integer not null,
  start_offset integer not null,
  end_offset integer not null,
  passage text not null,
  note text,
  color text not null,
  chapter_title text,
  created_at text not null
);
create index if not exists annotations_book_idx
  on annotations (book_id, chapter_index, start_offset);

create table if not exists positions (
  book_id text primary key,
  chapter_index integer not null,
  char_offset integer not null,
  furthest_chapter_index integer not null default 0,
  furthest_offset integer not null default 0,
  updated_at text not null
);
`;

export async function initSchema(driver: SqlDriver): Promise<void> {
  await driver.exec(DDL);
  const row = await driver.get<{ value: string }>(
    `select value from meta where key = 'schema_version'`,
  );
  const from = row ? parseInt(row.value, 10) : SCHEMA_VERSION;
  if (from < 2) {
    // v2: dual reading pointers (furthest-read high-water mark).
    await driver.run('alter table positions add column furthest_chapter_index integer not null default 0');
    await driver.run('alter table positions add column furthest_offset integer not null default 0');
    await driver.run('update positions set furthest_chapter_index = chapter_index, furthest_offset = char_offset');
  }
  await driver.run(
    `insert into meta (key, value) values ('schema_version', ?)
     on conflict (key) do update set value = excluded.value`,
    [String(SCHEMA_VERSION)],
  );
}
