-- Text/Markdown imports (e.g. Google Docs exports) are their own source kind.
alter table public.books drop constraint books_source_check;
alter table public.books add constraint books_source_check
  check (source in ('pdf', 'epub', 'text'));
