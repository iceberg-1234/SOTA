package ai.sota.glass

import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.speech.tts.TextToSpeech
import java.util.Locale

/**
 * Phase 1 Foreground Companion Service for Google AI Glasses / Android Companion Device.
 * Operates hands-free via 1st-person camera stream, bone-conduction audio, and temple tap gestures
 * without requiring AccessibilityService permissions.
 */
class SotaGlassCompanionService : Service(), TextToSpeech.OnInitListener {
    private var tts: TextToSpeech? = null

    override fun onCreate() {
        super.onCreate()
        tts = TextToSpeech(this, this)
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            tts?.language = Locale.KOREAN
            tts?.setSpeechRate(1.15f)
            speakPriority("소타가 시작되었습니다. 도움이 필요하면 언제든 말씀하거나 안경다리를 탭하세요.", flush = true)
        }
    }

    fun speakPriority(utterance: String, flush: Boolean) {
        val queueMode = if (flush) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD
        tts?.speak(utterance, queueMode, null, "sota_utterance_${System.currentTimeMillis()}")
    }

    fun onBargeInGesture() {
        tts?.stop()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        tts?.stop()
        tts?.shutdown()
        super.onDestroy()
    }
}
