import { UITextView } from '@bsky.app/react-native-uitextview';
import { HIGHLIGHT_COLORS, type MarkedRun } from '@inkread/core';

/**
 * Read-along tint for the sentence TTS is currently speaking. Matches the web /
 * WebView reader's `.tts-mark` background so the follow-along cursor looks the
 * same on every engine.
 */
export const TTS_MARK_FILL = 'rgba(120, 170, 255, 0.35)';

/** Highlight colour name → rgba fill at the active theme's opacity. */
export function highlightFill(color: string, alpha: number): string {
  const rgb = HIGHLIGHT_COLORS[color] ?? HIGHLIGHT_COLORS.yellow!;
  return `rgba(${rgb}, ${alpha})`;
}

export interface RenderRunOptions {
  highlightAlpha: number;
  onTapHighlight: (id: string) => void;
}

/**
 * Render one segmented run as a child of a selectable UITextView. A run may
 * carry a highlight annotation, the transient TTS sentence mark, both, or
 * neither:
 *  - both → the mark nests inside the highlight so its semi-transparent tint
 *    layers over the highlight colour (same stacking as the WebView's spans);
 *  - highlight only → tappable coloured run;
 *  - mark only → the read-along tint;
 *  - neither → a bare string, the cheapest possible text node.
 */
export function renderRun(run: MarkedRun, key: string, opts: RenderRunOptions) {
  const { annotation, marked } = run;
  if (annotation) {
    return (
      <UITextView
        key={key}
        style={{ backgroundColor: highlightFill(annotation.color, opts.highlightAlpha) }}
        onPress={() => opts.onTapHighlight(annotation.id)}
      >
        {marked ? (
          <UITextView style={{ backgroundColor: TTS_MARK_FILL }}>{run.text}</UITextView>
        ) : (
          run.text
        )}
      </UITextView>
    );
  }
  if (marked) {
    return (
      <UITextView key={key} style={{ backgroundColor: TTS_MARK_FILL }}>
        {run.text}
      </UITextView>
    );
  }
  return run.text;
}
