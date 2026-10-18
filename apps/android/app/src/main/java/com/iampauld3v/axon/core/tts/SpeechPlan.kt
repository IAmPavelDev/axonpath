package com.iampauld3v.axon.core.tts

import com.iampauld3v.axon.core.conspect.HR
import com.iampauld3v.axon.core.conspect.TABLE_SEPARATOR
import com.iampauld3v.axon.core.conspect.stripLeadingH1

/**
 * Coordinate spaces:
 *  - chunk text  = the lang-marker-stripped lesson markdown (what renders)
 *  - chunk.text  = speakable tokens joined with single spaces (what TTS reads)
 *  - word ranges [chunkStart, chunkEnd) point into the CHUNK TEXT space so the
 *    renderer can highlight the exact surface form.
 */

data class SpeechWord(
    val chunk: Int,
    val chunkStart: Int,
    val chunkEnd: Int,
)

data class SpeechChunk(
    val text: String,
    val firstWord: Int,
    val starts: List<Int>,
    val lang: String?,
)

data class SpeechPlan(
    val words: List<SpeechWord>,
    val chunks: List<SpeechChunk>,
)

data class LangSpan(val lang: String, val start: Int, val end: Int)

private val OPEN_LANG = Regex("\\[\\[lang:([a-zA-Z]{2,3}(?:-[a-zA-Z]{2,4})?)]]")
private const val CLOSE_LANG = "[[/lang]]"

/** RN stripWithSpans: markers stripped; spans are ranges into the STRIPPED string. */
fun stripLangWithSpans(md: String): Pair<String, List<LangSpan>> {
    val out = StringBuilder()
    val spans = mutableListOf<LangSpan>()
    var i = 0
    val stack = ArrayDeque<Triple<Int, Int, String>>() // outStart, matchStart, lang
    while (i < md.length) {
        val open = OPEN_LANG.find(md, i)
        val closeIdx = md.indexOf(CLOSE_LANG, i)
        val takeOpen = open != null && (closeIdx < 0 || open.range.first <= closeIdx)
        when {
            takeOpen -> {
                val match = open!!
                stack.addLast(Triple(out.length, match.range.first, match.groupValues[1]))
                i = match.range.last + 1
            }
            closeIdx >= 0 && (!takeOpen || closeIdx <= open!!.range.first) -> {
                val frame = stack.removeLastOrNull()
                if (frame != null) {
                    spans += LangSpan(frame.third, frame.first, out.length)
                }
                i += CLOSE_LANG.length
            }
            else -> {
                out.append(md[i])
                i++
            }
        }
    }
    return out.toString() to spans
}

private val SENTENCE_END = Regex("[.!?…][\"'”’)\\]]?$")

private fun langAt(spans: List<LangSpan>, offset: Int): String? =
    spans.firstOrNull { offset >= it.start && offset < it.end }?.lang

/** RN buildSpeechPlan. Chunk splitting/units are 1:1 with the RN implementation. */
fun buildSpeechPlan(chunkTexts: List<String>, baseLanguage: String? = null): SpeechPlan {
    val words = mutableListOf<SpeechWord>()
    val chunks = mutableListOf<SpeechChunk>()
    val chunkTargetChars = 800
    val minSentenceChars = 200

    chunkTexts.forEachIndexed { chunkIndex, raw ->
        val fenced = raw.trimStart().startsWith("```") || raw.trimStart().startsWith("~~~")
        val (stripped, spans) = stripLangWithSpans(raw)
        if (fenced) {
            return@forEachIndexed // fences are never read aloud
        }

        // Per-line masks: hr/table-separator rows vanish entirely; structural
        // markers (heading hashes, list markers, quotes, pipes, images, link
        // plumbing, emphasis runs) drop while their text survives.
        data class Tok(val text: String, val start: Int, val end: Int, val lang: String?)

        val tokens = mutableListOf<Tok>()
        var lineStart = 0
        val lines = stripped.split('\n')
        for (line in lines) {
            val lineEnd = lineStart + line.length
            val mask = BooleanArray(line.length)
            fun maskRange(from: Int, to: Int) {
                for (k in from.coerceAtLeast(0) until to.coerceAtMost(line.length)) mask[k] = true
            }
            if (line.matches(HR) || line.matches(TABLE_SEPARATOR)) {
                maskRange(0, line.length)
            } else {
                headingRegex.find(line)?.let { maskRange(it.range.first, it.range.last + 1) }
                listRegex.find(line)?.let { maskRange(it.range.first, it.range.last + 1) }
                quoteRegex.find(line)?.let { maskRange(it.range.first, it.range.last + 1) }
                for (m in Regex("\\|").findAll(line)) maskRange(m.range.first, m.range.last + 1)
                for (m in Regex("!\\[[^\\]]*]\\([^)]*\\)").findAll(line)) maskRange(m.range.first, m.range.last + 1)
                for (m in Regex("]\\([^)]*\\)").findAll(line)) maskRange(m.range.first, m.range.last + 1)
                for (m in Regex("(?<!\\\\)\\[").findAll(line)) maskRange(m.range.first, m.range.last + 1)
                for (m in Regex("\\*{1,3}|~~|`+").findAll(line)) maskRange(m.range.first, m.range.last + 1)
                // Underscore emphasis: drop opening/closing runs; keep snake_case.
                var k = 0
                while (k < line.length) {
                    if (line[k] == '_') {
                        var runEnd = k
                        while (runEnd < line.length && line[runEnd] == '_') runEnd++
                        val run = runEnd - k
                        val prev = line.getOrNull(k - 1)
                        val next = line.getOrNull(runEnd)
                        val prevSoft = prev != null && (prev.isLetterOrDigit())
                        val nextSoft = next != null && (next.isLetterOrDigit())
                        val opening = (prev == null || prev.isWhitespace()) && next != null && !next.isWhitespace()
                        val closing = prev != null && !prev.isWhitespace() && (next == null || !next.isLetterOrDigit())
                        if (run <= 3 && (opening || closing) && !(prevSoft && nextSoft)) {
                            maskRange(k, runEnd)
                        }
                        k = runEnd
                    } else {
                        k++
                    }
                }
            }

            // Whitespace-separated unmasked runs = tokens (raw coords preserved).
            var t = 0
            while (t < line.length) {
                if (line[t].isWhitespace() || mask[t]) {
                    t++
                    continue
                }
                var e = t
                while (e < line.length && !line[e].isWhitespace() && !mask[e]) e++
                val text = line.substring(t, e)
                tokens += Tok(text, lineStart + t, lineStart + e, langAt(spans, lineStart + t))
                t = e
            }
            lineStart = lineEnd + 1
        }

        if (tokens.isEmpty()) return@forEachIndexed

        // Emit utterances: boundary on lang switch or >800 chars; sentence-end
        // tokens emit when ≥200 chars accumulated; leftover at chunk end.
        data class Emission(val from: Int, val to: Int, val lang: String?)

        val emissions = mutableListOf<Emission>()
        var from = 0
        var accumulated = 0
        var currentLang: String? = tokens.first().lang ?: baseLanguage
        for (idx in tokens.indices) {
            val tok = tokens[idx]
            val tokLang = tok.lang ?: baseLanguage
            if (tokLang != currentLang && idx > from) {
                emissions += Emission(from, idx, currentLang)
                from = idx
                accumulated = 0
                currentLang = tokLang
            }
            accumulated += tok.text.length + 1
            val last = idx == tokens.lastIndex
            if (SENTENCE_END.containsMatchIn(tok.text) && accumulated >= minSentenceChars) {
                emissions += Emission(from, idx + 1, currentLang)
                from = idx + 1
                accumulated = 0
                if (!last && idx + 1 < tokens.size) {
                    currentLang = tokens[idx + 1].lang ?: baseLanguage
                }
            } else if (accumulated >= chunkTargetChars) {
                emissions += Emission(from, idx + 1, currentLang)
                from = idx + 1
                accumulated = 0
            }
        }
        if (from < tokens.size) emissions += Emission(from, tokens.size, currentLang)

        // Materialize chunks: text = tokens joined ' '; starts recomputed.
        var firstWordGlobal = words.size
        for (emission in emissions) {
            val slice = tokens.subList(emission.from, emission.to)
            if (slice.isEmpty()) continue
            val text = slice.joinToString(" ") { it.text }
            val starts = ArrayList<Int>(slice.size)
            var offset = 0
            for (tok in slice) {
                starts += offset
                offset += tok.text.length + 1
            }
            val chunkIdx = chunks.size
            chunks += SpeechChunk(text, firstWordGlobal, starts, emission.lang)
            for (tok in slice) {
                words += SpeechWord(chunkIdx, tok.start, tok.end)
            }
            firstWordGlobal = words.size
        }
    }

    return SpeechPlan(words.toList(), chunks.toList())
}

/** Binary search: which chunk holds global word [i]; null out of range. */
fun findChunkForWord(plan: SpeechPlan, i: Int): SpeechChunk? {
    if (i < 0 || i >= plan.words.size) return null
    return plan.chunks.firstOrNull { it.firstWord <= i && i < it.firstWord + it.starts.size }
        ?: plan.chunks.lastOrNull { it.firstWord <= i }
}

/** Last word start ≤ charIndex within a chunk (default 0). */
fun localWordForChar(chunk: SpeechChunk, charIndex: Int): Int {
    var local = 0
    for (k in chunk.starts.indices) {
        if (chunk.starts[k] <= charIndex) local = k else break
    }
    return local
}

// Shared structural regexes (also used by the renderer).
internal val headingRegex = Regex("^ {0,3}#{1,6}(\\s|$)")
internal val listRegex = Regex("^ {0,3}([-*+]|\\d{1,9}[.)])(\\s+|$)")
internal val quoteRegex = Regex("^ {0,3}>\\s?")
