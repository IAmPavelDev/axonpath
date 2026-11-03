package com.iampavlo.axon.data.api

import com.iampavlo.axon.data.generated.infrastructure.Serializer
import com.iampavlo.axon.data.generated.model.AskClassQuestionRequest
import com.iampavlo.axon.data.generated.model.SubmitQuizAnswersRequest
import com.iampavlo.axon.data.generated.model.SubmitQuizAnswersRequestAnswersInner
import java.math.BigDecimal
import kotlinx.serialization.encodeToString
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Wire-format regression for the generated client (Ask AI outage 2026-10-29).
 * Generator defaults sent {"classId":"2","anchorText":null} — quoted ids via
 * BigDecimalAdapter, explicit nulls for omitted optionals via
 * encodeDefaults=true — and the backend's zod schemas 422'd every numeric
 * body (/class/qa/ask, /class/qa/retry, /quiz/{id}/submit). The
 * post-openApiGenerate patch in build.gradle.kts fixes both; these tests fail
 * if a regeneration or generator upgrade ever reverts it.
 */
class GeneratedWireFormatTest {

    @Test
    fun `request bodies carry unquoted ids and no explicit nulls`() {
        val json = Serializer.kotlinxSerializationJson
            .encodeToString(AskClassQuestionRequest.serializer(), ask(anchorText = null))
        assertTrue(json, json.contains("\"classId\":2"))
        assertFalse(json, json.contains("\"classId\":\"2\""))
        assertFalse(json, json.contains("\"anchorText\":null"))
    }

    @Test
    fun `set optional fields are still sent`() {
        val json = Serializer.kotlinxSerializationJson
            .encodeToString(AskClassQuestionRequest.serializer(), ask(anchorText = "selected text"))
        assertTrue(json, json.contains("\"anchorText\":\"selected text\""))
    }

    @Test
    fun `nested answer ids stay unquoted`() {
        val json = Serializer.kotlinxSerializationJson.encodeToString(
            SubmitQuizAnswersRequest.serializer(),
            SubmitQuizAnswersRequest(
                answers = listOf(
                    SubmitQuizAnswersRequestAnswersInner(
                        questionId = BigDecimal(11),
                        answer = "B",
                        timeSpentMs = null,
                    ),
                ),
            ),
        )
        assertTrue(json, json.contains("\"questionId\":11"))
        assertFalse(json, json.contains("\"timeSpentMs\""))
    }

    private fun ask(anchorText: String?) = AskClassQuestionRequest(
        classId = BigDecimal(2),
        anchorParagraph = 7,
        question = "is NULL and = NULL the same?",
        anchorText = anchorText,
    )
}
