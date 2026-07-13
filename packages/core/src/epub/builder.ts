import { zipSync, strToU8, type Zippable } from 'fflate';
import type { Chapter } from '../models/types';

export interface EpubInput {
  title: string;
  author?: string;
  /** BCP 47 tag, defaults to 'en'. */
  language?: string;
  /** Stable unique id (used as dc:identifier). Required so output is deterministic. */
  identifier: string;
  /** ISO 8601 timestamp for dcterms:modified. Required for determinism. */
  modified: string;
  chapters: Chapter[];
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

const STYLESHEET = `html { font-size: 100%; }
body {
  font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
  line-height: 1.6;
  margin: 0 auto;
  padding: 0 1em;
  text-rendering: optimizeLegibility;
}
h1 { font-size: 1.5em; line-height: 1.25; margin: 2em 0 1em; }
p { margin: 0 0 0.9em; text-align: justify; hyphens: auto; }
`;

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function chapterFileName(index: number): string {
  return `text/chapter-${String(index + 1).padStart(3, '0')}.xhtml`;
}

function chapterXhtml(chapter: Chapter, language: string): string {
  const title = escapeXml(chapter.title);
  const body = chapter.paragraphs
    .map((p) => `    <p>${escapeXml(p)}</p>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(language)}">
  <head>
    <title>${title}</title>
    <link rel="stylesheet" type="text/css" href="../styles/style.css"/>
  </head>
  <body>
    <h1>${title}</h1>
${body}
  </body>
</html>
`;
}

function navXhtml(chapters: Chapter[], language: string): string {
  const items = chapters
    .map(
      (c, i) =>
        `        <li><a href="${chapterFileName(i)}">${escapeXml(c.title)}</a></li>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(language)}">
  <head>
    <title>Table of Contents</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Table of Contents</h1>
      <ol>
${items}
      </ol>
    </nav>
  </body>
</html>
`;
}

function contentOpf(input: EpubInput, language: string): string {
  const manifestItems = input.chapters
    .map(
      (_, i) =>
        `    <item id="chapter-${i + 1}" href="${chapterFileName(i)}" media-type="application/xhtml+xml"/>`,
    )
    .join('\n');
  const spineItems = input.chapters
    .map((_, i) => `    <itemref idref="chapter-${i + 1}"/>`)
    .join('\n');
  const author = input.author
    ? `    <dc:creator id="creator">${escapeXml(input.author)}</dc:creator>\n`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${escapeXml(language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${escapeXml(input.identifier)}</dc:identifier>
    <dc:title>${escapeXml(input.title)}</dc:title>
    <dc:language>${escapeXml(language)}</dc:language>
${author}    <meta property="dcterms:modified">${escapeXml(input.modified)}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="styles/style.css" media-type="text/css"/>
${manifestItems}
  </manifest>
  <spine>
${spineItems}
  </spine>
</package>
`;
}

/**
 * Assemble a valid EPUB 3 file from structured chapters.
 *
 * The zip is built with the `mimetype` entry first and uncompressed, as the
 * OCF spec requires. Output is deterministic for a given input.
 */
export function buildEpub(input: EpubInput): Uint8Array {
  if (input.chapters.length === 0) {
    throw new Error('buildEpub: at least one chapter is required');
  }
  const language = input.language ?? 'en';

  const files: Zippable = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(CONTAINER_XML),
    'OEBPS/content.opf': strToU8(contentOpf(input, language)),
    'OEBPS/nav.xhtml': strToU8(navXhtml(input.chapters, language)),
    'OEBPS/styles/style.css': strToU8(STYLESHEET),
  };
  input.chapters.forEach((chapter, i) => {
    files[`OEBPS/${chapterFileName(i)}`] = strToU8(chapterXhtml(chapter, language));
  });

  // Fixed mtime keeps byte-identical output for identical input. Zip
  // timestamps are local-time and can't be earlier than 1980, so use a
  // local-time constructor — a UTC midnight would be 1979 west of Greenwich.
  return zipSync(files, { mtime: new Date(1980, 5, 1) });
}
