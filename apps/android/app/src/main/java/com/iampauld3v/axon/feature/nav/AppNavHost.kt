package com.iampauld3v.axon.feature.nav

import androidx.compose.runtime.Composable
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.iampauld3v.axon.core.di.AppContainer
import com.iampauld3v.axon.feature.classroom.ClassScreen
import com.iampauld3v.axon.feature.home.HomeScreen
import com.iampauld3v.axon.feature.settings.SettingsScreen
import com.iampauld3v.axon.feature.skillcreate.CreateSkillScreen
import com.iampauld3v.axon.feature.skillcreate.ReviewSkillScreen
import com.iampauld3v.axon.feature.skilldetail.SkillDetailScreen

object Routes {
    const val HOME = "home"
    const val SETTINGS = "settings"
    const val SKILL_CREATE = "skill/create"
    const val SKILL_DESCRIPTION = "skill/description?id={id}"
    const val SKILL_DETAIL = "skill/{id}"
    const val CLASS_DETAIL = "class/{id}"
}

/** Signed-in graph. Gating happens above; token refresh never bounces routes. */
@Composable
fun AxonNavHost(container: AppContainer) {
    val nav = rememberNavController()
    NavHost(navController = nav, startDestination = Routes.HOME) {
        composable(Routes.HOME) {
            HomeScreen(
                container = container,
                onOpenSkill = { nav.navigate("skill/$it") },
                onCreateSkill = { nav.navigate(Routes.SKILL_CREATE) },
                onOpenSettings = { nav.navigate(Routes.SETTINGS) },
            )
        }
        composable(Routes.SETTINGS) {
            SettingsScreen(container = container, onBack = { nav.popBackStack() })
        }
        composable(Routes.SKILL_CREATE) {
            CreateSkillScreen(
                container = container,
                onBack = { nav.popBackStack() },
                onCreated = { id ->
                    // RN router.replace: create screen leaves the back stack.
                    nav.navigate("skill/description?id=$id") {
                        popUpTo(Routes.SKILL_CREATE) { inclusive = true }
                    }
                },
            )
        }
        composable(
            route = Routes.SKILL_DESCRIPTION,
            arguments = listOf(navArgument("id") { type = NavType.IntType }),
        ) { entry ->
            val skillId = entry.arguments?.getInt("id") ?: -1
            ReviewSkillScreen(
                container = container,
                skillId = skillId,
                onBack = { nav.popBackStack() },
                onAccepted = { sid ->
                    // Accept arms first-lesson generation; detail shows the
                    // generating skeleton row.
                    nav.navigate("skill/$sid") { popUpTo(Routes.HOME) }
                },
            )
        }
        composable(
            route = Routes.SKILL_DETAIL,
            arguments = listOf(navArgument("id") { type = NavType.IntType }),
        ) { entry ->
            val skillId = entry.arguments?.getInt("id") ?: -1
            SkillDetailScreen(
                container = container,
                skillId = skillId,
                onBack = { nav.popBackStack() },
                onOpenClass = { nav.navigate("class/$it") },
            )
        }
        composable(
            route = Routes.CLASS_DETAIL,
            arguments = listOf(navArgument("id") { type = NavType.IntType }),
        ) { entry ->
            val classId = entry.arguments?.getInt("id") ?: -1
            ClassScreen(
                container = container,
                classId = classId,
                onBack = { nav.popBackStack() },
                onBackToSkill = { skillId ->
                    nav.navigate("skill/$skillId") { popUpTo(Routes.HOME) }
                },
            )
        }
    }
}
