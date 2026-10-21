package com.iampavlo.axon.core.tts

import com.iampavlo.axon.core.conspect.splitConspectChunks
import com.iampavlo.axon.core.conspect.stripLeadingH1
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Replicates the RN vitest invariants (word-map / unit-map test files). */
class SpeechPlanTest {

    private fun planOf(md: String): SpeechPlan =
        buildSpeechPlan(splitConspectChunks(stripLeadingH1(md)))

    @Test
    fun `stripLeadingH1 drops only a leading single-hash heading`() {
        assertEquals("body", stripLeadingH1("# Title\n\nbody"))
        assertEquals("## Keep\n\n# not leading", stripLeadingH1("## Keep\n\n# not leading"))
    }

    @Test
    fun `words slice back to exact surface text`() {
        val md = "# Title\n\nThis is **bold** text, a [link](https://example.com) and snake_case_name.\n\n- one\n- two"
        val rawChunks = splitConspectChunks(stripLeadingH1(md))
        val plan = buildSpeechPlan(rawChunks)
        val rendered = rawChunks.map { stripLangWithSpans(it).first }
        assertTrue(plan.words.isNotEmpty())
        plan.words.forEachIndexed { wIdx, word ->
            val chunk = plan.chunks[word.chunk]
            val local = wIdx - chunk.firstWord
            val start = chunk.starts[local]
            val end = if (local + 1 < chunk.starts.size) chunk.starts[local + 1] - 1 else chunk.text.length
            val surface = chunk.text.substring(start, end).trim()
            assertEquals(
                "word[$wIdx] of chunk ${word.chunk}",
                rendered[word.chunk].substring(word.chunkStart, word.chunkEnd),
                surface,
            )
        }
    }

    @Test
    fun `fenced code is never spoken`() {
        val md = "Before\n\n```\nsecret code\n```\n\nAfter"
        val plan = buildSpeechPlan(splitConspectChunks(md))
        val all = plan.chunks.joinToString(" ") { it.text }
        assertTrue("secret" !in all)
        assertTrue("Before" in all && "After" in all)
    }

    @Test
    fun `snake_case survives`() {
        val plan = planOf("Read snake_case_name here.")
        val surfaces = plan.words.mapIndexed { i, w ->
            val chunk = plan.chunks[w.chunk]
            val local = i - chunk.firstWord
            val start = chunk.starts[local]
            val end = if (local + 1 < chunk.starts.size) chunk.starts[local + 1] - 1 else chunk.text.length
            chunk.text.substring(start, end).trim()
        }
        assertTrue("snake_case_name" in surfaces)
    }

    @Test
    fun `contiguous chunks share word indices`() {
        val longText = (1..120).joinToString(" ") { "word$it" } + "."
        val plan = buildSpeechPlan(listOf(longText))
        for (k in 0 until plan.chunks.size - 1) {
            assertEquals(
                plan.chunks[k].firstWord + plan.chunks[k].starts.size,
                plan.chunks[k + 1].firstWord,
            )
        }
    }

    @Test
    fun `findChunkForWord handles boundaries`() {
        val plan = planOf("Hello there. General Kenobi!")
        assertNotNull(findChunkForWord(plan, 0))
        assertNull(findChunkForWord(plan, -1))
        assertNull(findChunkForWord(plan, plan.words.size))
    }

    @Test
    fun `units are contiguous and fully covering`() {
        val plan = planOf("Short one.\n\n" + "A ".repeat(300) + "end.")
        val units = buildUnits(plan)
        var expected = 0
        for (unit in units) {
            assertEquals(expected, unit.firstGlobal)
            expected += unit.wordCount
        }
        assertEquals(plan.words.size, expected)
    }

    @Test
    fun `sentence packing respects 220 char target`() {
        val sentence = "This is a reasonably long sentence for testing purposes here. "
        val units = splitUnits(sentence.repeat(8))
        assertTrue(units.size > 1)
    }

    @Test
    fun `estimated starts are ordered and in range`() {
        val starts = estimateStarts(listOf("one", "twenty-four", "a"), 3000)
        assertEquals(3, starts.size)
        assertTrue(starts.zipWithNext().all { (a, b) -> a <= b })
        assertTrue(starts.last() < 3000)
    }
}
