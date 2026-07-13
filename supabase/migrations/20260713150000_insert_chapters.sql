-- Ordered chapter insertion: shifts existing chapters, annotation anchors,
-- and reading positions at/after the insertion point, then inserts the new
-- chapters — atomically, so a failure can't strand a half-shifted book.
-- SECURITY INVOKER (default): RLS on the underlying tables still applies.
create or replace function public.insert_chapters(
  p_book_id uuid,
  p_at integer,
  p_chapters jsonb
) returns void
language plpgsql as $$
declare
  n integer := jsonb_array_length(p_chapters);
begin
  if n is null or n = 0 then
    raise exception 'insert_chapters: empty chapter list';
  end if;

  -- Two-step index shift keeps the (book_id, chapter_index) PK collision-free.
  update public.chapters
    set chapter_index = chapter_index + 1000000 + n
    where book_id = p_book_id and chapter_index >= p_at;
  update public.chapters
    set chapter_index = chapter_index - 1000000
    where book_id = p_book_id and chapter_index >= 1000000;

  insert into public.chapters (book_id, user_id, chapter_index, title, paragraphs, source_pages)
  select
    p_book_id,
    auth.uid(),
    p_at + (element.ord - 1)::integer,
    coalesce(element.value->>'title', 'Chapter'),
    coalesce(element.value->'paragraphs', '[]'::jsonb),
    element.value->'sourcePages'
  from jsonb_array_elements(p_chapters) with ordinality as element(value, ord);

  update public.annotations
    set chapter_index = chapter_index + n
    where book_id = p_book_id and chapter_index >= p_at;

  update public.reading_positions
    set chapter_index = chapter_index + n
    where book_id = p_book_id and chapter_index >= p_at;

  update public.books
    set chapter_count = chapter_count + n
    where id = p_book_id;
end
$$;
