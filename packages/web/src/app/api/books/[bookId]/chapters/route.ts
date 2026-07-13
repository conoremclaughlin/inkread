import { NextResponse } from 'next/server';
import type { Chapter } from '@inkread/core';
import { asResponse, getRepository } from '@/lib/data';

type Params = { params: Promise<{ bookId: string }> };

/** Leading integer of a chapter title ("665 Episode 21 …" → 665). */
function leadingNumber(title: string): number | undefined {
  const match = /^(\d+)\b/.exec(title.trim());
  return match ? parseInt(match[1]!, 10) : undefined;
}

interface AddChaptersBody {
  chapters?: Chapter[];
  /**
   * 'end' (default): append. 'auto': place by the leading chapter number in
   * titles — right for serialized works whose chapters arrive out of order.
   * A number: explicit 0-based insertion index.
   */
  placement?: 'end' | 'auto' | number;
}

/** POST: add chapters to an existing book. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { bookId } = await params;
    const repository = await getRepository();
    const body = (await request.json()) as AddChaptersBody;
    if (!Array.isArray(body.chapters) || body.chapters.length === 0) {
      return NextResponse.json({ error: 'non-empty chapters array required' }, { status: 400 });
    }

    const placement = body.placement ?? 'end';
    if (placement === 'end') {
      return NextResponse.json(
        { book: await repository.appendChapters(bookId, body.chapters) },
        { status: 201 },
      );
    }

    let at: number;
    if (placement === 'auto') {
      const incoming = leadingNumber(body.chapters[0]!.title);
      if (incoming === undefined) {
        return NextResponse.json(
          { error: "placement 'auto' needs numeric chapter titles" },
          { status: 400 },
        );
      }
      const titles = await repository.getChapterTitles(bookId);
      at = titles.filter((title) => {
        const n = leadingNumber(title);
        return n !== undefined && n < incoming;
      }).length;
    } else {
      at = placement;
    }

    const book = await repository.insertChapters(bookId, body.chapters, at);
    return NextResponse.json({ book, at }, { status: 201 });
  } catch (error) {
    return asResponse(error);
  }
}
