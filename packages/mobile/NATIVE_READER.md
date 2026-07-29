# Native reader migration

Goal: replace the `react-native-webview` reader with pure React Native so paging
and scrolling run on the UI thread — a real win on Android especially, and the
right foundation for gestures and offline. This doc is the plan of record; it's
honest about what's done, what's left, and the one piece that genuinely needs a
native module.

## Why migrate

The WebView reader works (selection, cross-page highlight extend, TTS sentence
sync all function today), but it carries the WebView's costs: JS-thread paging,
a bridge round-trip for every selection/scroll event, awkward safe-area/overlay
interplay (the source of the three chrome bugs fixed in #24), and weaker Android
performance. Native `<Text>` renders on the UI thread and composes with native
gesture/animation.

## What the two readers must agree on

Both engines render the **same offset model**: a chapter's plain text is
`paragraphs.join('\n')`, and every annotation locator is a `[start, end)` range
in that text. `@inkread/core`'s `segmentChapterRuns(paragraphs, annotations)`
(pure, unit-tested — `packages/core/src/reader/runs.ts`) splits each paragraph
into runs at annotation boundaries. The WebView turns runs into `<span>`s; the
native reader turns them into nested `<Text>` children. One source of truth, so
a highlight lands on identical characters whichever engine draws it.

## Status

| Capability | WebView | Native | Notes |
|---|---|---|---|
| Reflowable text + theming | ✅ | ✅ | `NativeReader.tsx` |
| Pagination (measure → pages) | ✅ | ✅ | pure `paginate()` (tested) over `<Text onTextLayout>` line boxes |
| Highlight **rendering** | ✅ | ✅ | shared `segmentChapterRuns` → nested `<Text>` |
| Tap-to-toggle chrome / edge-tap paging | ✅ | ✅ | edge zones in `NativeReader` |
| Smooth finger-drag page turn | ✅ | ⬜ | needs Reanimated gesture (translate follows thumb, springs on release) |
| Text **selection → offsets** | ✅ | ⬜ | **the blocker — needs a native module (below)** |
| Cross-page highlight *extend* | ✅ | ⬜ | trivial once selection lands (tap start → turn pages → tap end, both offsets) |
| Tap a highlight to edit | ✅ | ⬜ | hit-test tap point → offset → annotation |
| TTS sentence sync (mark current line) | ✅ | ⬜ | offset → line via measured boxes; no selection needed |
| Reading-position persistence | ✅ | ⬜ | top-of-viewport line → offset |

## The blocker: native text selection

RN's `<Text selectable>` gives the OS Copy/Look-Up/Share menu but **not** the
selected character range — and highlight creation, extend, and tap-to-edit all
need offsets. The WebView gets them for free (`caretRangeFromPoint`, the
Selection API). To match that natively on iOS we need a small **Expo native
module** wrapping a `UITextView` (TextKit), exposing:

```ts
// selection reported as offsets into paragraphs.join('\n')
onSelectionChange: (e: { start: number; end: number; text: string }) => void
// map a tap point to an offset (for tap-to-edit and extend end-point)
offsetAtPoint(x: number, y: number): Promise<number | null>
```

Implementation sketch (iOS): render the chapter into an `NSAttributedString`,
host it in a non-editable `UITextView`; on `textViewDidChangeSelection` convert
`selectedRange` (an `NSRange` over the attributed string, which we build to match
the `join('\n')` offset model) and emit it. `offsetAtPoint` uses
`layoutManager.characterIndex(for:in:)`. Android later: a `TextView` +
`Spannable` + `getOffsetForPosition`.

This is the one part that can't be prototyped in JS. It's buildable and
verifiable here (the `ios/` project compiles headlessly), but adding it means
either an `expo prebuild` regen or hand-wiring the module into the Xcode
project + `pod install` — a device-side native step best done deliberately, not
folded into an autonomous pass. **Recommended next milestone.**

## Phasing

1. **✅ Foundation (this PR, #TBD)** — shared `segmentChapterRuns` (+ tests),
   `NativeReader` renders paginated text **with highlights**, tap zones for
   chrome + paging. Not wired into `ReaderScreen` (kept standalone) so the
   shipped WebView reader is untouched.
2. **Native selection module** — the TextKit module above; unblocks highlight
   create / extend / tap-to-edit. Wire `NativeReader` selection → the existing
   `ReaderScreen` selection bar (which is already engine-agnostic UI).
3. **Gesture + polish** — Reanimated finger-drag turn, TTS sentence mark,
   position persistence. Put `readerEngine: 'webview' | 'native'` behind a
   settings toggle; dogfood native; flip the default once at parity.
4. **Retire the WebView** — delete `buildReaderHtml`'s mobile bridge once native
   is the default on both platforms. (`buildReaderHtml` stays for web, which
   renders it in an iframe.)

## Why it's not wired in yet

A native reader that can't *create* highlights is a regression, not a preview —
so it stays standalone until step 2. Merging the foundation keeps the shared
segmentation tested and in use (the WebView already consumes it), so phase 2
starts from a proven base rather than a stale prototype.
