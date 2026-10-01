/**
 * Backend port of the client's conspect splitter
 * (`apps/mobile/lib/conspect-chunks.ts`): the anchor *index* space stays
 * client-owned, but the backend needs the same block boundaries to resolve
 * anchor passages for QA prompts (L1 fallback + L3 excerpts) and to embed a
 * class's content as CONTENT_CHUNK vectors. Duplication is deliberate — the
 * contract package is wire-only, and snippet text is self-contained, so
 * boundary drift between client and backend versions is harmless.
 *
 * Splits markdown into TOP-LEVEL blocks:
 * - blank line separates blocks (outside fences);
 * - a ``` / ~~~ fence swallows everything (blank lines included) until its
 *   matching closing fence, forming one block;
 * - a heading starts its own block even without a preceding blank line;
 * - tables / lists are contiguous line runs separated by blank lines.
 */

/** Plain-text excerpt of a block, truncated to `max` chars (…-suffixed). */
export const conspectExcerpt = (chunkMd: string, max: number): string => {
  let text = chunkMd
    .replace(/^ {0,3}(```+|~~~+)\s*\w*\n?/, '')
    .replace(/^ {0,3}#{1,6}\s*/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length > max) text = `${text.slice(0, max - 1).trimEnd()}…`;
  return text;
};

export function splitConspectChunks(md: string): string[] {
  const lines = md.split('\n');
  const chunks: string[] = [];
  let buf: string[] = [];
  /** Opening fence marker ('```' | '~~~') while inside one, else null. */
  let fence: { char: string; len: number } | null = null;

  const flush = () => {
    const joined = buf.join('\n').trim();
    buf = [];
    if (joined) chunks.push(joined);
  };

  const openingFence = (line: string) => {
    const m = /^ {0,3}(```+|~~~+)/.exec(line);
    return m ? { char: m[1][0], len: m[1].length } : null;
  };
  const closingFence = (line: string, open: { char: string; len: number }) =>
    new RegExp(`^ {0,3}\\${open.char}{${open.len},}\\s*$`).test(line);

  for (const line of lines) {
    if (fence) {
      buf.push(line);
      if (closingFence(line, fence)) {
        fence = null;
        flush(); // the fence chunk ends at its closing fence
      }
      continue;
    }

    const open = openingFence(line);
    if (open) {
      flush();
      fence = open;
      buf.push(line);
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    // A heading always starts a fresh top-level block, even in loose markdown
    // where it follows a paragraph without a blank line.
    if (/^ {0,3}#{1,6}(\s|$)/.test(line)) flush();

    buf.push(line);
  }
  flush(); // unterminated fence or trailing block

  return chunks;
}
