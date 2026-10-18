package com.iampauld3v.axon.core.conspect

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Port of RN inline-md.test.ts invariants. */
class InlineSegmentsTest {

    private fun texts(segs: List<InlineSegment>) = segs.joinToString("") { it.text }
    @Test
    fun `plain text is one unstyled segment`() {
        val segs = parseInlineSegments("just words")
        assertEquals(1, segs.size)
        assertNull(segs[0].style)
    }

    @Test
    fun `markers never render, styled range holds the content`() {
        val segs = parseInlineSegments("A **join** adds")
        assertEquals("A join adds", texts(segs))
        assertEquals("join", segs.first { it.style == InlineStyle.STRONG }.text)
    }

    @Test
    fun `em and code behave the same`() {
        assertTrue(parseInlineSegments("is *second* ok").none { it.text.contains('*') })
        val code = parseInlineSegments("run `SELECT` now")
        assertEquals("run SELECT now", texts(code))
        assertEquals("SELECT", code.first { it.style == InlineStyle.CODE }.text)
    }

    @Test
    fun `nested emphasis takes innermost style per cell`() {
        val segs = parseInlineSegments("**bold *inner* tail**")
        assertEquals("bold inner tail", texts(segs))
        assertEquals(listOf(InlineStyle.STRONG, InlineStyle.EM, InlineStyle.STRONG), segs.map { it.style })
    }

    @Test
    fun `link label styled, url dropped`() {
        val segs = parseInlineSegments("see [docs](https://example.com) now")
        assertEquals("see docs now", texts(segs))
        assertEquals("docs", segs.first { it.style == InlineStyle.LINK }.text)
    }

    @Test
    fun `unmatched markers stay literal`() {
        val md = "a * b ** c"
        assertEquals(md, texts(parseInlineSegments(md)))
    }

    @Test
    fun `backslash escapes stay literal`() {
        val segs = parseInlineSegments("not \\*bold\\* here")
        assertEquals("not *bold* here", texts(segs))
        assertTrue(segs.none { it.style != null })
    }
}
