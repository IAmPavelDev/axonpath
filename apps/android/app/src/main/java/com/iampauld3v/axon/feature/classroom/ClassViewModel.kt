package com.iampauld3v.axon.feature.classroom

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.iampauld3v.axon.data.api.AxonApi
import com.iampauld3v.axon.data.dto.ClassDetail
import com.iampauld3v.axon.data.dto.QaBlock
import com.iampauld3v.axon.data.dto.QuizQuestion
import com.iampauld3v.axon.data.dto.QuizResult
import com.iampauld3v.axon.data.dto.SubmittedAnswer
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
    val classId: Int,
) : ViewModel() {

    var klass by mutableStateOf<ClassDetail?>(null)
        private set
    var loadError by mutableStateOf<String?>(null)
        private set

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
                onSuccess = { klass = it },
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
    }

    fun sendQuestionText(anchorParagraph: Int, anchorText: String?, question: String, excerpt: String) {
        if (question.isBlank()) return
        val tempId = nextTempId--
        tempAsks = tempAsks + TempAsk(tempId, anchorParagraph, anchorText, question)
        composer = null
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
    var quizFocusAt by mutableStateOf(0L)
        private set

    fun loadQuiz() {
        viewModelScope.launch {
            runCatching { api.quizGet(classId) }.onSuccess { questions ->
                quizQuestions = questions
                answers = questions.associate { it.id to (answers[it.id]) }
                quizFocusAt = System.currentTimeMillis()
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
                val perAnswerMs = (System.currentTimeMillis() - quizFocusAt) / answered.size
                val payload = answered.map { (questionId, answer) ->
                    SubmittedAnswer(questionId, answer!!, perAnswerMs.toInt())
                }
                val result = api.quizSubmit(classId, payload)
                quizResult = result
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
            runCatching { api.quizResult(classId) }.onSuccess { quizResult = it.result }
            if (quizResult != null) pollGrading()
        }
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
                    if (r.result != null) quizResult = r.result
                }
            }
        }
    }
}
