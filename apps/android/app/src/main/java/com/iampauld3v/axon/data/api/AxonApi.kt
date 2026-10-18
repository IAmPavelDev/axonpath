package com.iampauld3v.axon.data.api

import com.iampauld3v.axon.core.network.OrpcClient
import com.iampauld3v.axon.data.dto.AskResult
import com.iampauld3v.axon.data.dto.ClassDetail
import com.iampauld3v.axon.data.dto.ClassListItem
import com.iampauld3v.axon.data.dto.CreatedSkill
import com.iampauld3v.axon.data.dto.Me
import com.iampauld3v.axon.data.dto.QaBlock
import com.iampauld3v.axon.data.dto.QuizQuestion
import com.iampauld3v.axon.data.dto.QuizResult
import com.iampauld3v.axon.data.dto.QuizResultEnvelope
import com.iampauld3v.axon.data.dto.RecommendationsEnvelope
import com.iampauld3v.axon.data.dto.SkillDetail
import com.iampauld3v.axon.data.dto.SkillListItem
import com.iampauld3v.axon.data.dto.SkillMistake
import com.iampauld3v.axon.data.dto.SkillProgress
import com.iampauld3v.axon.data.dto.SponsorSegmentsEnvelope
import com.iampauld3v.axon.data.dto.StatusOnly
import com.iampauld3v.axon.data.dto.SubmittedAnswer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/**
 * Typed surface over the oRPC procedures the app uses. Paths and payload
 * shapes mirror `packages/api-contract` (skill/class/qa/quiz/video/stats).
 */
class AxonApi(private val rpc: OrpcClient) {

    private val json = Json { explicitNulls = false }

    // ---- skill ----

    suspend fun skillList(): List<SkillListItem> =
        rpc.call("skill/list", null, ListSerializer(SkillListItem.serializer()))

    suspend fun skillGet(id: Int): SkillDetail =
        rpc.call("skill/get", obj { put("id", id) }, SkillDetail.serializer())

    suspend fun skillCreate(prompt: String): CreatedSkill =
        rpc.call("skill/create", obj { put("prompt", prompt) }, CreatedSkill.serializer())

    suspend fun skillEdit(id: Int, topic: String?, description: String?): StatusOnly =
        rpc.call(
            "skill/edit",
            obj {
                put("id", id)
                topic?.let { put("topic", it) }
                description?.let { put("description", it) }
            },
            StatusOnly.serializer(),
        )

    suspend fun skillRetry(id: Int): StatusOnly =
        rpc.call("skill/retry", obj { put("id", id) }, StatusOnly.serializer())

    suspend fun skillProgress(id: Int): SkillProgress =
        rpc.call("skill/progress", obj { put("id", id) }, SkillProgress.serializer())

    suspend fun skillMistakes(id: Int): List<SkillMistake> =
        rpc.call("skill/mistakes", obj { put("id", id) }, ListSerializer(SkillMistake.serializer()))

    // ---- class ----

    suspend fun classList(skillId: Int): List<ClassListItem> =
        rpc.call("class/list", obj { put("skillId", skillId) }, ListSerializer(ClassListItem.serializer()))

    suspend fun classGet(id: Int): ClassDetail =
        rpc.call("class/get", obj { put("id", id) }, ClassDetail.serializer())

    suspend fun qaList(classId: Int): List<QaBlock> =
        rpc.call("class/qa/list", obj { put("classId", classId) }, ListSerializer(QaBlock.serializer()))

    suspend fun qaAsk(
        classId: Int,
        anchorParagraph: Int,
        question: String,
        anchorText: String?,
    ): AskResult = rpc.call(
        "class/qa/ask",
        obj {
            put("classId", classId)
            put("anchorParagraph", anchorParagraph)
            put("question", question)
            anchorText?.let { put("anchorText", it) }
        },
        AskResult.serializer(),
    )

    suspend fun qaRetry(classId: Int, blockId: Int): AskResult =
        rpc.call(
            "class/qa/retry",
            obj {
                put("classId", classId)
                put("blockId", blockId)
            },
            AskResult.serializer(),
        )

    // ---- quiz ----

    suspend fun quizGet(classId: Int): List<QuizQuestion> =
        rpc.call("quiz/get", obj { put("classId", classId) }, ListSerializer(QuizQuestion.serializer()))

    suspend fun quizSubmit(classId: Int, answers: List<SubmittedAnswer>): QuizResult =
        rpc.call(
            "quiz/submit",
            obj {
                put("classId", classId)
                put(
                    "answers",
                    json.encodeToJsonElement(ListSerializer(SubmittedAnswer.serializer()), answers),
                )
            },
            QuizResult.serializer(),
        )

    suspend fun quizResult(classId: Int): QuizResultEnvelope =
        rpc.call("quiz/result", obj { put("classId", classId) }, QuizResultEnvelope.serializer())

    // ---- video ----

    suspend fun recommendations(skillId: Int): RecommendationsEnvelope =
        rpc.call("video/recommendations/list", obj { put("skillId", skillId) }, RecommendationsEnvelope.serializer())

    suspend fun recommendationsRefresh(skillId: Int): StatusOnly =
        rpc.call("video/recommendations/refresh", obj { put("skillId", skillId) }, StatusOnly.serializer())

    suspend fun sponsorSegments(videoId: String): SponsorSegmentsEnvelope =
        rpc.call("video/sponsorSegments", obj { put("videoId", videoId) }, SponsorSegmentsEnvelope.serializer())

    // ---- auth / stats ----

    suspend fun me(): Me = rpc.call("auth/me", null, Me.serializer())

    private fun obj(block: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit) =
        buildJsonObject(block)
}

