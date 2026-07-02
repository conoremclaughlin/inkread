import { useCallback, useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { File, Paths } from 'expo-file-system';
import type { PdfPage } from '@inkread/core';
import { buildExtractorHtml } from './extractorHtml';

export interface PdfMeta {
  pageCount: number;
  title?: string;
  author?: string;
}

export interface PdfExtractorProps {
  /** Base64 of the PDF to extract. Extraction starts as soon as the page is ready. */
  pdfBase64: string;
  onMeta?: (meta: PdfMeta) => void;
  onPage?: (page: PdfPage, meta: PdfMeta) => void;
  onDone: (pages: PdfPage[], meta: PdfMeta) => void;
  onError: (message: string) => void;
}

const CHUNK_SIZE = 256 * 1024;

/**
 * Headless extraction host: a zero-size WebView running the inlined pdf.js
 * page. The HTML is written to the cache directory once and loaded from a
 * file:// URL to keep the WebView source small and cacheable.
 */
export function PdfExtractor({ pdfBase64, onMeta, onPage, onDone, onError }: PdfExtractorProps) {
  const webviewRef = useRef<WebView>(null);
  const pagesRef = useRef<PdfPage[]>([]);
  const metaRef = useRef<PdfMeta>({ pageCount: 0 });
  const finishedRef = useRef(false);

  const htmlUri = useMemo(() => {
    const file = new File(Paths.cache, 'pdf-extractor.html');
    // Rewrite on every mount: cheap, and stale copies after an upgrade are worse.
    file.write(buildExtractorHtml());
    return file.uri;
  }, []);

  useEffect(() => {
    pagesRef.current = [];
    finishedRef.current = false;
  }, [pdfBase64]);

  const sendPdf = useCallback(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    for (let i = 0; i < pdfBase64.length; i += CHUNK_SIZE) {
      const chunk = pdfBase64.slice(i, i + CHUNK_SIZE);
      webview.injectJavaScript(`window.__inkread.addChunk("${chunk}");true;`);
    }
    webview.injectJavaScript('window.__inkread.finish();true;');
  }, [pdfBase64]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (finishedRef.current) return;
      let msg: { type: string; [key: string]: unknown };
      try {
        msg = JSON.parse(event.nativeEvent.data) as typeof msg;
      } catch {
        return;
      }
      switch (msg.type) {
        case 'ready':
          sendPdf();
          break;
        case 'meta': {
          metaRef.current = {
            pageCount: Number(msg.pageCount) || 0,
            title: typeof msg.title === 'string' ? msg.title : undefined,
            author: typeof msg.author === 'string' ? msg.author : undefined,
          };
          onMeta?.(metaRef.current);
          break;
        }
        case 'page': {
          const page = msg.page as unknown as PdfPage;
          pagesRef.current.push(page);
          onPage?.(page, metaRef.current);
          break;
        }
        case 'done':
          finishedRef.current = true;
          onDone(pagesRef.current, metaRef.current);
          break;
        case 'error':
          finishedRef.current = true;
          onError(String(msg.message ?? 'unknown extraction error'));
          break;
      }
    },
    [onDone, onError, onMeta, onPage, sendPdf],
  );

  return (
    <View style={{ width: 0, height: 0, overflow: 'hidden' }}>
      <WebView
        ref={webviewRef}
        source={{ uri: htmlUri }}
        originWhitelist={['*']}
        allowFileAccess
        allowingReadAccessToURL={Paths.cache.uri}
        javaScriptEnabled
        onMessage={handleMessage}
        onError={(e) => onError(`webview: ${e.nativeEvent.description}`)}
      />
    </View>
  );
}
