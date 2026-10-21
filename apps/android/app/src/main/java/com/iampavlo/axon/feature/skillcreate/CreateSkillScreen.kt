package com.iampavlo.axon.feature.skillcreate

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.iampavlo.axon.core.di.AppContainer
import com.iampavlo.axon.core.ui.theme.Heading28Medium
import com.iampavlo.axon.core.ui.theme.LabelStyle
import com.iampavlo.axon.ui.components.LabeledArea
import com.iampavlo.axon.ui.components.ScreenHeader

/** RN CreateSkill: prompt textarea → skill.create → description confirm screen. */
@Composable
fun CreateSkillScreen(
    container: AppContainer,
    onBack: () -> Unit,
    onCreated: (Int) -> Unit,
    vm: CreateSkillViewModel = viewModel(initializer = { CreateSkillViewModel(container.api) }),
) {
    val colors = MaterialTheme.colorScheme

    Column(
        Modifier
            .fillMaxSize()
            .background(colors.background)
            .imePadding(),
    ) {
        ScreenHeader(onBack = onBack)

        Box(Modifier.fillMaxWidth().weight(1f)) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp)
                    .align(Alignment.Center),
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Step 1 of 2", style = LabelStyle, color = colors.onSurfaceVariant)
                    Text(
                        "What do you want to learn?",
                        style = Heading28Medium,
                        color = colors.onBackground,
                    )
                    Text(
                        "Write a short explanation of what you want to learn — your goal, " +
                            "level, or why it matters. Axon drafts a title and description from " +
                            "it; you review both before your first lesson is generated.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.onSurfaceVariant,
                    )
                }
                LabeledArea(
                    label = null,
                    value = vm.prompt,
                    onValueChange = vm::onPrompt,
                    placeholder = "e.g. I want to learn SQL joins for work — I know basic SELECTs, " +
                        "we use Postgres, and I keep writing the same queries by hand…",
                    enabled = !vm.busy,
                )
                vm.error?.let {
                    Text(it, style = MaterialTheme.typography.bodyMedium, color = colors.error)
                }
            }
        }

        Button(
            onClick = { vm.submit(onCreated) },
            enabled = !vm.busy && vm.prompt.trim().isNotEmpty(),
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 24.dp, end = 24.dp, bottom = 24.dp)
                .height(48.dp),
            shape = MaterialTheme.shapes.medium,
            colors = ButtonDefaults.buttonColors(
                containerColor = colors.primary,
                contentColor = colors.onPrimary,
            ),
        ) {
            Text(
                if (vm.busy) "Creating…" else "Create skill",
                style = MaterialTheme.typography.labelLarge,
            )
        }
    }
}
