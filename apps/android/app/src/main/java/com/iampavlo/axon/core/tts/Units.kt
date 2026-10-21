package com.iampavlo.axon.core.tts

/**
 * Port of RN lib/conspect-speech/unit-map.ts: playback units are ~220-char
 * sentence-packed slices of a chunk's speakable text. Word starts inside a
 * unit are estimated proportionally to normalized word length (upstream read
 * tokenizer subtitles; the official sherpa AAR exposes none, so the driver
 * estimates from unit duration — the same precision class as the RN
 * system-TTS fallback).
 */

private val UNIT_BOUNDARY = Regex("[.!?…][\"'”’)\\]]?(\\s|$)")

data class SpeechUnit(
    val chunkIdx: Int,
    val offset: Int,
    val length: Int,
    val firstGlobal: Int,
    val wordCount: Int,
    val lang: String?,
)

/** Contiguous, full-coverage sentence-packed slices of [text]. */
fun splitUnits(text: String, targetChars: Int = 220): List<Pair<Int, Int>> {
    if (text.isEmpty()) return emptyList()

    val bounds = mutableListOf(0)
    var i = 0
    while (i < text.length) {
        val match = UNIT_BOUNDARY.find(text, i)
        if (match == null) break
        bounds += match.range.last + 1
        i = match.range.last + 1
    }
    if (bounds.last() != text.length) bounds += text.length

    val units = mutableListOf<Pair<Int, Int>>()
    var start = bounds.first()
    for (k in 1 until bounds.size) {
        val end = bounds[k]
        if (end - start >= targetChars) {
            units += start to end
            start = end
        }
    }
    if (start < text.length) units += start to text.length
    return units.filter { (from, to) -> text.substring(from, to).isNotBlank() }
}

/** One unit per packed slice; global word coverage is contiguous. */
fun buildUnits(plan: SpeechPlan): List<SpeechUnit> {
    val units = mutableListOf<SpeechUnit>()
    plan.chunks.forEachIndexed { chunkIdx, chunk ->
        for ((from, to) in splitUnits(chunk.text)) {
            val firstLocal = chunk.starts.count { it < from }
            val count = chunk.starts.count { it in from until to }
            if (count == 0) continue
            units += SpeechUnit(
                chunkIdx = chunkIdx,
                offset = from,
                length = to - from,
                firstGlobal = chunk.firstWord + firstLocal,
                wordCount = count,
                lang = chunk.lang,
            )
        }
    }
    return units
}

/** Surface text of each word in a unit (sliced from the chunk text). */
fun unitWordTexts(chunk: SpeechChunk, unit: SpeechUnit): List<String> {
    val out = mutableListOf<String>()
    for (k in 0 until unit.wordCount) {
        val local = unit.firstGlobal + k - chunk.firstWord
        if (local < 0 || local >= chunk.starts.size) break
        val start = chunk.starts[local]
        val end = if (local + 1 < chunk.starts.size) {
            minOf(chunk.starts[local + 1] - 1, unit.offset + unit.length)
        } else {
            unit.offset + unit.length
        }
        if (end > start) out += chunk.text.substring(start, end).trim()
    }
    return out
}

private fun normalize(s: String): String = s.lowercase().filter { it.isLetterOrDigit() }

/**
 * Word start times (ms) within a unit: proportional to normalized word
 * length across the unit duration. Ordered, non-negative, < duration.
 */
fun estimateStarts(wordTexts: List<String>, durationMs: Int): List<Int> {
    if (wordTexts.isEmpty()) return emptyList()
    val weights = wordTexts.map { normalize(it).length.coerceAtLeast(1) }
    val total = weights.sum()
    var acc = 0L
    return weights.map { w ->
        val start = (acc * durationMs / total).toInt()
        acc += w
        start
    }
}
