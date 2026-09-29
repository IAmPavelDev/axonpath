/**
 * Splits a conspect markdown document into TOP-LEVEL chunks so Q&A blocks can
 * be interleaved between them. The chunk index is the client-defined
 * `anchorParagraph` space sent to `class.qa.ask` — the backend only stores the
 * number; consistency is entirely client-side, so this splitter is the single
 * source of that space.
 *
 * Rules:
 * - blank line separates chunks (outside fences);
 * - a ``` / ~~~ fence swallows everything (blank lines included) until its
 *   matching closing fence, forming one chunk;
 * - a heading starts its own chunk even without a preceding blank line;
 * - tables / lists are contiguous line runs separated by blank lines, so they
 *   naturally land in one chunk each;
 * - `---` is kept inside the current buffer (a non-blank buffer means it is a
 *   setext underline, not an hr).
 */
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

const FENCE_LINE = /^ {0,3}(```+|~~~+)\s*\w*\n?/;

/**
 * Plain-text preview of a chunk, used as the visual anchor (quote line) of the
 * QA cards and the composer context header. Deliberately forgiving: it strips
 * fence markers, headings, emphasis, links and images, then collapses
 * whitespace.
 */
export function chunkExcerpt(chunkMd: string, max = 160): string {
  let text = chunkMd
    .replace(FENCE_LINE, '')
    .replace(/^ {0,3}#{1,6}\s*/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length > max) text = `${text.slice(0, max - 1).trimEnd()}…`;
  return text;
}
