package com.iampavlo.axon.data.dto

import kotlinx.serialization.Serializable

/**
 * DTOs mirroring packages/api-contract zod schemas 1:1. Dates (z.date()) ride
 * the wire as ISO-8601 strings — kept as String here, parsed at usage.
 */

// ---- skill ----

@Serializable
data class SkillListItem(
    val id: Int,
    val topic: String,
    val status: String,
    val createdAt: String,
    val lessonCount: Int,
    val completedLessons: Int,
    val learnedPoints: Int,
    val lastActivityAt: String?,
)

@Serializable
data class CreatedSkill(val id: Int, val status: String)

@Serializable
data class SkillDetail(
    val id: Int,
    val topic: String,
    val description: String,
    val status: String,
)

@Serializable
data class StatusOnly(val status: String)

@Serializable
data class Deleted(val deleted: Boolean)

@Serializable
data class ProgressTotals(
    val lessonCount: Int,
    val completedLessons: Int,
    val learnedPoints: Int,
    val accuracy: Double?,
)

@Serializable
data class SkillProgressClassDto(
    val classId: Int,
    val index: Int,
    val title: String,
    val questionCount: Int,
    val answeredCount: Int,
    val correctCount: Int,
    val completed: Boolean,
    val accuracy: Double?,
)

@Serializable
data class SkillProgress(
    val skillId: Int,
    val topic: String,
    val status: String,
    val totals: ProgressTotals,
    val classes: List<SkillProgressClassDto>,
)

@Serializable
data class SkillMistake(
    val questionId: Int,
    val type: String,
    val questionText: String,
    val choices: List<String>,
    val yourAnswer: String,
    val correctAnswer: String?,
    val feedback: String?,
    val score: Double?,
    val classId: Int?,
    val classIndex: Int?,
    val answeredAt: String,
)

// ---- class ----

@Serializable
data class ClassListItem(
    val id: Int,
    val title: String,
    val createdAt: String,
    val questionCount: Int,
    val learnedPoints: Int,
    val lastActivityAt: String?,
)

@Serializable
data class VideoClipDto(
    val id: Int,
    val anchorParagraph: Int,
    val videoId: String,
    val title: String,
    val channel: String,
    val startSeconds: Double,
    val endSeconds: Double,
    val transcriptExcerpt: String?,
    val concept: String,
)

@Serializable
data class ClassDetail(
    val id: Int,
    val skillId: Int,
    val title: String,
    val contentMd: String,
    val baseLanguage: String?,
    val clipStatus: String,
    val videoClips: List<VideoClipDto>,
)

@Serializable
data class QaBlock(
    val id: Int,
    val classId: Int,
    val anchorParagraph: Int,
    val anchorText: String?,
    val question: String,
    val answer: String?,
    val status: String,
    val createdAt: String,
)

@Serializable
data class AskResult(val blockId: Int, val status: String)

// ---- quiz ----

@Serializable
data class QuizQuestion(
    val id: Int,
    val type: String,
    val text: String,
    val choices: List<String>,
)

@Serializable
data class SubmittedAnswer(
    val questionId: Int,
    val answer: String,
    val timeSpentMs: Int? = null,
)

@Serializable
data class QuestionResult(
    val questionId: Int,
    val type: String,
    val isCorrect: Boolean?,
    val correctAnswer: String?,
    val userAnswer: String,
)

@Serializable
data class QuizResult(
    val score: Int,
    val total: Int,
    val perQuestion: List<QuestionResult>,
)

@Serializable
data class QuizResultEnvelope(val result: QuizResult?)

// ---- video ----

@Serializable
data class RecommendationVideo(
    val videoId: String,
    val title: String,
    val channel: String,
    val durationSeconds: Int?,
    val rank: Int,
)

@Serializable
data class RecommendationsEnvelope(val status: String, val videos: List<RecommendationVideo>)

@Serializable
data class SponsorSegment(
    val startSeconds: Double,
    val endSeconds: Double,
    val category: String,
)

@Serializable
data class SponsorSegmentsEnvelope(val segments: List<SponsorSegment>)

// ---- auth / stats ----

@Serializable
data class Me(
    val id: Int,
    val email: String,
    val firstName: String,
    val lastName: String,
    val photoUrl: String?,
    val role: String,
    val status: String,
    val emailVerified: Boolean,
    val firebaseUid: String?,
)
