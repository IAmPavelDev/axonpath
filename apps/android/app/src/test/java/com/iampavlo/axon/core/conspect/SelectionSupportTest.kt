package com.iampavlo.axon.core.conspect

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Invariants for the long-press selection support (visible spans + sentence bounds). */
class SelectionSupportTest {

    @Test
    fun `visible spans concatenate to the parsed plain text`() {
        val md = "a **bold** and `code` and [link](https://example.com) then \\* literal *em*"
        val plain = parseInlineSegments(md).joinToString("") { it.text }
        val fromSpans = visibleInlineSpans(md).joinToString("") { md.substring(it) }
        assertEquals(plain, fromSpans)
    }

    @Test
    fun `visible spans cover only non-dropped source ranges`() {
        val spans = visibleInlineSpans("x **y** z")
        // "x ", "y", " z" — the ** markers never render.
        assertEquals(listOf(0..1, 4..4, 7..8), spans.map { it.first..it.last })
    }

    @Test
    fun `plain text maps back to source offsets`() {
        val md = "see [docs](https://example.com) now"
        val plain = parseInlineSegments(md).joinToString("") { it.text }
        val spans = visibleInlineSpans(md)
        val map = IntArray(spans.sumOf { it.count() })
        var k = 0
        for (span in spans) for (o in span) map[k++] = o
        assertEquals(plain.length, map.size)
        // Every plain char maps to the same char in source.
        for (i in plain.indices) assertEquals(plain[i], md[map[i]])
    }

    @Test
    fun `sentence range expands a word to its sentence`() {
        val text = "First one. Second sentence here! Third"
        assertEquals(10 until 32, sentenceRangeAt(text, 14))
        assertEquals(10 until 32, sentenceRangeAt(text, 30))
    }

    @Test
    fun `sentence range covers terminator-less text`() {
        assertEquals(0 until 14, sentenceRangeAt("no terminators", 3))
    }

    @Test
    fun `sentence range clamps and stays inside text`() {
        val text = "One. Two."
        val range = sentenceRangeAt(text, text.length + 50)
        assertTrue(range.first >= 0 && range.last < text.length)
    }
}
