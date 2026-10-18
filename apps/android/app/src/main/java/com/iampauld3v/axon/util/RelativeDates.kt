package com.iampauld3v.axon.util

import java.time.Instant
import java.time.LocalDate
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
