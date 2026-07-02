import { PDFJS_SRC, PDFJS_WORKER_SRC } from './pdfjsEmbedded';

/**
 * The extraction page that runs inside a hidden WKWebView.
 *
 * Protocol (JSON messages over window.ReactNativeWebView.postMessage):
 *   page → RN:  {type:'ready'} once pdf.js is loaded
 *   RN → page:  window.__inkread.addChunk(base64Slice) repeated, then
 *               window.__inkread.finish()
 *   page → RN:  {type:'meta', pageCount, title?, author?}
 *               {type:'page', page: {pageNumber,width,height,items:[...]}} per page
 *               {type:'done'} | {type:'error', message}
 *
 * pdf.js and its worker are inlined as blob-URL modules so the page works
 * fully offline with no bundler asset plumbing.
 */
export function buildExtractorHtml(): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body>
<script>
  const post = (msg) => window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  window.onerror = (m, s, l) => { post({ type: 'error', message: String(m) + ' @' + l }); };
</script>
<script type="module">
  const post = (msg) => window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  try {
    const workerSrc = ${JSON.stringify(PDFJS_WORKER_SRC)};
    const pdfSrc = ${JSON.stringify(PDFJS_SRC)};
    const pdfUrl = URL.createObjectURL(new Blob([pdfSrc], { type: 'text/javascript' }));
    const workerUrl = URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' }));
    const pdfjs = await import(pdfUrl);
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

    const chunks = [];
    window.__inkread = {
      addChunk(b64) { chunks.push(b64); },
      finish() { run().catch((e) => post({ type: 'error', message: String(e && e.message || e) })); },
    };

    function decodeBase64(b64) {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }

    async function run() {
      const b64 = chunks.join('');
      chunks.length = 0;
      const data = decodeBase64(b64);
      const doc = await pdfjs.getDocument({ data }).promise;
      let title, author;
      try {
        const meta = await doc.getMetadata();
        title = meta.info && meta.info.Title || undefined;
        author = meta.info && meta.info.Author || undefined;
      } catch (e) { /* metadata is optional */ }
      post({ type: 'meta', pageCount: doc.numPages, title, author });

      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const items = [];
        for (const it of content.items) {
          if (typeof it.str !== 'string' || it.str.length === 0) continue;
          const t = it.transform;
          const fontSize = Math.round(Math.hypot(t[2], t[3]) * 100) / 100 ||
            Math.round((it.height || 12) * 100) / 100;
          items.push({
            text: it.str,
            x: Math.round(t[4] * 100) / 100,
            y: Math.round(t[5] * 100) / 100,
            fontSize,
            width: Math.round((it.width || 0) * 100) / 100,
            fontName: it.fontName,
          });
        }
        post({
          type: 'page',
          page: { pageNumber: n, width: viewport.width, height: viewport.height, items },
        });
        page.cleanup();
      }
      await doc.destroy();
      post({ type: 'done' });
    }

    post({ type: 'ready' });
  } catch (e) {
    post({ type: 'error', message: 'init: ' + String(e && e.message || e) });
  }
</script>
</body>
</html>`;
}
