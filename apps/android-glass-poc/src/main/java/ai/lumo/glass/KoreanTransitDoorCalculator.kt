package ai.lumo.glass

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

data class ScreenDoorCode(val car: Int, val door: Int)

/**
 * On-device Korean Subway Screen-Door (`3-2` -> `5-3`) & Platform Verifier for offline subway environments.
 */
object KoreanTransitDoorCalculator {
    private const val DOORS_PER_CAR = 4
    private const val METERS_PER_DOOR = 5.0
    private const val STEP_LENGTH_METERS = 0.7

    fun parseDoor(raw: String): ScreenDoorCode? {
        val parts = raw.trim().split("-")
        if (parts.size != 2) return null
        val car = parts[0].trim().toIntOrNull() ?: return null
        val door = parts[1].trim().toIntOrNull() ?: return null
        if (car !in 1..12 || door !in 1..DOORS_PER_CAR) return null
        return ScreenDoorCode(car, door)
    }

    fun calculateTransferGuidance(
        lineName: String,
        intendedDirectionStation: String,
        observedNextStation: String,
        observedDoorRaw: String,
        targetDoorRaw: String,
        transferStationName: String,
        transferTargetLine: String,
        higherCarIsRight: Boolean,
        arrivalMinutes: Int
    ): String {
        if (intendedDirectionStation.trim() != observedNextStation.trim()) {
            return "주의하세요. 이 승강장은 $observedNextStation 방면입니다. $intendedDirectionStation 방면 열차를 타시려면 반대편 승강장으로 이동하세요."
        }

        val current = parseDoor(observedDoorRaw)
        val target = parseDoor(targetDoorRaw)
        val base = "$lineName $intendedDirectionStation 방면 승강장 맞습니다. 다음 열차는 ${arrivalMinutes}분 뒤 도착합니다."

        if (current == null || target == null) {
            return "$base 현재 위치에서 탑승하세요."
        }

        val deltaDoors = (target.car - current.car) * DOORS_PER_CAR + (target.door - current.door)
        if (deltaDoors == 0) {
            return "$base 현재 서 계신 ${observedDoorRaw}번 문이 $transferStationName $transferTargetLine 빠른 환승 위치입니다."
        }

        val absDoors = abs(deltaDoors)
        val steps = max(1, ((absDoors * METERS_PER_DOOR) / STEP_LENGTH_METERS).roundToInt())
        val moveRight = if (deltaDoors > 0) higherCarIsRight else !higherCarIsRight
        val dirKo = if (moveRight) "오른쪽(3시 방향)" else "왼쪽(9시 방향)"

        return "$base 현재 ${observedDoorRaw}번 문 앞입니다. $transferStationName $transferTargetLine 빠른 환승(${targetDoorRaw}번 문)을 원하시면 ${dirKo}으로 문 ${absDoors}개, 약 ${steps}걸음 이동하세요."
    }
}
