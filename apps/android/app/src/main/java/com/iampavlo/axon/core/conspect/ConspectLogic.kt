package com.iampavlo.axon.core.conspect

/**
 * Port of RN lib/conspect-chunks.ts + lib/conspect-speech/inline-md.ts (pure
 * logic, unit-tested on the RN side — invariants replicated in app tests).
 *
 * Chunk index here is the client-defined `anchorParagraph` space that QA
 * blocks and video clips anchor to; the backend stores only the number.
 */

private val FENCE_RUN = Regex("^ {0,3}(`{3,}|~{3,})")
internal val HEADING = Regex("^ {0,3}#{1,6}(\\s|$)")
internal val HR = Regex("^ {0,3}(-{3,}|\\*{3,}|_{3,})\\s*$")
internal val LIST_ITEM = Regex("^ {0,3}([-*+]|\\d{1,9}[.)])(\\s+|$)")
internal val TABLE_ROW = Regex("^ {0,3}\\|.*\\|\\s*$")
internal val TABLE_SEPARATOR = Regex("^ {0,3}\\|?\\s*:?-{2,}:?\\s*(\\|\\s*:?-{2,}:?\\s*)*\\|?\\s*$")

private fun fenceRun(line: String): String =
    FENCE_RUN.find(line)?.groupValues?.get(1) ?: ""

/** Blank-line splits outside fences; fences swallow everything; headings force splits. */
fun splitConspectChunks(md: String): List<String> {
    val chunks = mutableListOf<String>()
    val buf = StringBuilder()

    fun flush() {
        val trimmed = buf.toString().trim()
        if (trimmed.isNotEmpty()) chunks += trimmed
        buf.setLength(0)
    }

    var fence: String? = null
    for (line in md.split('\n')) {
        val run = fenceRun(line)
        if (fence == null) {
            if (run.isNotEmpty()) {
                fence = run
                buf.append(line).append('\n')
                continue
            }
            if (line.isBlank()) {
                flush()
                continue
            }
            if (line.contains(HEADING)) {
                flush()
                buf.append(line).append('\n')
                continue
            }
            buf.append(line).append('\n')
        } else {
            buf.append(line).append('\n')
            if (run.isNotEmpty() && line.trimStart().startsWith(fence) && run.length >= fence.length) {
                fence = null
            }
        }
    }
    flush()
    return chunks
}

/** RN chunkExcerpt: strips markdown to plain text, collapses whitespace, ≤ max chars. */
fun chunkExcerpt(chunkMd: String, max: Int = 160): String {
    var text = chunkMd
        .split('\n')
        .joinToString("\n") { line ->
            when {
                Regex("^ {0,3}(`{3,}|~{3,})").containsMatchIn(line) -> ""
                line.contains(HEADING) -> line.replace(Regex("^ {0,3}#{1,6}\\s*"), "")
                else -> line
            }
        }
    text = text
        .replace(Regex("!\\[([^\\]]*)]\\([^)]*\\)"), "$1") // images → alt
        .replace(Regex("\\[([^\\]]*)]\\([^)]*\\)"), "$1") // links → label
        .replace(Regex("[*_~`>#]+"), "")
        .replace(Regex("\\s+"), " ")
        .trim()
    return if (text.length <= max) text else text.take(max - 1) + "…"
}

enum class InlineStyle { STRONG, EM, CODE, LINK }

data class InlineSegment(val text: String, val style: InlineStyle?)

private data class MarkerPair(
    /** Char spans that never render (markers, link URLs). */
    val dropSpans: List<IntRange>,
    /** Char span that renders with [style]. */
    val styled: IntRange,
    val style: InlineStyle?,
)

private val ESCAPABLE = "\\*`_~[]".toSet()

/**
 * RN parseInlineSegments: markers and link URLs never render; styled ranges
 * take the innermost enclosing marker; backslash-escaped chars render literal
 * with the backslash dropped; unmatched markers stay literal.
 */
private data class InlineCell(val from: Int, val to: Int, val style: InlineStyle?)

/** Cell decomposition (source-space, dropped ranges removed) shared by
 *  [parseInlineSegments] and [visibleInlineSpans]. */
private fun inlineCells(md: String): List<InlineCell> {
    val pairs = mutableListOf<MarkerPair>()
    var i = 0
    val n = md.length

    fun findClosing(from: Int, marker: String): Int {
        var j = from
        while (true) {
            j = md.indexOf(marker, j)
            if (j < 0) return -1
            if (j > 0 && md[j - 1] == '\\') {
                j += marker.length
                continue
            }
            return j
        }
    }

    while (i < n) {
        val c = md[i]
        when {
            c == '\\' && i + 1 < n && md[i + 1] in ESCAPABLE -> {
                pairs += MarkerPair(listOf(i..i), i + 1..i + 1, null)
                i += 2
            }
            c == '`' -> {
                val close = findClosing(i + 1, "`")
                if (close > i + 1) {
                    pairs += MarkerPair(listOf(i..i, close..close), i + 1 until close, InlineStyle.CODE)
                    i += 1
                } else i++
            }
            md.startsWith("**", i) -> {
                val close = findClosing(i + 2, "**")
                if (close > i + 2) {
                    pairs += MarkerPair(listOf(i..i + 1, close..close + 1), i + 2 until close, InlineStyle.STRONG)
                    i += 2
                } else i += 2
            }
            c == '*' -> {
                val close = findClosing(i + 1, "*")
                if (close > i + 1 && md.getOrNull(i + 1) != ' ') {
                    pairs += MarkerPair(listOf(i..i, close..close), i + 1 until close, InlineStyle.EM)
                    i += 1
                } else i++
            }
            c == '[' -> {
                val closeBracket = md.indexOf(']', i)
                if (closeBracket > 0 && closeBracket + 1 < n && md[closeBracket + 1] == '(') {
                    val closeParen = md.indexOf(')', closeBracket + 2)
                    if (closeParen > closeBracket + 1) {
                        pairs += MarkerPair(
                            dropSpans = listOf(i..i, closeBracket..closeParen),
                            styled = i + 1 until closeBracket,
                            style = InlineStyle.LINK,
                        )
                        i += 1
                    } else i++
                } else i++
            }
            else -> i++
        }
    }

    // Boundary set: 0, n and every drop/style edge. Cells inside drop spans
    // never render; everything else takes the innermost enclosing style.
    val edges = sortedSetOf(0, n)
    for (p in pairs) {
        for (span in p.dropSpans) {
            edges += span.first
            edges += span.last + 1
        }
        edges += p.styled.first
        edges += p.styled.last + 1
    }

    val cells = mutableListOf<InlineCell>()
    val list = edges.toList()
    for (idx in 0 until list.size - 1) {
        val from = list[idx]
        val to = list[idx + 1]
        if (from >= to) continue
        val dropped = pairs.any { p -> p.dropSpans.any { span -> from >= span.first && to <= span.last + 1 } }
        if (dropped) continue
        val style = pairs
            .filter { p -> from >= p.styled.first && to <= p.styled.last + 1 }
            .minByOrNull { p -> p.styled.last - p.styled.first }
            ?.style
        cells += InlineCell(from, to, style)
    }
    return cells
}

fun parseInlineSegments(md: String): List<InlineSegment> {
    val out = mutableListOf<InlineSegment>()
    for (cell in inlineCells(md)) {
        val text = md.substring(cell.from, cell.to)
        val last = out.lastOrNull()
        if (last != null && last.style == cell.style) {
            out[out.lastIndex] = InlineSegment(last.text + text, last.style)
        } else {
            out += InlineSegment(text, cell.style)
        }
    }
    return out
}

/**
 * Visible source spans of [md] in render order: the plain text produced by
 * [parseInlineSegments] is exactly the concatenation of these substrings
 * (markers, link URLs and escape backslashes dropped). Lets hit-testing map
 * a rendered-text offset back to its source offset.
 */
fun visibleInlineSpans(md: String): List<IntRange> =
    inlineCells(md).map { it.from until it.to }

/**
 * Sentence bounds [start, endExclusive) in [text] around [offset]: nearest
 * terminator (`.!?…`) followed by whitespace or end-of-text before and after.
 * Expands a long-pressed word to its sentence for the selection Ask-AI flow.
 */
fun sentenceRangeAt(text: String, offset: Int): IntRange {
    val at = offset.coerceIn(0, text.length)
    var start = 0
    for (i in at - 1 downTo 0) {
        if (text[i] in ".!?…" && (i + 1 >= text.length || text[i + 1].isWhitespace())) {
            start = i + 1
            break
        }
    }
    var end = text.length
    for (j in at until text.length) {
        if (text[j] in ".!?…" && (j + 1 >= text.length || text[j + 1].isWhitespace())) {
            end = j + 1
            break
        }
    }
    return start until end
}

/** The exact text the speech plan + renderer consume: [[lang:xx]] markers stripped. */
fun stripLanguageMarkers(md: String): String =
    md.replace(Regex("\\[\\[lang:[a-zA-Z]{2,3}(?:-[a-zA-Z]{2,4})?]]"), "")
        .replace(Regex("\\[\\[/lang]]"), "")

/** RN stripLeadingH1: drops a leading single-# H1 + trailing newlines (## survives). */
fun stripLeadingH1(md: String): String =
    md.replace(Regex("^#(\\s)[^\\n]*\\n+"), "")
        .replace(Regex("^#\\n+"), "")
