package com.iampavlo.axon.feature.classroom

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.iampavlo.axon.core.analytics.Analytics
import com.iampavlo.axon.core.conspect.splitConspectChunks
import com.iampavlo.axon.core.conspect.stripLanguageMarkers
import com.iampavlo.axon.core.conspect.stripLeadingH1
import com.iampavlo.axon.data.api.AxonApi
import com.iampavlo.axon.data.dto.ClassDetail
import com.iampavlo.axon.data.dto.QaBlock
import com.iampavlo.axon.data.dto.QuizQuestion
import com.iampavlo.axon.data.dto.QuizResult
import com.iampavlo.axon.data.dto.SubmittedAnswer
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * RN class screen state: class.get polls 5s while clip PENDING; qa.list polls
 * 1.6s while any block PENDING; ask = optimistic temp block retired when the
 * server block with the returned id appears; quiz result polls 4s while any
 * per-question verdict is null (5 min cap).
 */
class ClassViewModel(
    private val api: AxonApi,
    private val analytics: Analytics,
    val classId: Int,
) : ViewModel() {

    var klass by mutableStateOf<ClassDetail?>(null)
        private set
    var loadError by mutableStateOf<String?>(null)
        private set
    private var lastLoggedClass: ClassDetail? = null

    /** Screen-entry timestamp — RN classViewAt (set at mount, never reset). */
    private val classViewAt = System.currentTimeMillis()

    var qaBlocks by mutableStateOf<List<QaBlock>>(emptyList())
        private set

    data class TempAsk(
        val tempId: Int,
        val anchorParagraph: Int,
        val anchorText: String?,
        val question: String,
        val awaitingBlockId: Int? = null,
        val failed: Boolean = false,
    )

    var tempAsks by mutableStateOf<List<TempAsk>>(emptyList())
        private set
    private var nextTempId = -1

    var anchorMode by mutableStateOf(false)
        private set
    var composer by mutableStateOf<ComposerState?>(null)
        private set

    data class ComposerState(
        val anchorParagraph: Int,
        val excerpt: String,
        val anchorText: String?,
    )
    /** Long-press text selection (RN native "Ask AI" selection parity):
     *  chunk index + sentence range in chunk-text space. */
    var selection by mutableStateOf<Pair<Int, IntRange>?>(null)
        private set

    fun onTextSelected(chunkIndex: Int, range: IntRange) {
        selection = chunkIndex to range
    }

    fun clearSelection() {
        selection = null
    }

    var quizQuestions by mutableStateOf<List<QuizQuestion>?>(null)
        private set
    var quizResult by mutableStateOf<QuizResult?>(null)
        private set
    var quizBusy by mutableStateOf(false)
        private set

    val isPreparing: Boolean
        get() = klass?.clipStatus == "PENDING"

    init {
        refreshClass(initial = true)
        refreshQa()
        loadQuiz()
        refreshQuizResult()
    }

    fun refreshClass(initial: Boolean = false) {
        viewModelScope.launch {
            runCatching { api.classGet(classId) }.fold(
                onSuccess = {
                    klass = it
                    // RN: class_view fires when the payload actually changes
                    // (structural sharing collapses no-op refetches).
                    if (it != lastLoggedClass) {
                        lastLoggedClass = it
                        analytics.track(
                            "class_view",
                            mapOf("class_id" to classId, "skill_id" to it.skillId),
                        )
                    }
                },
                onFailure = { if (initial) loadError = it.message ?: "Failed to load class." },
            )
        }
    }

    fun refreshQa() {
        viewModelScope.launch {
            runCatching { api.qaList(classId) }.onSuccess { blocks ->
                qaBlocks = blocks
                // Retire temps whose server block arrived (id matched after ask).
                tempAsks = tempAsks.filter { temp ->
                    val awaited = temp.awaitingBlockId
                    awaited == null || blocks.none { it.id == awaited }
                }
            }
        }
    }

    fun startAnchorMode() {
        anchorMode = true
    }

    fun cancelAnchorMode() {
        anchorMode = false
    }

    fun openComposer(anchorParagraph: Int, excerpt: String, anchorText: String?) {
        composer = ComposerState(anchorParagraph, excerpt, anchorText)
    }

    fun closeComposer() {
        composer = null
        clearSelection()
    }

    /**
     * Selection "Ask AI": the verbatim chunk text becomes excerpt +
     * anchorText, anchored to the selected chunk (RN anchors to the chunk
     * hosting the selection — here the chunk is known exactly).
     */
    fun askSelected() {
        val (chunkIdx, range) = selection ?: return
        val md = klass?.contentMd ?: return
        val chunks = splitConspectChunks(stripLanguageMarkers(stripLeadingH1(md)))
        val chunk = chunks.getOrNull(chunkIdx) ?: return
        val text = chunk.substring(
            range.first.coerceAtLeast(0),
            (range.last + 1).coerceAtMost(chunk.length),
        ).trim().takeIf { it.isNotBlank() } ?: return
        selection = null
        openComposer(chunkIdx, text, text)
    }

    fun sendQuestionText(anchorParagraph: Int, anchorText: String?, question: String, excerpt: String) {
        if (question.isBlank()) return
        val tempId = nextTempId--
        tempAsks = tempAsks + TempAsk(tempId, anchorParagraph, anchorText, question)
        composer = null
        clearSelection()
        anchorMode = false
        viewModelScope.launch {
            try {
                val result = api.qaAsk(classId, anchorParagraph, question, anchorText)
                tempAsks = tempAsks.map {
                    if (it.tempId == tempId) it.copy(awaitingBlockId = result.blockId) else it
                }
                refreshQa()
            } catch (e: Exception) {
                tempAsks = tempAsks.map {
                    if (it.tempId == tempId) it.copy(failed = true) else it
                }
            }
        }
    }

    fun retryAsk(temp: TempAsk) {
        viewModelScope.launch {
            try {
                val result = api.qaAsk(classId, temp.anchorParagraph, temp.question, temp.anchorText)
                tempAsks = tempAsks.map {
                    if (it.tempId == temp.tempId) it.copy(awaitingBlockId = result.blockId, failed = false) else it
                }
                refreshQa()
            } catch (e: Exception) {
                tempAsks = tempAsks.map {
                    if (it.tempId == temp.tempId) it.copy(failed = true) else it
                }
            }
        }
    }

    fun qaRetry(blockId: Int) {
        viewModelScope.launch {
            runCatching { api.qaRetry(classId, blockId) }
            refreshQa()
        }
    }

    // ---- quiz ----

    var answers by mutableStateOf<Map<Int, String?>>(emptyMap())
        private set

    /** Set when the learner opens the quiz tab (RN parity — timestamps the
     *  quiz session for per-answer timing + quiz_completed). 0 = never. */
    var quizFocusAt by mutableStateOf(0L)
        private set

    fun onQuizOpened(now: Long) {
        quizFocusAt = now
        analytics.track(
            "quiz_opened",
            mapOf(
                "class_id" to classId,
                "seconds_since_class_view" to (now - classViewAt) / 1000,
            ),
        )
    }

    fun loadQuiz() {
        viewModelScope.launch {
            runCatching { api.quizGet(classId) }.onSuccess { questions ->
                quizQuestions = questions
                answers = questions.associate { it.id to (answers[it.id]) }
            }
        }
    }

    fun setAnswer(questionId: Int, answer: String?) {
        answers = answers + (questionId to answer)
    }

    fun submitQuiz(onSubmitted: () -> Unit) {
        val questions = quizQuestions ?: return
        val answered = answers.filterValues { !it.isNullOrBlank() }
        if (quizBusy || answered.isEmpty()) return
        quizBusy = true
        viewModelScope.launch {
            try {
                // One-page quiz: total quiz time distributed evenly (RN
                // parity); null when the tab was never opened this session.
                val perAnswerMs = if (quizFocusAt != 0L) {
                    ((System.currentTimeMillis() - quizFocusAt) / answered.size).toInt()
                } else null
                val payload = answered.map { (questionId, answer) ->
                    SubmittedAnswer(questionId, answer!!, perAnswerMs)
                }
                val result = api.quizSubmit(classId, payload)
                publishQuizResult(result)
                onSubmitted()
                pollGrading()
            } catch (e: Exception) {
                // RN leaves the form editable on failure; retry via button.
            } finally {
                quizBusy = false
            }
        }
    }

    fun refreshQuizResult() {
        viewModelScope.launch {
            runCatching { api.quizResult(classId) }.onSuccess { publishQuizResult(it.result) }
            if (quizResult != null) pollGrading()
        }
    }
    private fun publishQuizResult(result: QuizResult?) {
        quizResult = result
        maybeFireQuizCompleted()
    }

    /** RN: one quiz_completed per fully-graded result, only when the quiz
     *  tab was opened this session; the timestamp nulls after firing. */
    private fun maybeFireQuizCompleted() {
        val result = quizResult ?: return
        if (quizFocusAt == 0L) return
        if (result.perQuestion.any { it.isCorrect == null }) return
        val startedAt = quizFocusAt
        quizFocusAt = 0L
        analytics.track(
            "quiz_completed",
            mapOf(
                "class_id" to classId,
                "seconds" to (System.currentTimeMillis() - startedAt) / 1000,
                "correct" to result.perQuestion.count { it.isCorrect == true },
                "total" to result.perQuestion.size,
            ),
        )
    }

    private fun pollGrading() {
        viewModelScope.launch {
            var elapsed = 0
            while (elapsed < 5 * 60 * 1000 &&
                quizResult?.perQuestion?.any { it.isCorrect == null } == true
            ) {
                delay(4_000)
                elapsed += 4_000
                runCatching { api.quizResult(classId) }.onSuccess { r ->
                    if (r.result != null) publishQuizResult(r.result)
                }
            }
        }
    }
}
