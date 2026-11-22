package ai.sota.glass

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

data class InferenceFeedbackEntry(
    val id: String,
    val timestampIso: String,
    val displayTime: String,
    val model: String,
    val latencyMs: Long,
    val detectedMode: String,
    val detectedModeLabelKo: String,
    val activeWindowSummary: String,
    val spokenKorean: String,
    val imageBase64: String?,
    var vote: String = "NONE", // "UP", "DOWN", "NONE"
    var feedbackText: String = ""
)

/**
 * Persists every AI inference (timestamp, latency, captured camera JPEG frame, AI inferred situation mode,
 * spoken answer, 👍/👎 vote, and detailed user feedback text) to internal storage (`files/sota_feedback_logs.json`)
 * and syncs to the development PC when connected or via `npm run feedback:pull`.
 */
object FeedbackLogStore {
    private const val FILE_NAME = "sota_feedback_logs.json"
    private const val MAX_STORED_ENTRIES = 60
    private val entries = mutableListOf<InferenceFeedbackEntry>()
    private var loaded = false

    @Synchronized
    fun ensureLoaded(context: Context) {
        if (loaded) return
        loaded = true
        try {
            val file = File(context.filesDir, FILE_NAME)
            if (!file.exists()) return
            val arr = JSONArray(file.readText(Charsets.UTF_8))
            entries.clear()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                entries.add(
                    InferenceFeedbackEntry(
                        id = o.optString("id"),
                        timestampIso = o.optString("timestampIso"),
                        displayTime = o.optString("displayTime"),
                        model = o.optString("model", NativeSotaAiClient.CHEAPEST_FAST_MODEL),
                        latencyMs = o.optLong("latencyMs", 0L),
                        detectedMode = o.optString("detectedMode", "AUTO"),
                        detectedModeLabelKo = o.optString("detectedModeLabelKo", ""),
                        activeWindowSummary = o.optString("activeWindowSummary", ""),
                        spokenKorean = o.optString("spokenKorean", ""),
                        imageBase64 = o.optString("imageBase64", "").takeIf { it.isNotEmpty() },
                        vote = o.optString("vote", "NONE"),
                        feedbackText = o.optString("feedbackText", "")
                    )
                )
            }
        } catch (_: Exception) {}
    }

    @Synchronized
    fun addEntry(
        context: Context,
        reply: NativeSotaAiClient.AutoAiReply,
        imageBase64: String?
    ): InferenceFeedbackEntry {
        ensureLoaded(context)
        val now = Date()
        val isoFmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val timeFmt = SimpleDateFormat("HH:mm:ss", Locale.KOREA)

        val entry = InferenceFeedbackEntry(
            id = "apk_${System.currentTimeMillis()}",
            timestampIso = isoFmt.format(now),
            displayTime = timeFmt.format(now),
            model = reply.model,
            latencyMs = reply.latencyMs,
            detectedMode = reply.detectedModeTag,
            detectedModeLabelKo = reply.detectedModeLabelKo,
            activeWindowSummary = reply.activeWindowSummary,
            spokenKorean = reply.spokenKorean,
            imageBase64 = imageBase64,
            vote = "NONE",
            feedbackText = ""
        )
        entries.add(0, entry)
        if (entries.size > MAX_STORED_ENTRIES) {
            entries.subList(MAX_STORED_ENTRIES, entries.size).clear()
        }
        persistToDisk(context)
        return entry
    }

    @Synchronized
    fun updateFeedback(
        context: Context,
        id: String,
        vote: String? = null,
        feedbackText: String? = null
    ) {
        ensureLoaded(context)
        val target = entries.find { it.id == id } ?: return
        if (vote != null) target.vote = vote
        if (feedbackText != null) target.feedbackText = feedbackText
        persistToDisk(context)
    }

    @Synchronized
    fun listEntries(context: Context): List<InferenceFeedbackEntry> {
        ensureLoaded(context)
        return entries.toList()
    }

    @Synchronized
    private fun toJsonArray(): JSONArray {
        val arr = JSONArray()
        for (e in entries) {
            arr.put(
                JSONObject()
                    .put("id", e.id)
                    .put("timestampIso", e.timestampIso)
                    .put("displayTime", e.displayTime)
                    .put("deviceSource", "ANDROID_GLASS_APK")
                    .put("model", e.model)
                    .put("latencyMs", e.latencyMs)
                    .put("detectedMode", e.detectedMode)
                    .put("detectedModeLabelKo", e.detectedModeLabelKo)
                    .put("activeWindowSummary", e.activeWindowSummary)
                    .put("spokenKorean", e.spokenKorean)
                    .put("imageBase64", e.imageBase64 ?: "")
                    .put("vote", e.vote)
                    .put("feedbackText", e.feedbackText)
            )
        }
        return arr
    }

    @Synchronized
    private fun persistToDisk(context: Context) {
        try {
            val file = File(context.filesDir, FILE_NAME)
            file.writeText(toJsonArray().toString(), Charsets.UTF_8)
        } catch (_: Exception) {}
    }

    /**
     * Best-effort background sync to local Mac companion server when connected via USB (`127.0.0.1:4310`).
     */
    fun trySyncToServerAsync(context: Context) {
        ensureLoaded(context)
        val payload = JSONObject().put("records", toJsonArray()).toString()
        val urls = listOf(
            "http://127.0.0.1:4310/api/feedback/sync"
        )
        for (u in urls) {
            try {
                val conn = (URL(u).openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 800
                    readTimeout = 1200
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                }
                OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(payload) }
                if (conn.responseCode in 200..299) break
            } catch (_: Exception) {}
        }
    }
}
