import type { BookVisibility, PublicationStatus } from '../models/types';

/**
 * Publishing + social-ranking helpers, kept pure so both the web server (SSR
 * discovery pages) and any future client share one definition of "actively
 * published" and one comment sort order.
 */

/** What the public home features: a public work that is still being written. */
export function isActivelyPublished(book: {
  visibility?: BookVisibility;
  status?: PublicationStatus;
}): boolean {
  return book.visibility === 'public' && book.status === 'ongoing';
}

/** A thing that can be ranked in a discussion: has a score and a creation time. */
export interface Rankable {
  score?: number;
  createdAt: string;
}

/**
 * Order a discussion the way readers expect: highest net score first, and among
 * equal scores the newer comment first. Pure and stable (returns a new array;
 * ISO `createdAt` strings compare chronologically). Missing scores count as 0.
 */
export function rankByScore<T extends Rankable>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0) || b.createdAt.localeCompare(a.createdAt),
  );
}
