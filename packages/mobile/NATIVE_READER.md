# Native reader migration

The plan of record lives in Inkwell (the source of truth), not here:

**`ink://inkread/specs/native-reader`** — inkread project spec.

Short version: we're moving the mobile reader off `react-native-webview` to pure
React Native. Text flow/pagination was never the blocker (RN `<Text>` + core's
`paginate()` handle it); the only gap was turning a selection gesture into
`[start,end)` character offsets. We adopted **`@bsky.app/react-native-uitextview`**
(native iOS selection → real offsets, New-Arch/RN 0.86), validated on-device, and
shipped a scroll-mode native reader behind the **Aa › Reader · beta** toggle
(`readerEngine: 'webview' | 'native'`). Highlights render via nested runs from the
shared `@inkread/core` `segmentChapterRuns`.

Still on the WebView until parity lands: paged mode, cross-page extend, TTS
sentence marks, precise position persistence. See the Inkwell spec for the phased
plan and the research behind the decision.
