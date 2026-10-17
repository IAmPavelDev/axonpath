/**
 * Inline speech-language markers the lesson generator embeds in conspect
 * markdown: `[[lang:en]]Hello![[/lang]]`. Untagged text is the lesson's base
 * language; tagged spans route to a different speech engine/voice. Markers
 * are pure metadata — stripping them must not change the visible text, so
 * both the renderer and the speech plan consume the stripped form.
 */

export type LangSpan = {
  /** BCP-47-ish code from the marker (`en`, `uk`, `vi-VN`, …). */
  lang: string;
  /** Char range of the span's inner text in the STRIPPED string. */
  start: number;
  end: number;
};

const OPEN_RE = /\[\[lang:([a-zA-Z]{2,3}(?:-[a-zA-Z]{2,4})?)\]\]/y;
const CLOSE_RE = /\[\[\/lang\]\]/y;

/**
 * Removes every marker from `md` and reports where the tagged spans landed
 * in the stripped text. Unpaired or nested markers are dropped (never
 * spoken, never rendered); a span's inner text always survives.
 */
export const stripWithSpans = (md: string): { text: string; spans: LangSpan[] } => {
  let text = '';
  const spans: LangSpan[] = [];
  let i = 0;
  let open: { lang: string; start: number } | null = null;
  while (i < md.length) {
    OPEN_RE.lastIndex = i;
    const openM = OPEN_RE.exec(md);
    if (openM) {
      // A nested opening while one is open: drop the inner marker syntax.
      if (!open) open = { lang: openM[1], start: text.length };
      i = openM.index + openM[0].length;
      continue;
    }
    CLOSE_RE.lastIndex = i;
    const closeM = CLOSE_RE.exec(md);
    if (closeM) {
      if (open) {
        spans.push({ lang: open.lang, start: open.start, end: text.length });
        open = null;
      }
      i = closeM.index + closeM[0].length;
      continue;
    }
    text += md[i];
    i++;
  }
  return { text, spans };
};

export const stripLanguageMarkers = (md: string): string => stripWithSpans(md).text;
