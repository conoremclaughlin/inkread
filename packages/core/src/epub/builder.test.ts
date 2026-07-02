import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildEpub, escapeXml, type EpubInput } from './builder';

const INPUT: EpubInput = {
  title: 'Testing & Trials',
  author: 'A. Author <tester>',
  identifier: 'urn:uuid:test-0001',
  modified: '2026-07-03T00:00:00Z',
  chapters: [
    { title: 'Chapter One', paragraphs: ['First paragraph.', 'Second <b>paragraph</b> & more.'] },
    { title: 'Chapter Two', paragraphs: ['Only paragraph.'] },
  ],
};

describe('buildEpub', () => {
  it('puts an uncompressed mimetype entry first in the archive', () => {
    const bytes = buildEpub(INPUT);
    // Zip local file header: name starts at byte 30.
    const name = strFromU8(bytes.slice(30, 30 + 8));
    expect(name).toBe('mimetype');
    // Compression method (bytes 8-9 of the local header) must be 0 (stored).
    expect(bytes[8]).toBe(0);
    expect(bytes[9]).toBe(0);
    const files = unzipSync(bytes);
    expect(strFromU8(files['mimetype']!)).toBe('application/epub+zip');
  });

  it('contains the OCF container pointing at the package document', () => {
    const files = unzipSync(buildEpub(INPUT));
    const container = strFromU8(files['META-INF/container.xml']!);
    expect(container).toContain('full-path="OEBPS/content.opf"');
    expect(files['OEBPS/content.opf']).toBeDefined();
  });

  it('lists every chapter in manifest, spine, and nav', () => {
    const files = unzipSync(buildEpub(INPUT));
    const opf = strFromU8(files['OEBPS/content.opf']!);
    const nav = strFromU8(files['OEBPS/nav.xhtml']!);
    for (const i of [1, 2]) {
      expect(opf).toContain(`href="text/chapter-00${i}.xhtml"`);
      expect(opf).toContain(`<itemref idref="chapter-${i}"/>`);
      expect(files[`OEBPS/text/chapter-00${i}.xhtml`]).toBeDefined();
    }
    expect(nav).toContain('Chapter One');
    expect(nav).toContain('Chapter Two');
  });

  it('escapes metadata and body text', () => {
    const files = unzipSync(buildEpub(INPUT));
    const opf = strFromU8(files['OEBPS/content.opf']!);
    expect(opf).toContain('Testing &amp; Trials');
    expect(opf).toContain('A. Author &lt;tester&gt;');
    const chapter = strFromU8(files['OEBPS/text/chapter-001.xhtml']!);
    expect(chapter).toContain('Second &lt;b&gt;paragraph&lt;/b&gt; &amp; more.');
    expect(chapter).not.toContain('<b>');
  });

  it('is deterministic for identical input', () => {
    expect(Buffer.from(buildEpub(INPUT))).toEqual(Buffer.from(buildEpub(INPUT)));
  });

  it('rejects an empty book', () => {
    expect(() => buildEpub({ ...INPUT, chapters: [] })).toThrow();
  });
});

describe('escapeXml', () => {
  it('escapes the five XML special characters', () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;',
    );
  });
});
