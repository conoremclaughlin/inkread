import Link from 'next/link';
import type { PublicSeries } from '@/lib/data/public';
import { coverInitials, coverPalette } from '@/lib/cover';
import { relativeTime } from '@/lib/relativeTime';

/** A discovery card for one public series: cover, title, status, and pulse. */
export function SeriesCard({ series }: { series: PublicSeries }) {
  const palette = coverPalette(series.title);
  return (
    <Link
      href={`/series/${series.id}`}
      className="group flex gap-4 rounded-2xl border border-[#e6dfd4] bg-white p-4 transition hover:-translate-y-0.5 hover:border-[#d9cdbb] hover:shadow-[0_8px_24px_-12px_rgba(38,34,28,0.25)]"
    >
      <div
        className="flex h-24 w-16 shrink-0 items-center justify-center rounded-md font-serif text-lg shadow-inner"
        style={{ backgroundColor: palette.bg, color: palette.fg }}
        aria-hidden
      >
        {coverInitials(series.title)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-[#eef4ee] px-2 py-0.5 text-[11px] font-medium text-[#4a5d4e]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#4a5d4e]" />
            {series.status === 'completed' ? 'Completed' : 'Ongoing'}
          </span>
        </div>
        <h3 className="mt-1.5 truncate font-serif text-lg leading-snug text-[#26221c]">
          {series.title}
        </h3>
        {series.author ? (
          <p className="truncate text-sm text-[#6b6459]">{series.author}</p>
        ) : null}
        <p className="mt-2 text-xs text-[#8a8175]">
          {series.chapterCount} chapter{series.chapterCount === 1 ? '' : 's'}
          {' · updated '}
          {relativeTime(series.updatedAt)}
          {series.commentCount > 0
            ? ` · ${series.commentCount} comment${series.commentCount === 1 ? '' : 's'}`
            : ''}
        </p>
        {series.coinsPerChapter > 0 ? (
          <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[#b08a5e]">
            <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
              <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <circle cx="6" cy="6" r="2" fill="currentColor" />
            </svg>
            {series.freeChapterCount > 0
              ? `${series.freeChapterCount} free · ${series.coinsPerChapter}/ch`
              : `${series.coinsPerChapter} coins/ch`}
          </p>
        ) : null}
      </div>
    </Link>
  );
}
