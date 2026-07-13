-- Kindle-style dual pointers: current position moves freely (including
-- backwards when re-reading); the furthest pointer is a high-water mark.
alter table public.reading_positions
  add column furthest_chapter_index integer not null default 0,
  add column furthest_offset integer not null default 0;

update public.reading_positions
  set furthest_chapter_index = chapter_index,
      furthest_offset = char_offset;
