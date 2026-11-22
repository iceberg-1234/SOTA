package ai.sota.glass

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import kotlin.math.PI
import kotlin.math.sin

enum class EarconKind {
    SCANNING_TICK,
    HAZARD_ALERT,
    SIGNAL_GREEN,
    TARGET_FOUND,
    TRANSIT_ARRIVING,
    BARGE_IN_ACK
}

/**
 * Zero-asset synthesized PCM Spatial Earcon generator for Bone-Conduction / Open-Ear Smart Glass speakers.
 */
object SpatialEarconSynthesizer {
    private const val SAMPLE_RATE = 24000

    fun play(kind: EarconKind) {
        val (freqHz, durationMs) = when (kind) {
            EarconKind.HAZARD_ALERT -> 880.0 to 180
            EarconKind.SIGNAL_GREEN, EarconKind.TRANSIT_ARRIVING -> 784.0 to 160
            EarconKind.TARGET_FOUND -> 660.0 to 120
            EarconKind.BARGE_IN_ACK -> 320.0 to 80
            EarconKind.SCANNING_TICK -> 520.0 to 60
        }

        val numSamples = (SAMPLE_RATE * durationMs) / 1000
        val pcm = ShortArray(numSamples)
        for (i in 0 until numSamples) {
            val envelope = 1.0 - (i.toDouble() / numSamples)
            val sample = sin(2.0 * PI * i * freqHz / SAMPLE_RATE) * envelope
            pcm[i] = (sample * Short.MAX_VALUE * 0.25).toInt().toShort()
        }

        val track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(pcm.size * 2)
            .setTransferMode(AudioTrack.MODE_STATIC)
            .build()

        track.write(pcm, 0, pcm.size)
        track.play()
    }
}
