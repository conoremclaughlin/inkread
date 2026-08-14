# The mobile reader

The reader is pure React Native. The WebView engine it replaced is gone — see
the Inkwell spec `ink://inkread/specs/native-reader` for the migration's history
and the research behind the decision.

## How it fits together

```
ReaderScreen            chrome + state: chapters, annotations, TTS, settings
  NativeReaderView      scroll mode
  NativePagedView       paged mode (core's paginate() over measured line boxes)
    readerRuns.tsx      one run → <Text>, tinted for highlight and/or TTS mark
      @inkread/core     segmentChapterRuns + applyMark
```

**The offset model is the contract.** A chapter's plain text is
`paragraphs.join('\n')`, and every annotation locator is a `[start, end)` range
in it. `segmentChapterRuns` (pure, in core, unit-tested) splits each paragraph
into runs at annotation boundaries; `applyMark` overlays the TTS read-along
sentence on top of those runs. The web reader consumes exactly the same
functions, so a highlight covers identical characters in both apps.

**Selection → offsets** comes from
[`@bsky.app/react-native-uitextview`](https://github.com/bluesky-social/react-native-uitextview),
which exposes a real `UITextView` selection as character offsets. That was the
one capability RN's own `<Text selectable>` couldn't provide, and the reason the
WebView survived as long as it did.

Native code lives in the pod, so a JS-only change reloads through Metro as
usual; adding or upgrading the module needs a rebuild (`yarn ios`).

## What the reader does

Scroll and paged reading · text selection → highlight (create, render, tap to
edit, recolour, note) · cross-selection extend for a passage spanning pages ·
TTS read-along with the spoken sentence tinted, following across chapter
auto-advance · reading-position persistence and restore · immersive chrome that
taps in and out · six themes with dark-aware highlight fills.

## Android

Untested. The selection module ships Android sources and core's logic is
platform-free, so the path is open — but nothing here has run on Android, and
the claim shouldn't be made until it has.
