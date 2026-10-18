package com.iampauld3v.axon.core.conspect

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.iampauld3v.axon.core.ui.theme.SourceSans3

/**
 * Port of the RN conspect markdown pipeline (makeStyles + render functions):
 * block layout per chunk + inline styled segments + active-word pill for TTS.
 * Tables render as plain aligned rows; links underline in foreground (RN
 * parity); code fences render in a muted card with a compact generic
 * highlighter (prism equivalent).
 */

data class Block(
    val kind: Kind,
    val text: String,
    val level: Int = 0,
    val language: String? = null,
    val startOffset: Int = 0,
    val endOffset: Int = 0,
) {
    enum class Kind { HEADING, PARAGRAPH, LIST, QUOTE, TABLE, CODE, HR }
}

private val FENCE = Regex("^ {0,3}(`{3,}|~{3,})(\\S+)?\\s*$")

/** Parse a chunk into renderable blocks carrying chunk-text offsets. */
fun parseBlocks(chunk: String): List<Block> {
    val lines = chunk.split('\n')
    val blocks = mutableListOf<Block>()
    var i = 0
    fun startOf(k: Int): Int {
        var o = 0
        for (x in 0 until k) o += lines[x].length + 1
        return o
    }
    while (i < lines.size) {
        val line = lines[i]
        val blockStart = startOf(i)
        fun finish(kind: Block.Kind, text: String, level: Int = 0, language: String? = null, endLine: Int): Block {
            val block = Block(kind, text, level, language, blockStart, startOf(endLine))
            blocks += block
            return block
        }
        when {
            line.isBlank() -> i++

            line.contains(FENCE) -> {
                val match = FENCE.find(line)!!
                val lang = match.groupValues[2]?.lowercase()?.takeIf { it.isNotBlank() }
                val code = StringBuilder()
                i++
                while (i < lines.size && !lines[i].contains(FENCE)) {
                    code.append(lines[i]).append('\n')
                    i++
                }
                i++ // closing fence
                finish(Block.Kind.CODE, code.toString().trimEnd('\n'), language = lang, endLine = i)
            }

            line.contains(HEADING) -> {
                val level = line.trimStart().takeWhile { it == '#' }.length
                finish(Block.Kind.HEADING, line.trimStart().trimStart('#').trim(), level, endLine = i + 1)
                i++
            }

            line.contains(HR) -> {
                finish(Block.Kind.HR, "", endLine = i + 1)
                i++
            }

            line.trimStart().startsWith(">") -> {
                val quote = StringBuilder()
                while (i < lines.size && lines[i].trimStart().startsWith(">")) {
                    quote.append(lines[i].trimStart().removePrefix(">").trim()).append('\n')
                    i++
                }
                finish(Block.Kind.QUOTE, quote.toString().trim(), endLine = i)
            }

            line.contains(TABLE_ROW) -> {
                val rows = StringBuilder()
                while (i < lines.size && lines[i].contains(TABLE_ROW)) {
                    if (!lines[i].contains(TABLE_SEPARATOR)) rows.append(lines[i].trim()).append('\n')
                    i++
                }
                finish(Block.Kind.TABLE, rows.toString().trim(), endLine = i)
            }

            line.contains(LIST_ITEM) -> {
                val list = StringBuilder()
                while (i < lines.size && lines[i].contains(LIST_ITEM)) {
                    list.append(lines[i]).append('\n')
                    i++
                }
                finish(Block.Kind.LIST, list.toString().trim(), endLine = i)
            }

            else -> {
                val para = StringBuilder()
                while (i < lines.size && lines[i].isNotBlank() &&
                    !lines[i].contains(FENCE) && !lines[i].contains(HEADING) &&
                    !lines[i].contains(HR) && !lines[i].contains(LIST_ITEM) &&
                    !lines[i].contains(TABLE_ROW) && !lines[i].trimStart().startsWith(">")
                ) {
                    para.append(lines[i]).append('\n')
                    i++
                }
                finish(Block.Kind.PARAGRAPH, para.toString().trim(), endLine = i)
            }
        }
    }
    return blocks
}

private fun axonTextStyle(family: FontFamily, weight: FontWeight, size: Int, line: Int, color: Color) = TextStyle(
    fontFamily = family,
    fontWeight = weight,
    fontSize = size.sp,
    lineHeight = line.sp,
    color = color,
)

private val HEADING_SIZES = intArrayOf(28, 22, 18, 15, 14)
private val HEADING_LINES = intArrayOf(36, 30, 25, 21, 20)

/** Inline markdown → AnnotatedString with the RN token styles. */
@Composable
fun inlineAnnotated(md: String, base: TextStyle): AnnotatedString {
    val codeBackground = MaterialTheme.colorScheme.surfaceVariant
    return remember(md, base) {
        buildAnnotatedString {
            for (segment in parseInlineSegments(md)) {
                when (segment.style) {
                    null -> append(segment.text)
                    InlineStyle.STRONG -> {
                        pushStyle(SpanStyle(fontWeight = FontWeight.SemiBold))
                        append(segment.text)
                        pop()
                    }
                    InlineStyle.EM -> {
                        pushStyle(SpanStyle(fontStyle = FontStyle.Italic))
                        append(segment.text)
                        pop()
                    }
                    InlineStyle.CODE -> {
                        pushStyle(
                            SpanStyle(fontFamily = FontFamily.Monospace, fontSize = 15.sp, background = codeBackground),
                        )
                        append(segment.text)
                        pop()
                    }
                    InlineStyle.LINK -> {
                        pushStyle(SpanStyle(textDecoration = TextDecoration.Underline))
                        append(segment.text)
                        pop()
                    }
                }
            }
        }
    }
}

/** Inline styles plus an inverted primary pill over [highlight] (word read aloud). */
@Composable
fun inlineAnnotatedHighlight(md: String, base: TextStyle, highlight: IntRange): AnnotatedString {
    val colors = MaterialTheme.colorScheme
    val codeBackground = colors.surfaceVariant
    return buildAnnotatedString {
        var cursor = 0
        for (segment in parseInlineSegments(md)) {
            val segStart = cursor
            when (segment.style) {
                null -> {}
                InlineStyle.STRONG -> pushStyle(SpanStyle(fontWeight = FontWeight.SemiBold))
                InlineStyle.EM -> pushStyle(SpanStyle(fontStyle = FontStyle.Italic))
                InlineStyle.CODE -> pushStyle(
                    SpanStyle(fontFamily = FontFamily.Monospace, fontSize = 15.sp, background = codeBackground),
                )
                InlineStyle.LINK -> pushStyle(SpanStyle(textDecoration = TextDecoration.Underline))
            }
            append(segment.text)
            if (segment.style != null) pop()

            val overlapStart = maxOf(segStart, highlight.first)
            val overlapEnd = minOf(cursor + segment.text.length, highlight.last + 1).coerceAtLeast(overlapStart)
            cursor = segStart + segment.text.length
            if (overlapStart < overlapEnd && overlapEnd <= cursor) {
                addStyle(
                    SpanStyle(background = colors.primary, color = colors.onPrimary),
                    overlapStart,
                    overlapEnd,
                )
            }
        }
    }
}

private data class CodePalette(val comment: Color, val string: Color, val number: Color, val keyword: Color)

@Composable
private fun codePalette(): CodePalette {
    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    return if (dark) {
        CodePalette(Color(0xFF8B949E), Color(0xFFA5D6FF), Color(0xFF79C0FF), Color(0xFFFF7B72))
    } else {
        CodePalette(Color(0xFF6E7781), Color(0xFF0A3069), Color(0xFF0550AE), Color(0xFFCF222E))
    }
}

private fun Color.luminance(): Float = red * 0.299f + green * 0.587f + blue * 0.114f

private data class Token(val text: String, val color: Color?)

private val KEYWORDS = setOf(
    "fun", "val", "var", "class", "object", "interface", "return", "if", "else", "when", "for",
    "while", "import", "package", "true", "false", "null", "this", "super", "is", "in", "as",
    "function", "const", "let", "extends", "new", "await", "async", "typeof",
    "def", "lambda", "None", "True", "False", "self", "elif", "try", "except", "raise", "with",
    "public", "private", "protected", "static", "void", "int", "str", "bool", "float", "double",
    "select", "from", "where", "join", "left", "inner", "group", "order", "by",
    "insert", "into", "values", "update", "set", "delete", "create", "table",
)

private fun tokenize(code: String, palette: CodePalette): List<Token> {
    val tokens = mutableListOf<Token>()
    val buffer = StringBuilder()
    var i = 0
    val n = code.length

    fun flush() {
        if (buffer.isNotEmpty()) {
            val word = buffer.toString()
            tokens += Token(word, if (word.lowercase() in KEYWORDS) palette.keyword else null)
            buffer.setLength(0)
        }
    }

    while (i < n) {
        val c = code[i]
        when {
            (c == '/' && code.getOrNull(i + 1) == '/') || c == '#' -> {
                flush()
                val end = code.indexOf('\n', i).let { if (it < 0) n else it }
                tokens += Token(code.substring(i, end), palette.comment)
                i = end
            }
            c == '/' && code.getOrNull(i + 1) == '*' -> {
                flush()
                val end = code.indexOf("*/", i).let { if (it < 0) n else it + 2 }
                tokens += Token(code.substring(i, minOf(end, n)), palette.comment)
                i = minOf(end, n)
            }
            c == '"' || c == '\'' || c == '`' -> {
                flush()
                var j = i + 1
                while (j < n && code[j] != c) {
                    if (code[j] == '\\') j++
                    j++
                }
                tokens += Token(code.substring(i, minOf(j + 1, n)), palette.string)
                i = j + 1
            }
            c.isDigit() -> {
                flush()
                var j = i
                while (j < n && (code[j].isDigit() || code[j] == '.' || code[j] == '_')) j++
                tokens += Token(code.substring(i, j), palette.number)
                i = j
            }
            c.isLetter() || c == '_' -> {
                buffer.append(c)
                i++
            }
            else -> {
                flush()
                tokens += Token(c.toString(), null)
                i++
            }
        }
    }
    flush()
    return tokens
}

@Composable
fun codeAnnotated(code: String, language: String?): AnnotatedString {
    val palette = codePalette()
    return remember(code, palette) {
        buildAnnotatedString {
            for (token in tokenize(code, palette)) {
                val color = token.color
                if (color == null) {
                    append(token.text)
                } else {
                    pushStyle(SpanStyle(color = color))
                    append(token.text)
                    pop()
                }
            }
        }
    }
}

/** Full chunk renderer — blocks + inline styles + RN spacing + active word pill. */
@Composable
fun ChunkMarkdown(
    chunk: String,
    modifier: Modifier = Modifier,
    activeWordRange: IntRange? = null,
) {
    val colors = MaterialTheme.colorScheme
    val blocks = remember(chunk) { parseBlocks(chunk) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        for (block in blocks) {
            val highlight = activeWordRange
                ?.takeIf { block.startOffset <= it.first && it.last < block.endOffset }
                ?.let { (it.first - block.startOffset)..(it.last - block.startOffset) }

            @Composable
            fun styled(text: String, base: TextStyle): AnnotatedString =
                if (highlight != null) inlineAnnotatedHighlight(text, base, highlight) else inlineAnnotated(text, base)

            when (block.kind) {
                Block.Kind.HEADING -> Text(
                    styled(
                        block.text,
                        axonTextStyle(
                            SourceSans3, FontWeight.SemiBold,
                            if (block.level in 1..5) HEADING_SIZES[block.level - 1] else 13,
                            if (block.level in 1..5) HEADING_LINES[block.level - 1] else 18,
                            if (block.level >= 6) colors.onSurfaceVariant else colors.onBackground,
                        ),
                    ),
                )

                Block.Kind.PARAGRAPH -> Text(
                    styled(block.text, axonTextStyle(SourceSans3, FontWeight.Normal, 18, 30, colors.onBackground)),
                )

                Block.Kind.LIST -> Column {
                    for (line in block.text.split('\n')) {
                        val marker = LIST_ITEM.find(line)?.value?.trim().orEmpty()
                        val content = line.trimStart().removePrefix(marker).trim()
                        Row {
                            Text(
                                if (marker.firstOrNull()?.isDigit() == true) "$marker " else "• ",
                                style = axonTextStyle(SourceSans3, FontWeight.Normal, 18, 30, colors.onSurfaceVariant),
                            )
                            Text(
                                styled(content, axonTextStyle(SourceSans3, FontWeight.Normal, 18, 30, colors.onBackground)),
                            )
                        }
                    }
                }

                Block.Kind.QUOTE -> Row {
                    Box(
                        Modifier
                            .padding(end = 16.dp)
                            .width(2.dp)
                            .height(56.dp)
                            .background(colors.onBackground),
                    )
                    Text(
                        styled(block.text, axonTextStyle(SourceSans3, FontWeight.Medium, 20, 31, colors.onBackground)),
                    )
                }

                Block.Kind.CODE -> Column(
                    Modifier
                        .fillMaxWidth()
                        .background(colors.surfaceVariant, RoundedCornerShape(10.dp))
                        .padding(14.dp),
                ) {
                    if (block.language != null) {
                        Text(
                            block.language!!,
                            style = axonTextStyle(FontFamily.Monospace, FontWeight.Normal, 11, 14, colors.onSurfaceVariant),
                        )
                        Spacer(Modifier.height(6.dp))
                    }
                    Text(
                        codeAnnotated(block.text, block.language),
                        style = axonTextStyle(FontFamily.Monospace, FontWeight.Normal, 14, 22, colors.onBackground),
                    )
                }

                Block.Kind.TABLE -> Column(
                    Modifier
                        .fillMaxWidth()
                        .border(1.dp, colors.outline, RoundedCornerShape(8.dp))
                        .padding(8.dp),
                ) {
                    for (line in block.text.split('\n')) {
                        Text(
                            line.removePrefix("|").removeSuffix("|").replace("|", "  ·  "),
                            style = axonTextStyle(SourceSans3, FontWeight.Normal, 14, 20, colors.onBackground),
                        )
                    }
                }

                Block.Kind.HR -> Box(
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 28.dp)
                        .height(1.dp)
                        .background(colors.outline),
                )
            }
        }
    }
}
