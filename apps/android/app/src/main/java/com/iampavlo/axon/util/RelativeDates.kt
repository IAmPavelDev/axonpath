package com.iampavlo.axon.util

import java.time.Instant
import java.time.LocalDate
import kotlin.math.roundToLong
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Port of the RN relative date formatting: Today / Yesterday / "N days ago"
 * (< 7) / "12 Mar 2026". Input: ISO-8601 timestamp from the API.
 */
fun relativeDate(iso: String?, today: LocalDate = LocalDate.now(ZoneId.systemDefault())): String {
    if (iso.isNullOrBlank()) return "not started"
    val date = runCatching { Instant.parse(iso).atZone(ZoneId.systemDefault()).toLocalDate() }
        .getOrNull() ?: return "not started"
    val days = today.toEpochDay() - date.toEpochDay()
    return when {
        days <= 0L -> "Today"
        days == 1L -> "Yesterday"
        days < 7L -> "$days days ago"
        else -> date.format(DateTimeFormatter.ofPattern("d MMM yyyy"))
    }
}

/** Seconds between an ISO-8601 timestamp and [now] (RN lesson_opened parity:
 *  "how soon after creation did the learner open the lesson?"). */
fun secondsSince(iso: String?, now: Long = System.currentTimeMillis()): Long {
    if (iso.isNullOrBlank()) return 0L
    val at = runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull() ?: return 0L
    return ((now - at) / 1000.0).roundToLong()
}
