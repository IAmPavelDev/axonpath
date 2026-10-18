package com.iampauld3v.axon.feature.classroom

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.iampauld3v.axon.core.conspect.parseInlineSegments
import com.iampauld3v.axon.core.ui.theme.LabelStyle
import com.iampauld3v.axon.core.ui.theme.MetaStyle

private fun typeLabel(type: String) = when (type) {
    "MULTIPLE_CHOICE" -> "Multiple choice"
    "TRUE_FALSE" -> "True or false"
    else -> "Open answer"
}

/** RN Quiz.tsx: one-page quiz, inverted selection tiles, verdicts after submit. */
@Composable
fun QuizView(vm: ClassViewModel, onContinue: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    val questions = vm.quizQuestions

    when {
        questions == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = colors.primary)
        }

        questions.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(
                "No questions for this lesson yet.",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.onSurfaceVariant,
            )
        }

        else -> {
            val scroll = rememberScrollState()
            val result = vm.quizResult
            val submitted = result != null
            val stillGrading = result?.perQuestion?.any { it.isCorrect == null } == true
            val questionStyle = MaterialTheme.typography.headlineMedium.copy(fontSize = 22.sp)

            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(scroll)
                    .padding(horizontal = 24.dp),
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                if (submitted) {
                    Column {
                        Text(
                            "Quiz results",
                            style = MaterialTheme.typography.headlineMedium,
                            color = colors.onBackground,
                        )
                        Text(
                            buildString {
                                append("${result.score} of ${result.total} correct")
                                if (stillGrading) append(" · open answers still grading")
                            },
                            style = MetaStyle,
                            color = colors.onSurfaceVariant,
                        )
                    }
                }

                questions.forEachIndexed { index, question ->
                    val verdict = result?.perQuestion?.firstOrNull { it.questionId == question.id }
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(
                            "${index + 1}/${questions.size} · ${typeLabel(question.type)}",
                            style = LabelStyle,
                            color = colors.onSurfaceVariant,
                        )
                        Text(
                            text = parseInlineSegments(question.text).joinToString("") { it.text },
                            style = questionStyle,
                            color = colors.onBackground,
                        )
                        when (question.type) {
                            "OPEN_ENDED" -> {
                                val value = if (submitted) {
                                    verdict?.userAnswer.orEmpty()
                                } else {
                                    vm.answers[question.id].orEmpty()
                                }
                                OutlinedTextField(
                                    value = value,
                                    onValueChange = { vm.setAnswer(question.id, it) },
                                    enabled = !submitted,
                                    minLines = 4,
                                    modifier = Modifier.fillMaxWidth(),
                                    shape = RoundedCornerShape(10.dp),
                                    colors = OutlinedTextFieldDefaults.colors(
                                        focusedBorderColor = when {
                                            submitted && verdict?.isCorrect == true -> colors.primary
                                            submitted && verdict?.isCorrect == false -> colors.error
                                            else -> colors.primary
                                        },
                                        unfocusedBorderColor = colors.outline,
                                        focusedTextColor = colors.onBackground,
                                        unfocusedTextColor = colors.onBackground,
                                    ),
                                )
                            }
                            else -> {
                                val choices = if (question.type == "TRUE_FALSE") {
                                    listOf("True", "False")
                                } else {
                                    question.choices
                                }
                                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                    choices.forEach { choice ->
                                        val selected = vm.answers[question.id] == choice
                                        OptionTile(
                                            label = choice,
                                            selected = selected,
                                            verdictCorrect = submitted && verdict?.correctAnswer == choice,
                                            verdictWrong = submitted && selected && verdict?.isCorrect == false,
                                            enabled = !submitted,
                                            onClick = {
                                                vm.setAnswer(question.id, if (selected) null else choice)
                                            },
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                Spacer(Modifier.height(8.dp))

                val unanswered = questions.count { vm.answers[it.id].isNullOrBlank() }
                Button(
                    onClick = {
                        if (submitted) onContinue() else vm.submitQuiz(onContinue)
                    },
                    enabled = when {
                        vm.quizBusy -> false
                        submitted -> true
                        else -> unanswered == 0
                    },
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = colors.primary,
                        contentColor = colors.onPrimary,
                    ),
                ) {
                    Text(
                        text = when {
                            vm.quizBusy -> "Checking…"
                            submitted -> "Continue"
                            unanswered > 0 -> "$unanswered unanswered"
                            else -> "Submit answers"
                        },
                        style = MaterialTheme.typography.labelLarge,
                    )
                }
                Spacer(Modifier.height(96.dp))
            }
        }
    }
}

@Composable
private fun OptionTile(
    label: String,
    selected: Boolean,
    verdictCorrect: Boolean,
    verdictWrong: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    val ext = com.iampauld3v.axon.core.ui.theme.axonExtended()
    val (container, content) = when {
        verdictCorrect -> ext.success to ext.onSuccess
        verdictWrong -> colors.error to colors.onError
        selected -> colors.primary to colors.onPrimary
        else -> colors.background to colors.onBackground
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(container, RoundedCornerShape(10.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyLarge,
            color = content,
            modifier = Modifier.weight(1f),
        )
        if (verdictCorrect) {
            Icon(Icons.Filled.Check, contentDescription = "Correct", tint = content, modifier = Modifier.size(16.dp))
        } else if (verdictWrong) {
            Icon(Icons.Filled.Close, contentDescription = "Wrong", tint = content, modifier = Modifier.size(16.dp))
        }
    }
}
