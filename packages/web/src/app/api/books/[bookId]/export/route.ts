import { NextResponse } from 'next/server';
import { buildEpub, exportAnnotationsMarkdown } from '@inkread/core';
import { asResponse, getRepository } from '@/lib/data';

type Params = { params: Promise<{ bookId: string }> };

function fileName(title: string, extension: string): string {
  const safe = title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'book';
  return `${safe}.${extension}`;
}

/**
 * GET /api/books/:id/export?format=markdown — notes/highlights as Markdown
 * GET /api/books/:id/export?format=epub — the book as an EPUB 3 file
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const { bookId } = await params;
    const repository = await getRepository();
    const book = await repository.getBook(bookId);
    if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const format = new URL(request.url).searchParams.get('format') ?? 'markdown';

    if (format === 'epub') {
      const chapters = await repository.getChapters(bookId);
      if (!chapters || chapters.length === 0) {
        return NextResponse.json({ error: 'Book has no content' }, { status: 404 });
      }
      const epub = buildEpub({
        title: book.title,
        author: book.author,
        language: book.language,
        identifier: `urn:inkread:${book.id}`,
        modified: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        chapters,
      });
      return new NextResponse(Buffer.from(epub), {
        headers: {
          'Content-Type': 'application/epub+zip',
          'Content-Disposition': `attachment; filename="${fileName(book.title, 'epub')}"`,
        },
      });
    }

    const annotations = await repository.listAnnotations(bookId);
    const markdown = exportAnnotationsMarkdown(book, annotations);
    return new NextResponse(markdown, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName(book.title, 'md')}"`,
      },
    });
  } catch (error) {
    return asResponse(error);
  }
}
