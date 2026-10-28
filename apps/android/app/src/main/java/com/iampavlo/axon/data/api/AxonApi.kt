package com.iampavlo.axon.data.api

import com.iampavlo.axon.core.network.ApiException
import com.iampavlo.axon.data.dto.AskResult
import com.iampavlo.axon.data.dto.ClassDetail
import com.iampavlo.axon.data.dto.ClassListItem
import com.iampavlo.axon.data.dto.CreatedSkill
import com.iampavlo.axon.data.dto.Deleted
import com.iampavlo.axon.data.dto.Me
import com.iampavlo.axon.data.dto.QaBlock
import com.iampavlo.axon.data.dto.QuizQuestion
import com.iampavlo.axon.data.dto.QuizResult
import com.iampavlo.axon.data.dto.QuizResultEnvelope
import com.iampavlo.axon.data.dto.RecommendationVideo
import com.iampavlo.axon.data.dto.RecommendationsEnvelope
import com.iampavlo.axon.data.dto.SkillDetail
import com.iampavlo.axon.data.dto.SkillListItem
import com.iampavlo.axon.data.dto.SkillMistake
import com.iampavlo.axon.data.dto.SkillProgress
import com.iampavlo.axon.data.dto.SponsorSegmentsEnvelope
import com.iampavlo.axon.data.dto.StatusOnly
import com.iampavlo.axon.data.dto.SubmittedAnswer
import com.iampavlo.axon.data.generated.apis.ClassApi
import com.iampavlo.axon.data.generated.apis.QuizApi
import com.iampavlo.axon.data.generated.apis.SkillApi
import com.iampavlo.axon.data.generated.apis.VideoApi
import com.iampavlo.axon.data.generated.apis.AuthApi
import com.iampavlo.axon.data.generated.model.AskClassQuestionRequest
import com.iampavlo.axon.data.generated.model.CreateSkillRequest
import com.iampavlo.axon.data.generated.model.EditSkillRequest
import com.iampavlo.axon.data.generated.model.RefreshRecommendationsRequest
import com.iampavlo.axon.data.generated.model.RetryClassQaRequest
import com.iampavlo.axon.data.generated.model.SubmitQuizAnswersRequest
import com.iampavlo.axon.data.generated.model.SubmitQuizAnswersRequestAnswersInner
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.Response
import java.math.BigDecimal

/**
 * Typed surface over the GENERATED Retrofit client (openapi-generator, D5).
 * The generated models mirror the spec 1:1; this facade maps them onto the
 * UI-facing dtos. Mapping lives here — and only here — because the schemas
 * declare id fields as bare numbers (`type: number` → BigDecimal in the
 * generated models; P0 finding), while the UI works with Ints.
 */
class AxonApi(
    private val skill: SkillApi,
    private val clazz: ClassApi,
    private val quiz: QuizApi,
    private val video: VideoApi,
    private val auth: AuthApi,
) {
    private val errorJson = Json { ignoreUnknownKeys = true }

    // ---- transport helpers ----

    private suspend fun <T> Response<T>.orThrow(): T {
        if (isSuccessful) {
            return body() ?: throw ApiException(code(), "MALFORMED_RESPONSE", "Empty body (HTTP ${code()})")
        }
        val text = runCatching { errorBody()?.string() }.getOrNull()
        val parsed = text?.let { body ->
            runCatching {
                val obj = errorJson.parseToJsonElement(body).jsonObject
                obj["code"]?.jsonPrimitive?.contentOrNull to
                    obj["message"]?.jsonPrimitive?.contentOrNull
            }.getOrNull()
        }
        throw ApiException(
            status = code(),
            code = parsed?.first ?: "HTTP_${code()}",
            message = parsed?.second,
        )
    }

    private fun BigDecimal?.i(): Int? = this?.toInt()

    // ---- skill ----

    suspend fun skillList(): List<SkillListItem> =
        skill.listSkills().orThrow().map {
            SkillListItem(
                id = it.id.toInt(),
                topic = it.topic,
                status = it.status,
                createdAt = it.createdAt,
                lessonCount = it.lessonCount,
                completedLessons = it.completedLessons,
                learnedPoints = it.learnedPoints,
                lastActivityAt = it.lastActivityAt,
            )
        }

    suspend fun skillGet(id: Int): SkillDetail =
        skill.getSkillById(id).orThrow().let {
            SkillDetail(
                id = it.id.toInt(),
                topic = it.topic,
                description = it.description,
                status = it.status,
            )
        }

    suspend fun skillCreate(prompt: String): CreatedSkill =
        skill.createSkill(CreateSkillRequest(prompt = prompt)).orThrow().let {
            CreatedSkill(id = it.id.toInt(), status = it.status)
        }

    suspend fun skillEdit(id: Int, topic: String?, description: String?): StatusOnly =
        skill.editSkill(id, EditSkillRequest(topic = topic, description = description)).orThrow().let {
            StatusOnly(status = it.status)
        }

    suspend fun skillRetry(id: Int): StatusOnly =
        skill.retrySkill(id).orThrow().let { StatusOnly(status = it.status) }

    suspend fun skillProgress(id: Int): SkillProgress =
        skill.getSkillProgress(id).orThrow().let {
            SkillProgress(
                skillId = it.skillId.toInt(),
                topic = it.topic,
                status = it.status,
                totals = com.iampavlo.axon.data.dto.ProgressTotals(
                    lessonCount = it.totals.lessonCount,
                    completedLessons = it.totals.completedLessons,
                    learnedPoints = it.totals.learnedPoints,
                    accuracy = it.totals.accuracy?.toDouble(),
                ),
                classes = it.classes.map { c ->
                    com.iampavlo.axon.data.dto.SkillProgressClassDto(
                        classId = c.classId.toInt(),
                        index = c.index,
                        title = c.title,
                        questionCount = c.questionCount,
                        answeredCount = c.answeredCount,
                        correctCount = c.correctCount,
                        completed = c.completed,
                        accuracy = c.accuracy?.toDouble(),
                    )
                },
            )
        }

    suspend fun skillMistakes(id: Int): List<SkillMistake> =
        skill.listSkillMistakes(id).orThrow().map {
            SkillMistake(
                questionId = it.questionId.toInt(),
                type = it.type.value,
                questionText = it.questionText,
                choices = it.choices,
                yourAnswer = it.yourAnswer,
                correctAnswer = it.correctAnswer,
                feedback = it.feedback,
                score = it.score?.toDouble(),
                classId = it.classId.i(),
                classIndex = it.classIndex,
                answeredAt = it.answeredAt,
            )
        }

    suspend fun skillDelete(id: Int): Deleted =
        skill.deleteSkill(id).orThrow().let { Deleted(deleted = it.deleted) }

    // ---- class ----

    suspend fun classList(skillId: Int): List<ClassListItem> =
        clazz.listClasses(skillId).orThrow().map {
            ClassListItem(
                id = it.id.toInt(),
                title = it.title,
                createdAt = it.createdAt,
                questionCount = it.questionCount,
                learnedPoints = it.learnedPoints,
                lastActivityAt = it.lastActivityAt,
            )
        }

    suspend fun classGet(id: Int): ClassDetail =
        clazz.getClassById(id).orThrow().let {
            ClassDetail(
                id = it.id.toInt(),
                skillId = it.skillId.toInt(),
                title = it.title,
                contentMd = it.contentMd,
                baseLanguage = it.baseLanguage,
                clipStatus = it.clipStatus.value,
                videoClips = it.videoClips.map { clip ->
                    com.iampavlo.axon.data.dto.VideoClipDto(
                        id = clip.id.toInt(),
                        anchorParagraph = clip.anchorParagraph,
                        videoId = clip.videoId,
                        title = clip.title,
                        channel = clip.channel,
                        startSeconds = clip.startSeconds.toDouble(),
                        endSeconds = clip.endSeconds.toDouble(),
                        transcriptExcerpt = clip.transcriptExcerpt,
                        concept = clip.concept,
                    )
                },
            )
        }

    suspend fun qaList(classId: Int): List<QaBlock> =
        clazz.listClassQa(classId).orThrow().map {
            QaBlock(
                id = it.id.toInt(),
                classId = it.classId.toInt(),
                anchorParagraph = it.anchorParagraph,
                anchorText = it.anchorText,
                status = it.status.value,
                question = it.question,
                answer = it.answer,
                createdAt = it.createdAt,
            )
        }

    suspend fun qaAsk(
        classId: Int,
        anchorParagraph: Int,
        question: String,
        anchorText: String?,
    ): AskResult =
        clazz.askClassQuestion(
            AskClassQuestionRequest(
                classId = BigDecimal(classId),
                anchorParagraph = anchorParagraph,
                question = question,
                anchorText = anchorText,
            ),
        ).orThrow().let { AskResult(blockId = it.blockId.toInt(), status = it.status.value) }

    suspend fun qaRetry(classId: Int, blockId: Int): AskResult =
        clazz.retryClassQa(
            RetryClassQaRequest(
                classId = BigDecimal(classId),
                blockId = BigDecimal(blockId),
            ),
        ).orThrow().let { AskResult(blockId = it.blockId.toInt(), status = it.status.value) }

    // ---- quiz ----

    suspend fun quizGet(classId: Int): List<QuizQuestion> =
        quiz.getQuiz(classId).orThrow().map {
            QuizQuestion(
                id = it.id.toInt(),
                type = it.type.value,
                text = it.text,
                choices = it.choices,
            )
        }

    suspend fun quizSubmit(classId: Int, answers: List<SubmittedAnswer>): QuizResult {
        val body = SubmitQuizAnswersRequest(
            answers = answers.map {
                SubmitQuizAnswersRequestAnswersInner(
                    questionId = BigDecimal(it.questionId),
                    answer = it.answer,
                    timeSpentMs = it.timeSpentMs?.let { ms -> BigDecimal(ms.toLong()) },
                )
            },
        )
        return quiz.submitQuizAnswers(classId, body).orThrow().let {
            QuizResult(
                score = it.score.toInt(),
                total = it.total.toInt(),
                perQuestion = it.perQuestion.map { q ->
                    com.iampavlo.axon.data.dto.QuestionResult(
                        questionId = q.questionId.toInt(),
                        type = q.type.value,
                        isCorrect = q.isCorrect,
                        correctAnswer = q.correctAnswer,
                        userAnswer = q.userAnswer,
                    )
                },
            )
        }
    }

    suspend fun quizResult(classId: Int): QuizResultEnvelope =
        quiz.getQuizResult(classId).orThrow().let {
            QuizResultEnvelope(
                result = it.result?.let { r ->
                    QuizResult(
                        score = r.score.toInt(),
                        total = r.total.toInt(),
                        perQuestion = r.perQuestion.map { q ->
                            com.iampavlo.axon.data.dto.QuestionResult(
                                questionId = q.questionId.toInt(),
                                type = q.type.value,
                                isCorrect = q.isCorrect,
                                correctAnswer = q.correctAnswer,
                                userAnswer = q.userAnswer,
                            )
                        },
                    )
                },
            )
        }

    // ---- video ----

    suspend fun recommendations(skillId: Int): RecommendationsEnvelope =
        video.listSkillRecommendations(skillId).orThrow().let {
            RecommendationsEnvelope(
                status = it.status.value,
                videos = it.videos.map { v ->
                    RecommendationVideo(
                        videoId = v.videoId,
                        title = v.title,
                        channel = v.channel,
                        durationSeconds = v.durationSeconds,
                        rank = v.rank,
                    )
                },
            )
        }

    suspend fun recommendationsRefresh(skillId: Int): StatusOnly =
        video.refreshRecommendations(RefreshRecommendationsRequest(skillId = skillId))
            .orThrow().let { StatusOnly(status = it.status.value) }

    suspend fun sponsorSegments(videoId: String): SponsorSegmentsEnvelope =
        video.listSponsorSegments(videoId).orThrow().let {
            SponsorSegmentsEnvelope(
                segments = it.segments.map { s ->
                    com.iampavlo.axon.data.dto.SponsorSegment(
                        startSeconds = s.startSeconds.toDouble(),
                        endSeconds = s.endSeconds.toDouble(),
                        category = s.category,
                    )
                },
            )
        }

    // ---- auth ----

    suspend fun me(): Me =
        auth.getMe().orThrow().let {
            Me(
                id = it.id.toInt(),
                email = it.email,
                firstName = it.firstName,
                lastName = it.lastName,
                photoUrl = it.photoUrl,
                role = it.role,
                status = it.status,
                emailVerified = it.emailVerified,
                firebaseUid = it.firebaseUid,
            )
        }
}
