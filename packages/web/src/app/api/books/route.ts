import { NextResponse } from 'next/server';
import type { Chapter } from '@inkread/core';
import { asResponse, getRepository } from '@/lib/data';

export async function GET() {
  try {
    const repository = await getRepository();
    return NextResponse.json({ books: await repository.listBooks() });
  } catch (error) {
    return asResponse(error);
  }
}

interface CreateBookBody {
  title?: string;
  author?: string;
  language?: string;
  source?: 'pdf' | 'epub' | 'text';
  chapters?: Chapter[];
}

export async function POST(request: Request) {
  try {
    const repository = await getRepository();
    const body = (await request.json()) as CreateBookBody;
    if (!body.title || !Array.isArray(body.chapters) || body.chapters.length === 0) {
      return NextResponse.json(
        { error: 'title and non-empty chapters are required' },
        { status: 400 },
      );
    }
    const book = await repository.createBook({
      title: body.title,
      author: body.author,
      language: body.language,
      source: body.source ?? 'pdf',
      chapters: body.chapters,
    });
    return NextResponse.json({ book }, { status: 201 });
  } catch (error) {
    return asResponse(error);
  }
}
