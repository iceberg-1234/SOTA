package ai.lumo.glass

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.SurfaceTexture
import android.graphics.Typeface
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.content.Intent
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.text.Editable
import android.text.TextWatcher
import android.util.Base64
import android.view.GestureDetector
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.Surface
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.io.ByteArrayOutputStream
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Field-Testing Lumo Activity with Full Pedestrian Wayfinding & Feedback Logger:
 * 1. Destination Search -> Origin Address & Candidate Destination Confirmation (Fixes LUM-46, LUM-48)
 * 2. Live GPS + Compass Heading + Turn-by-Turn Pedestrian Route Tracking
 * 3. Live Camera View + `AI 답변 ON / OFF` Toggle
 * 4. Scrollable Inference & Feedback History List (Thumbnail, Time, Latency, Detected Mode, Answer, 👍/👎, Detailed Memo)
 */
class MainActivity : Activity(), TextToSpeech.OnInitListener, SensorEventListener {
    private var tts: TextToSpeech? = null
    private lateinit var missionInput: EditText
    private lateinit var glassModeTabBtn: Button
    private lateinit var labModeTabBtn: Button
    private lateinit var glassSimulatorPanel: LinearLayout
    private lateinit var labControlsContainer: LinearLayout
    private lateinit var glassHudModeBadge: TextView
    private lateinit var glassHudSpeechTv: TextView
    private lateinit var glassTouchpadStatusTv: TextView
    private lateinit var categoryScroll: HorizontalScrollView
    private lateinit var chipScroll: HorizontalScrollView
    private lateinit var searchRow: LinearLayout
    private lateinit var categoryTabRow: LinearLayout
    private lateinit var quickChipRow: LinearLayout
    private lateinit var candidateConfirmBox: LinearLayout
    private lateinit var activeNavBanner: TextView
    private lateinit var cameraTextureView: TextureView
    private lateinit var aiToggleBtn: Button
    private lateinit var talkMicBtn: Button
    private lateinit var historyScrollView: ScrollView
    private lateinit var historyContainer: LinearLayout

    private var isGlassWearableMode: Boolean = true
    private var isRecordingVoiceFeedback: Boolean = false
    private var latestEntryId: String? = null
    private var candidateSwipeCursor: Int = 0
    private var lastVolDownPressMs: Long = 0L
    private var activeCategoryId: String = "AUTO"

    private data class UseCaseQuickChip(val label: String, val promptQuery: String)
    private data class UseCaseCategoryTab(
        val id: String,
        val title: String,
        val inputHint: String,
        val chips: List<UseCaseQuickChip>
    )

    private val useCaseCategories = listOf(
        UseCaseCategoryTab(
            id = "AUTO",
            title = "🌟 Auto All",
            inputHint = "💬 Ask anything or enter destination (e.g. Guui Stn / Read all)",
            chips = listOf(
                UseCaseQuickChip("👀 Describe Scene", "지금 내 눈앞에 무엇이 보이는지 자연스럽게 알려줘"),
                UseCaseQuickChip("🥤 Mart 1+1 / Zero", "지금 보이는 상품의 정확한 이름, 맛, 제로슈거 여부, 가격, 1+1 행사 여부를 알려줘"),
                UseCaseQuickChip("🍱 Dining & Bones", "식탁이나 접시 위 음식과 반찬이 앞쪽/위쪽 어디에 놓여 있는지, 생선 가시나 남은 양을 알려줘"),
                UseCaseQuickChip("🔥 Stove Heat / LED", "인덕션 화구 켜짐 단계와 잔열(H) 화상 위험 여부, 또는 가전제품 표시창 상태와 남은 시간을 알려줘"),
                UseCaseQuickChip("📌 Remember Item", "지금 화면에 보이는 생활 물건(에어팟, 안경, 열쇠, 지갑 등)과 구체적 위치를 기억해 줘")
            )
        ),
        UseCaseCategoryTab(
            id = "WAYFINDING",
            title = "🧭 Wayfinding",
            inputHint = "🧭 Search place or switch mode (e.g. Coupang HQ / By Subway)",
            chips = listOf(
                UseCaseQuickChip("⚠️ Stairs / Glass Door", "전방에 회색 내리막 계단 첫 단, 보도턱 단차, 또는 투명 통유리문과 손잡이가 있는지 봐줘"),
                UseCaseQuickChip("🚦 Crosswalk Signal", "횡단보도 보행자 신호등이 초록불인지 빨간불인지, 남은 시간과 정면 방향을 알려줘"),
                UseCaseQuickChip("🌙 Low-Light Path", "어두운 구간인데 지금 걸어가는 바닥이 평탄한지, 손잡이나 벽면이 어느 쪽에 이어지는지 알려줘")
            )
        ),
        UseCaseCategoryTab(
            id = "TRANSIT_TAXI",
            title = "🚇 Transit & Taxi",
            inputHint = "🚕 Enter Taxi Plate (e.g. 택시 34바5678) or transit query",
            chips = listOf(
                UseCaseQuickChip("🚇 Platform & Door#", "지금 지하철 승강장이 어느 역 방면인지, 몇 호차 몇 번 문(스크린도어 번호)인지 읽어줘"),
                UseCaseQuickChip("🚃 On-Board Stops", "지금 지하철 안인데 현재 어느 역이고 내릴 역까지 몇 정거장 남았는지, 어느 쪽 문이 열리는지 알려줘"),
                UseCaseQuickChip("🚕 Taxi Plate & Door", "지금 앞에 멈춘 택시나 차량의 색상, 차종, 번호판 번호를 읽고 뒷좌석 문 손잡이 위치를 알려줘"),
                UseCaseQuickChip("🚌 Bus Stop & Route", "버스 정류장 표지판 번호나 지금 들어오는 버스 번호와 앞문 위치를 알려줘")
            )
        ),
        UseCaseCategoryTab(
            id = "SHOPPING_DINING_DOC",
            title = "🛒 Mart·Meal·Docs",
            inputHint = "🛒 Compare items, meal layout, expiry date, or read full card",
            chips = listOf(
                UseCaseQuickChip("🥤 Product / Zero / 1+1", "지금 들고 있는 상품의 정확한 제품명, 맛, 제로슈거 여부, 가격표, 1+1 행사 여부를 알려줘"),
                UseCaseQuickChip("🍱 Meal & Utensils", "접시나 식판 위 반찬 배치를 앞쪽 왼쪽/오른쪽, 위쪽 기준으로 설명하고 생선 가시나 남은 음식 위치를 알려줘"),
                UseCaseQuickChip("💊 Meds & Expiry Date", "약봉지 복용 시점(아침/점심/저녁)이나 안약 구분, 또는 식품 소비기한 날짜를 읽어 오늘 기준 며칠 남았는지 알려줘"),
                UseCaseQuickChip("📖 Read Full Text", "눈앞에 보이는 카드나 문서의 내용 전체를 빠짐없이 끝까지 다 읽어줘")
            )
        ),
        UseCaseCategoryTab(
            id = "HOME_APPLIANCE_KIOSK",
            title = "🏠 Home & Kiosk",
            inputHint = "🏠 Find item (e.g. 내 에어팟 어디 있어?) or appliance/kiosk",
            chips = listOf(
                UseCaseQuickChip("🔥 Induction Heat / LED", "평면 인덕션 켜진 화구 단계와 잔열(H) 화상 위험 여부, 또는 세탁기/전자레인지 현재 코스와 남은 시간을 알려줘"),
                UseCaseQuickChip("🛗 Elevator 1F / Kiosk", "엘리베이터 1층(로비층) 버튼에 불이 켜져 있는지 먼저 확인하고, 내 손가락에서 목표 버튼까지 상하좌우 몇 cm 이동할지 알려줘"),
                UseCaseQuickChip("📌 Save Item Location", "지금 화면에 보이는 생활 물건(에어팟, 안경, 열쇠, 리모컨, 지갑 등)과 놓인 위치를 기억해 줘"),
                UseCaseQuickChip("🔍 Recall Saved Items", "내가 아까 둔 에어팟이나 안경, 열쇠가 어디에 있는지 기억해 둔 위치를 모두 알려줘"),
                UseCaseQuickChip("👕 Outfit & Stain Check", "지금 입은 옷의 색상 조합과 묻은 얼룩이나 먼지가 없는지 확인해 줘")
            )
        ),
        UseCaseCategoryTab(
            id = "PUBLIC_OFFICE",
            title = "🚻 Public & Office",
            inputHint = "🚻 Restroom, empty cafe seat, slides, or social gesture",
            chips = listOf(
                UseCaseQuickChip("🚻 Restroom & Stall", "화장실 입구 표지판이 남자/여자 화장실 중 무엇인지, 안쪽 빈 칸(초록/빨강 표시)과 세면대 위치를 알려줘"),
                UseCaseQuickChip("🤝 Handshake / Card", "앞에 계신 분이 악수나 명함, 물건을 건네며 손을 내밀고 있는지 알려줘"),
                UseCaseQuickChip("📊 Slide Summary", "회의실 프로젝터나 모니터 발표 화면의 제목과 핵심 내용 2가지를 짧게 요약해 줘"),
                UseCaseQuickChip("☕ Empty Cafe Seat", "주변에 앉을 수 있는 빈 좌석이 몇 걸음 앞에 있는지와 바닥 가방/의자 장애물을 알려줘")
            )
        )
    )

    private val ioExecutor = Executors.newCachedThreadPool()
    private val syncExecutor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var cameraDevice: CameraDevice? = null
    private var captureSession: CameraCaptureSession? = null
    private var locationManager: LocationManager? = null
    private var sensorManager: SensorManager? = null
    private var speechRecognizer: SpeechRecognizer? = null

    private var aiEnabled = false
    private var isListeningMic = false
    private var requestInFlight = false
    @Volatile
    private var inferenceEpoch: Int = 0
    private var lastSpokenText: String? = null

    companion object {
        private const val REQ_PERMS = 1001
        private const val REQ_VOICE_FALLBACK = 1002
        private const val REALTIME_INTERVAL_MS = 2200L
    }

    private val gpsListener = object : LocationListener {
        override fun onLocationChanged(loc: Location) {
            WayfindingNavigator.currentLat = loc.latitude
            WayfindingNavigator.currentLng = loc.longitude
            WayfindingNavigator.hasGpsFix = true
            updateActiveNavBannerUi()
        }
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {}
        @Deprecated("Deprecated in Java")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    }

    private val realtimeLoopRunnable = object : Runnable {
        override fun run() {
            if (!aiEnabled) return
            val isSpeaking = tts?.isSpeaking == true
            if (!isSpeaking && !isListeningMic && !requestInFlight) {
                runSingleInferenceStep(userQuery = "")
            }
            if (aiEnabled) {
                mainHandler.postDelayed(this, REALTIME_INTERVAL_MS)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        tts = TextToSpeech(this, this)
        requestRuntimePermissionsIfNeeded()
        startGpsAndCompassTracking()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0B0E14"))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        val topCameraCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 18, 24, 18)
            setBackgroundColor(Color.parseColor("#131926"))
        }

        // 1. Unified Interactive Command Bar (Text + Voice Input -> Simulates voice commands for Pilot testing, Fixes LUM-65 & LUM-66)
        searchRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, 10)
            }
        }

        missionInput = EditText(this).apply {
            hint = "💬 Enter command, question, or place..."
            setHintTextColor(Color.parseColor("#94A3B8"))
            setTextColor(Color.WHITE)
            textSize = 13.5f
            setBackgroundColor(Color.parseColor("#0B0E14"))
            setPadding(20, 14, 20, 14)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(0, 0, 8, 0)
            }
            // LUM-71: Immediately interrupt TTS when user touches or starts typing in the input box!
            setOnClickListener { tts?.stop() }
            setOnFocusChangeListener { _, hasFocus -> if (hasFocus) tts?.stop() }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    if ((s?.length ?: 0) > 0) tts?.stop()
                }
                override fun afterTextChanged(s: Editable?) {}
            })
        }

        val sendCmdBtn = Button(this).apply {
            text = "💬 Send"
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#FFD400"))
            setTextColor(Color.BLACK)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 6, 0)
            }
            setOnClickListener {
                val cmd = missionInput.text.toString().trim()
                if (cmd.isNotEmpty()) {
                    missionInput.setText("")
                    handleUserSpokenConversation(cmd)
                }
            }
        }

        val searchDestBtn = Button(this).apply {
            text = "🔍 Place"
            textSize = 12.5f
            typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#334155"))
            setTextColor(Color.WHITE)
            setOnClickListener {
                val query = missionInput.text.toString().trim()
                if (query.isEmpty()) {
                    WayfindingNavigator.clearRoute()
                    val msg = NativeLumoAiClient.startOrClearMission("")
                    candidateConfirmBox.visibility = View.GONE
                    activeNavBanner.visibility = View.GONE
                    speakNative(msg)
                } else {
                    missionInput.setText("")
                    searchDestinationAndPromptUser(query)
                }
            }
        }

        searchRow.addView(missionInput)
        searchRow.addView(sendCmdBtn)
        searchRow.addView(searchDestBtn)

        // 2. Origin & Destination Candidate Confirmation Panel (Hidden until search results arrive)
        candidateConfirmBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
            setPadding(18, 16, 18, 16)
            setBackgroundColor(Color.parseColor("#1E293B"))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, 12)
            }
        }

        // 3. Active Turn-by-Turn Pedestrian Route Banner
        activeNavBanner = TextView(this).apply {
            visibility = View.GONE
            setTextColor(Color.parseColor("#00E676"))
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#0B0E14"))
            setPadding(18, 12, 18, 12)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, 12)
            }
        }

        // 4. AI Companion ON/OFF Toggle + Hands-Free Conversational Talk Button
        val toggleAndMicRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, 12)
            }
        }

        aiToggleBtn = Button(this).apply {
            text = "🔴 Live AI: OFF"
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#3B1219"))
            setTextColor(Color.parseColor("#FFD7D7"))
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.1f).apply {
                setMargins(0, 0, 6, 0)
            }
            setOnClickListener {
                setAiToggleState(!aiEnabled)
            }
        }

        val stopSpeechBtn = Button(this).apply {
            text = "✋ Stop"
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#475569"))
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 0.8f).apply {
                setMargins(3, 0, 3, 0)
            }
            setOnClickListener {
                tts?.stop()
                stopInlineVoiceListening()
                SpatialEarconSynthesizer.play(EarconKind.BARGE_IN_ACK)
            }
        }

        talkMicBtn = Button(this).apply {
            text = "🎙️ Push-to-Talk"
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#1E293B"))
            setTextColor(Color.parseColor("#FFD400"))
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.1f).apply {
                setMargins(6, 0, 0, 0)
            }
            setOnClickListener {
                tts?.stop()
                startInlineVoiceListening()
            }
        }

        toggleAndMicRow.addView(aiToggleBtn)
        toggleAndMicRow.addView(stopSpeechBtn)
        toggleAndMicRow.addView(talkMicBtn)

        // 5. Live 1st-Person Rear Camera Preview
        cameraTextureView = TextureView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                260
            )
            surfaceTextureListener = object : TextureView.SurfaceTextureListener {
                override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
                    openRearCamera()
                }
                override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {}
                override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
                    closeRearCamera()
                    return true
                }
                override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {}
            }
        }

        // Top 2-Mode Switcher: [👓 글래스 실착용 모드 (Android XR Spec)] vs [🧪 UC 검증 & 피드백 보드]
        val modeSwitcherRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, 12)
            }
        }
        glassModeTabBtn = Button(this).apply {
            text = "👓 Glass Mode"
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(0, 0, 6, 0)
            }
            setOnClickListener { switchAppTestMode(glassMode = true) }
        }
        labModeTabBtn = Button(this).apply {
            text = "🧪 UC QA & Logs"
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(6, 0, 0, 0)
            }
            setOnClickListener { switchAppTestMode(glassMode = false) }
        }
        modeSwitcherRow.addView(glassModeTabBtn)
        modeSwitcherRow.addView(labModeTabBtn)

        // Build Google Android XR AI Glasses Simulator Panel (Glimmer HUD + Temple Touchpad + Voice Feedback)
        glassSimulatorPanel = buildGlassWearableSimulatorPanel()

        // 0. 6-Category Multi-Use-Case Verification Tabs + One-Tap Quick Scenario Chips (Fixes LUMO-130)
        categoryScroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, 8)
            }
        }
        categoryTabRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        categoryScroll.addView(categoryTabRow)

        chipScroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, 10)
            }
        }
        quickChipRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        chipScroll.addView(quickChipRow)

        labControlsContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(categoryScroll)
            addView(chipScroll)
            addView(searchRow)
        }

        topCameraCard.addView(modeSwitcherRow)
        topCameraCard.addView(labControlsContainer)
        topCameraCard.addView(candidateConfirmBox)
        topCameraCard.addView(activeNavBanner)
        topCameraCard.addView(toggleAndMicRow)
        topCameraCard.addView(cameraTextureView)
        topCameraCard.addView(glassSimulatorPanel)

        renderUseCaseCategoryTabsAndChips()

        historyScrollView = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
        }

        historyContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 16, 24, 340)
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }

        historyScrollView.addView(historyContainer)
        root.addView(topCameraCard)
        root.addView(historyScrollView)
        setContentView(root)

        renderHistoryList()
        val initialEntries = FeedbackLogStore.listEntries(this)
        if (initialEntries.isNotEmpty()) {
            latestEntryId = initialEntries.first().id
            updateGlassHudBanner(
                modeTag = initialEntries.first().detectedMode,
                latencyMs = initialEntries.first().latencyMs,
                spoken = initialEntries.first().spokenKorean
            )
        }
        switchAppTestMode(glassMode = true)
        syncExecutor.execute { FeedbackLogStore.trySyncToServerAsync(this) }
    }

    /**
     * Switches between:
     * 1. `👓 글래스 실착용 모드` (Google Android XR AI Glasses Spec: Glimmer HUD + Giant Eyes-Free Temple Touchpad + Physical Volume Key Mapping + Voice Feedback)
     * 2. `🧪 UC 검증·피드백 보드` (6-Category Tabs + 23 One-Tap Use-Case Chips + Text Input + Full Scrollable History List)
     */
    private fun switchAppTestMode(glassMode: Boolean) {
        isGlassWearableMode = glassMode
        glassModeTabBtn.setBackgroundColor(if (glassMode) Color.parseColor("#FFD400") else Color.parseColor("#1E293B"))
        glassModeTabBtn.setTextColor(if (glassMode) Color.BLACK else Color.WHITE)
        labModeTabBtn.setBackgroundColor(if (!glassMode) Color.parseColor("#FFD400") else Color.parseColor("#1E293B"))
        labModeTabBtn.setTextColor(if (!glassMode) Color.BLACK else Color.WHITE)

        if (glassMode) {
            labControlsContainer.visibility = View.GONE
            historyScrollView.visibility = View.GONE
            glassSimulatorPanel.visibility = View.VISIBLE
            cameraTextureView.layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                190
            ).apply { setMargins(0, 0, 0, 10) }
        } else {
            glassSimulatorPanel.visibility = View.GONE
            labControlsContainer.visibility = View.VISIBLE
            historyScrollView.visibility = View.VISIBLE
            cameraTextureView.layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                250
            )
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun buildGlassWearableSimulatorPanel(): LinearLayout {
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }

        // 1. Glimmer-inspired Optical HUD Card (High-contrast latest guidance)
        val hudCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#080B10"))
            setPadding(22, 16, 22, 16)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { setMargins(0, 0, 0, 12) }
        }
        glassHudModeBadge = TextView(this).apply {
            text = "👓 GLIMMER HUD · Ready (Vol UP = Talk | Vol DOWN = Snap)"
            setTextColor(Color.parseColor("#38BDF8"))
            textSize = 11.5f
            typeface = Typeface.DEFAULT_BOLD
        }
        glassHudSpeechTv = TextView(this).apply {
            text = "Touch & Hold the Temple Touchpad below to ask a question, or Double-Tap to scan what is in front of you."
            setTextColor(Color.WHITE)
            textSize = 15.5f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(0, 8, 0, 0)
        }
        hudCard.addView(glassHudModeBadge)
        hudCard.addView(glassHudSpeechTv)

        // 2. Giant Eyes-Free Temple Touchpad Surface (Google Android XR AI Glasses Gesture Spec)
        val gestureDetector = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(e: MotionEvent): Boolean = true

            override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
                val isSpeaking = tts?.isSpeaking == true
                val activeRt = WayfindingNavigator.activeRoute
                if (isSpeaking) {
                    tts?.stop()
                    SpatialEarconSynthesizer.play(EarconKind.BARGE_IN_ACK)
                    glassTouchpadStatusTv.text = "✋ [Tap] Speech muted"
                } else if (activeRt != null && !activeRt.isConfirmedByUser) {
                    glassTouchpadStatusTv.text = "🚀 [Tap] Route confirmed — Live guidance ON"
                    startConfirmedMissionExecution()
                } else if (!lastSpokenText.isNullOrBlank()) {
                    glassTouchpadStatusTv.text = "🔁 [Tap] Repeating last guidance"
                    speakNative(lastSpokenText!!, autoListenAfter = false)
                } else {
                    glassTouchpadStatusTv.text = "📸 [Tap] Scanning current frame..."
                    runSingleInferenceStep()
                }
                return true
            }

            override fun onDoubleTap(e: MotionEvent): Boolean {
                tts?.stop()
                glassTouchpadStatusTv.text = "📸 [Double-Tap] Analyzing camera frame..."
                runSingleInferenceStep()
                return true
            }

            override fun onLongPress(e: MotionEvent) {
                isRecordingVoiceFeedback = false
                glassTouchpadStatusTv.text = "🎙️ [Touch & Hold] Listening — Speak now..."
                startInlineVoiceListening()
            }

            override fun onFling(
                e1: MotionEvent?,
                e2: MotionEvent,
                velocityX: Float,
                velocityY: Float
            ): Boolean {
                val dx = (e2.x - (e1?.x ?: e2.x))
                if (kotlin.math.abs(dx) > 90 && kotlin.math.abs(velocityX) > 150) {
                    val cands = WayfindingNavigator.lastSearchResult?.candidatesRecommended.orEmpty()
                    if (cands.isNotEmpty()) {
                        candidateSwipeCursor = if (dx > 0) {
                            (candidateSwipeCursor + 1) % cands.size
                        } else {
                            (candidateSwipeCursor - 1 + cands.size) % cands.size
                        }
                        val c = cands[candidateSwipeCursor]
                        val msg = "${c.index}번 후보: 대중교통 약 ${c.transitMinutes}분 거리인 ${c.spokenPlaceWithAddrKo}예요."
                        glassTouchpadStatusTv.text = "👉 [Swipe] Candidate #${c.index} (${c.name})"
                        speakNative(msg, autoListenAfter = false)
                    } else {
                        setAiToggleState(!aiEnabled)
                        glassTouchpadStatusTv.text = if (aiEnabled) "🟢 [Swipe] Live AI ON" else "🔴 [Swipe] Live AI OFF"
                    }
                    return true
                }
                return false
            }
        })

        val touchpadZone = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#1E293B"))
            setPadding(24, 34, 24, 34)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                340
            ).apply { setMargins(0, 0, 0, 12) }
            setOnTouchListener { _, event -> gestureDetector.onTouchEvent(event) }
        }
        val padTitle = TextView(this).apply {
            text = "👆 TEMPLE TOUCHPAD (Eyes-Free Gesture Zone)"
            setTextColor(Color.parseColor("#FFD400"))
            textSize = 14.5f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
        }
        val padGuide = TextView(this).apply {
            text = "• Single Tap: Mute Speech / Repeat / Confirm Route\n• Touch & Hold: 🎙️ Ask Lumo (Voice Query)\n• Double Tap: 📸 Instant Camera Snap\n• Swipe L/R: Cycle Candidates / Toggle Live AI\n• Hardware Vol UP: Talk | Vol DOWN: Snap (2x = Live AI)"
            setTextColor(Color.parseColor("#CBD5E1"))
            textSize = 12f
            gravity = Gravity.CENTER
            setPadding(0, 12, 0, 10)
        }
        glassTouchpadStatusTv = TextView(this).apply {
            text = "Ready"
            setTextColor(Color.parseColor("#00E676"))
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
        }
        touchpadZone.addView(padTitle)
        touchpadZone.addView(padGuide)
        touchpadZone.addView(glassTouchpadStatusTv)

        // 3. Hands-Free Instant Feedback Row
        val quickFbRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }
        val quickUpBtn = Button(this).apply {
            text = "👍 Good"
            textSize = 13.5f
            typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#065F46"))
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 0.85f).apply {
                setMargins(0, 0, 6, 0)
            }
            setOnClickListener {
                val id = latestEntryId
                if (id != null) {
                    syncExecutor.execute {
                        FeedbackLogStore.updateFeedback(this@MainActivity, id, vote = "UP")
                        FeedbackLogStore.trySyncToServerAsync(this@MainActivity)
                        runOnUiThread { renderHistoryList() }
                    }
                    SpatialEarconSynthesizer.play(EarconKind.TARGET_FOUND)
                    Toast.makeText(this@MainActivity, "👍 Marked Helpful!", Toast.LENGTH_SHORT).show()
                }
            }
        }
        val quickVoiceDownBtn = Button(this).apply {
            text = "👎 Bad (🎙️ Voice Note)"
            textSize = 13.5f
            typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#7F1D1D"))
            setTextColor(Color.parseColor("#FECACA"))
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.15f).apply {
                setMargins(6, 0, 0, 0)
            }
            setOnClickListener {
                val id = latestEntryId
                if (id == null) {
                    Toast.makeText(this@MainActivity, "No recent response to rate yet.", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                syncExecutor.execute {
                    FeedbackLogStore.updateFeedback(this@MainActivity, id, vote = "DOWN")
                    FeedbackLogStore.trySyncToServerAsync(this@MainActivity)
                }
                isRecordingVoiceFeedback = true
                glassTouchpadStatusTv.text = "📝 [Voice Feedback] Speak what went wrong..."
                startInlineVoiceListening()
            }
        }
        quickFbRow.addView(quickUpBtn)
        quickFbRow.addView(quickVoiceDownBtn)

        panel.addView(hudCard)
        panel.addView(touchpadZone)
        panel.addView(quickFbRow)
        return panel
    }

    private fun updateGlassHudBanner(modeTag: String, latencyMs: Long, spoken: String) {
        if (!::glassHudModeBadge.isInitialized) return
        glassHudModeBadge.text = "👓 [$modeTag] · ${latencyMs}ms"
        glassHudSpeechTv.text = spoken
    }

    /**
     * Hardware Button Mapping in `👓 글래스 실착용 모드` (Simulates Google Android XR AI Glasses side buttons):
     * - Physical Volume UP -> Immediate Barge-in + Push-to-Talk Voice Query (`Invoke AI`)
     * - Physical Volume DOWN (Single press) -> Instant 1-Frame Camera Vision Snap
     * - Physical Volume DOWN (Double press < 450ms) -> `TOGGLE_APP_CAMERA` Continuous Companion ON/OFF
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (isGlassWearableMode && event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_VOLUME_UP -> {
                    isRecordingVoiceFeedback = false
                    glassTouchpadStatusTv.text = "🎙️ [Vol UP] Listening — Ask Lumo now..."
                    startInlineVoiceListening()
                    return true
                }
                KeyEvent.KEYCODE_VOLUME_DOWN -> {
                    val now = System.currentTimeMillis()
                    if (now - lastVolDownPressMs < 450L) {
                        setAiToggleState(!aiEnabled)
                        glassTouchpadStatusTv.text = if (aiEnabled) "🟢 [2x Vol DOWN] Live AI ON" else "🔴 [2x Vol DOWN] Live AI OFF"
                        lastVolDownPressMs = 0L
                    } else {
                        lastVolDownPressMs = now
                        tts?.stop()
                        glassTouchpadStatusTv.text = "📸 [Vol DOWN] Analyzing camera frame..."
                        runSingleInferenceStep()
                    }
                    return true
                }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun renderUseCaseCategoryTabsAndChips() {
        categoryTabRow.removeAllViews()
        quickChipRow.removeAllViews()

        val activeCat = useCaseCategories.find { it.id == activeCategoryId } ?: useCaseCategories.first()
        NativeLumoAiClient.selectedUseCaseCategory = activeCat.id
        if (::missionInput.isInitialized) {
            missionInput.hint = activeCat.inputHint
        }

        for (cat in useCaseCategories) {
            val isSelected = cat.id == activeCat.id
            val tabBtn = Button(this).apply {
                text = cat.title
                textSize = 12.5f
                typeface = Typeface.DEFAULT_BOLD
                setPadding(24, 10, 24, 10)
                setBackgroundColor(if (isSelected) Color.parseColor("#FFD400") else Color.parseColor("#1E293B"))
                setTextColor(if (isSelected) Color.BLACK else Color.WHITE)
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply {
                    setMargins(0, 0, 8, 0)
                }
                setOnClickListener {
                    activeCategoryId = cat.id
                    renderUseCaseCategoryTabsAndChips()
                }
            }
            categoryTabRow.addView(tabBtn)
        }

        for (chip in activeCat.chips) {
            val chipBtn = Button(this).apply {
                text = chip.label
                textSize = 12f
                setPadding(22, 8, 22, 8)
                setBackgroundColor(Color.parseColor("#0F172A"))
                setTextColor(Color.parseColor("#38BDF8"))
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply {
                    setMargins(0, 0, 8, 0)
                }
                setOnClickListener {
                    tts?.stop()
                    runSingleInferenceStep(userQuery = chip.promptQuery)
                }
            }
            quickChipRow.addView(chipBtn)
        }
    }

    private fun logDialogueTurnAsFeedbackCard(
        modeTag: String,
        modeLabelKo: String,
        userCommand: String,
        agentSpoken: String,
        latencyMs: Long = 120L
    ) {
        val frameB64 = grabCurrentCameraFrame().base64Jpeg
        val displaySpoken = if (userCommand.isNotBlank()) {
            "[내 명령: $userCommand] → $agentSpoken"
        } else {
            agentSpoken
        }
        val replyObj = NativeLumoAiClient.AutoAiReply(
            ok = true,
            model = "lumo-dialogue-agent",
            detectedModeTag = modeTag,
            detectedModeLabelKo = modeLabelKo,
            activeWindowSummary = modeTag,
            earconKind = EarconKind.TARGET_FOUND,
            spokenKorean = displaySpoken,
            latencyMs = latencyMs
        )
        syncExecutor.execute {
            val saved = FeedbackLogStore.addEntry(this, replyObj, frameB64)
            runOnUiThread {
                latestEntryId = saved.id
                updateGlassHudBanner(modeTag, latencyMs, agentSpoken)
                prependEntryCard(saved)
            }
            FeedbackLogStore.trySyncToServerAsync(this)
        }
    }

    private fun searchDestinationAndPromptUser(query: String) {
        // Phase 1 of User Journey: Pause camera micro-guidance while conversing to set & confirm the mission!
        if (aiEnabled) {
            setAiToggleState(false)
        }
        val t0 = System.currentTimeMillis()
        SpatialEarconSynthesizer.play(EarconKind.SCANNING_TICK)
        candidateConfirmBox.removeAllViews()
        candidateConfirmBox.visibility = View.VISIBLE

        val loadingTv = TextView(this).apply {
            text = "⏳ Locating GPS origin & searching '$query'..."
            setTextColor(Color.parseColor("#FFD400"))
            textSize = 13.5f
        }
        candidateConfirmBox.addView(loadingTv)

        ioExecutor.execute {
            val searchRes = WayfindingNavigator.searchDestinationCandidates(query)
            val elapsed = System.currentTimeMillis() - t0
            runOnUiThread {
                renderSearchCandidateConfirmationUi(query, searchRes, sortByDistance = false)
                SpatialEarconSynthesizer.play(EarconKind.TARGET_FOUND)
                speakNative(searchRes.spokenConfirmationPromptKo, autoListenAfter = true)
                logDialogueTurnAsFeedbackCard(
                    modeTag = "DESTINATION_SEARCH",
                    modeLabelKo = "목적지 후보 검색 (${searchRes.candidatesRecommended.size}건)",
                    userCommand = "$query 검색",
                    agentSpoken = searchRes.spokenConfirmationPromptKo,
                    latencyMs = elapsed
                )
            }
        }
    }

    private fun renderSearchCandidateConfirmationUi(
        query: String,
        searchRes: WayfindingNavigator.SearchCandidatesResult,
        sortByDistance: Boolean
    ) {
        candidateConfirmBox.removeAllViews()

        val originTv = TextView(this).apply {
            text = "📍 Origin: ${searchRes.originAddressKo}\nSelect Destination (Recommended vs. Closest)"
            setTextColor(Color.parseColor("#FFD400"))
            textSize = 13.5f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(0, 0, 0, 10)
        }
        candidateConfirmBox.addView(originTv)

        val sortTabRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, 10)
            }
        }

        val recTabBtn = Button(this).apply {
            text = "⭐ Recommended"
            textSize = 12.5f
            typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(if (!sortByDistance) Color.parseColor("#FFD400") else Color.parseColor("#334155"))
            setTextColor(if (!sortByDistance) Color.BLACK else Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(0, 0, 6, 0)
            }
            setOnClickListener {
                renderSearchCandidateConfirmationUi(query, searchRes, sortByDistance = false)
            }
        }

        val distTabBtn = Button(this).apply {
            text = "📏 Closest"
            textSize = 12.5f
            typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(if (sortByDistance) Color.parseColor("#FFD400") else Color.parseColor("#334155"))
            setTextColor(if (sortByDistance) Color.BLACK else Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(6, 0, 0, 0)
            }
            setOnClickListener {
                renderSearchCandidateConfirmationUi(query, searchRes, sortByDistance = true)
            }
        }

        sortTabRow.addView(recTabBtn)
        sortTabRow.addView(distTabBtn)
        candidateConfirmBox.addView(sortTabRow)

        val activeList = if (sortByDistance) searchRes.candidatesByDistance else searchRes.candidatesRecommended
        for (cand in activeList) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply {
                    setMargins(0, 5, 0, 5)
                }
            }

            val transitBtn = Button(this).apply {
                text = "🚇 #${cand.index}: ${cand.spokenPlaceWithAddrKo}\n(Transit ~${cand.transitMinutes}m · ${cand.distanceMeters}m)"
                textSize = 12f
                setBackgroundColor(Color.parseColor("#00E676"))
                setTextColor(Color.BLACK)
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.4f).apply {
                    setMargins(0, 0, 6, 0)
                }
                setOnClickListener {
                    confirmCandidateAndStartNavigation(
                        originAddressKo = searchRes.originAddressKo,
                        originLat = searchRes.originLat,
                        originLng = searchRes.originLng,
                        candidate = cand,
                        preferTransit = true
                    )
                }
            }

            val walkBtn = Button(this).apply {
                text = "🚶 Walk (${cand.walkMinutes}m)"
                textSize = 12f
                setBackgroundColor(Color.parseColor("#FFD400"))
                setTextColor(Color.BLACK)
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 0.7f)
                setOnClickListener {
                    confirmCandidateAndStartNavigation(
                        originAddressKo = searchRes.originAddressKo,
                        originLat = searchRes.originLat,
                        originLng = searchRes.originLng,
                        candidate = cand,
                        preferTransit = false
                    )
                }
            }

            row.addView(transitBtn)
            row.addView(walkBtn)
            candidateConfirmBox.addView(row)
        }

        val cancelBtn = Button(this).apply {
            text = "❌ Cancel Search"
            textSize = 12.5f
            setBackgroundColor(Color.parseColor("#334155"))
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 6, 0, 0)
            }
            setOnClickListener {
                candidateConfirmBox.visibility = View.GONE
            }
        }
        candidateConfirmBox.addView(cancelBtn)
    }

    /**
     * Phase 2 of User Journey (Fixes LUM-53):
     * Builds the full Macro Route Plan (walk + bus/subway + transfers + total time) and presents it
     * to the user for explicit confirmation BEFORE starting real-time camera micro-guidance!
     */
    private fun confirmCandidateAndStartNavigation(
        originAddressKo: String,
        originLat: Double,
        originLng: Double,
        candidate: PoiCandidate,
        preferTransit: Boolean = candidate.distanceMeters >= 500,
        preferSubwayOnly: Boolean = true,
        conversationalPrefixKo: String = ""
    ) {
        if (aiEnabled) {
            setAiToggleState(false)
        }
        tts?.stop()
        val t0 = System.currentTimeMillis()
        candidateConfirmBox.removeAllViews()
        candidateConfirmBox.visibility = View.VISIBLE
        val modeStr = when {
            !preferTransit -> "도보 전용"
            preferSubwayOnly -> "지하철 노선+도보"
            else -> "버스/대중교통+도보"
        }
        val loadingTv = TextView(this).apply {
            text = "⏳ Building Macro Route Plan to '${candidate.name}'..."
            setTextColor(Color.parseColor("#FFD400"))
            textSize = 13.5f
        }
        candidateConfirmBox.addView(loadingTv)

        ioExecutor.execute {
            val (route, macroPlanSpeech) = WayfindingNavigator.confirmAndBuildRoute(
                originAddressKo = originAddressKo,
                originLat = originLat,
                originLng = originLng,
                candidate = candidate,
                preferTransit = preferTransit,
                preferSubwayOnly = preferSubwayOnly
            )
            val finalSpeech = if (conversationalPrefixKo.isNotBlank()) {
                "$conversationalPrefixKo $macroPlanSpeech"
            } else {
                macroPlanSpeech
            }
            val elapsed = System.currentTimeMillis() - t0
            runOnUiThread {
                renderMacroPlanConfirmationUi(route, preferTransit, preferSubwayOnly)
                SpatialEarconSynthesizer.play(EarconKind.TARGET_FOUND)
                speakNative(finalSpeech, autoListenAfter = true)
                logDialogueTurnAsFeedbackCard(
                    modeTag = "MACRO_ROUTE_PLAN",
                    modeLabelKo = "전체 이동 계획 브리핑 ($modeStr)",
                    userCommand = "${candidate.name} ($modeStr)",
                    agentSpoken = finalSpeech,
                    latencyMs = elapsed
                )
            }
        }
    }

    private fun renderMacroPlanConfirmationUi(
        route: ActivePedestrianRoute,
        preferTransit: Boolean = true,
        preferSubwayOnly: Boolean = true
    ) {
        candidateConfirmBox.removeAllViews()
        candidateConfirmBox.visibility = View.VISIBLE

        val titleTv = TextView(this).apply {
            text = "🗺️ Macro Route Plan (${route.originAddressKo} → ${route.destination.name})"
            setTextColor(Color.parseColor("#FFD400"))
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(0, 0, 0, 8)
        }
        candidateConfirmBox.addView(titleTv)

        val modeSwitchRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, 10)
            }
        }

        val subModeBtn = Button(this).apply {
            text = "🚇 Subway"
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            val active = preferTransit && preferSubwayOnly
            setBackgroundColor(if (active) Color.parseColor("#FFD400") else Color.parseColor("#334155"))
            setTextColor(if (active) Color.BLACK else Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(0, 0, 4, 0)
            }
            setOnClickListener {
                confirmCandidateAndStartNavigation(
                    originAddressKo = route.originAddressKo,
                    originLat = route.originLat,
                    originLng = route.originLng,
                    candidate = route.destination,
                    preferTransit = true,
                    preferSubwayOnly = true,
                    conversationalPrefixKo = "네, 버스 대신 지하철 노선 계획으로 바꿔 드릴게요."
                )
            }
        }

        val busModeBtn = Button(this).apply {
            text = "🚌 Bus"
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            val active = preferTransit && !preferSubwayOnly
            setBackgroundColor(if (active) Color.parseColor("#FFD400") else Color.parseColor("#334155"))
            setTextColor(if (active) Color.BLACK else Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(4, 0, 4, 0)
            }
            setOnClickListener {
                confirmCandidateAndStartNavigation(
                    originAddressKo = route.originAddressKo,
                    originLat = route.originLat,
                    originLng = route.originLng,
                    candidate = route.destination,
                    preferTransit = true,
                    preferSubwayOnly = false,
                    conversationalPrefixKo = "네, 버스 대중교통 계획으로 바꿔 드릴게요."
                )
            }
        }

        val walkModeBtn = Button(this).apply {
            text = "🚶 Walk Only"
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            val active = !preferTransit
            setBackgroundColor(if (active) Color.parseColor("#FFD400") else Color.parseColor("#334155"))
            setTextColor(if (active) Color.BLACK else Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(4, 0, 0, 0)
            }
            setOnClickListener {
                confirmCandidateAndStartNavigation(
                    originAddressKo = route.originAddressKo,
                    originLat = route.originLat,
                    originLng = route.originLng,
                    candidate = route.destination,
                    preferTransit = false,
                    preferSubwayOnly = false,
                    conversationalPrefixKo = "네, 걸어서 이동하는 도보 전용 계획으로 바꿔 드릴게요."
                )
            }
        }

        modeSwitchRow.addView(subModeBtn)
        modeSwitchRow.addView(busModeBtn)
        modeSwitchRow.addView(walkModeBtn)
        candidateConfirmBox.addView(modeSwitchRow)

        val summaryTv = TextView(this).apply {
            text = route.macroPlanOverviewKo
            setTextColor(Color.WHITE)
            textSize = 13.5f
            setPadding(0, 0, 0, 10)
        }
        candidateConfirmBox.addView(summaryTv)

        for (ms in route.macroMilestones) {
            val msTv = TextView(this).apply {
                text = "  • $ms"
                setTextColor(Color.parseColor("#00E676"))
                textSize = 12.8f
                setPadding(0, 2, 0, 2)
            }
            candidateConfirmBox.addView(msTv)
        }

        val startBtn = Button(this).apply {
            text = "🚀 Confirm & Start Live Guidance"
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#00E676"))
            setTextColor(Color.BLACK)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 12, 0, 6)
            }
            setOnClickListener {
                startConfirmedMissionExecution()
            }
        }
        candidateConfirmBox.addView(startBtn)

        val backBtn = Button(this).apply {
            text = "🔄 Choose Another Candidate"
            textSize = 12.5f
            setBackgroundColor(Color.parseColor("#334155"))
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 4, 0, 0)
            }
            setOnClickListener {
                val lastSearch = WayfindingNavigator.lastSearchResult
                if (lastSearch != null) {
                    renderSearchCandidateConfirmationUi(missionInput.text.toString(), lastSearch, sortByDistance = false)
                } else {
                    candidateConfirmBox.visibility = View.GONE
                }
            }
        }
        candidateConfirmBox.addView(backBtn)
    }

    private fun startConfirmedMissionExecution() {
        val startSpeech = WayfindingNavigator.activateConfirmedRoute()
        candidateConfirmBox.visibility = View.GONE
        updateActiveNavBannerUi()
        aiEnabled = true
        aiToggleBtn.text = "🟢 Live AI: ON"
        aiToggleBtn.setBackgroundColor(Color.parseColor("#00E676"))
        aiToggleBtn.setTextColor(Color.BLACK)
        openRearCamera()
        SpatialEarconSynthesizer.play(EarconKind.SIGNAL_GREEN)
        speakNative(startSpeech)
        logDialogueTurnAsFeedbackCard(
            modeTag = "MISSION_STARTED",
            modeLabelKo = "미션 출발 확정 및 동행 시작",
            userCommand = "응 출발하자",
            agentSpoken = startSpeech,
            latencyMs = 50L
        )
        mainHandler.removeCallbacks(realtimeLoopRunnable)
        mainHandler.postDelayed(realtimeLoopRunnable, 1200L)
    }

    private fun updateActiveNavBannerUi() {
        val route = WayfindingNavigator.activeRoute
        if (route == null) {
            activeNavBanner.visibility = View.GONE
            return
        }
        val liveCtx = WayfindingNavigator.buildLiveNavContextForPrompt()
        activeNavBanner.visibility = View.VISIBLE
        activeNavBanner.text = "🧭 $liveCtx"
    }

    @SuppressLint("MissingPermission")
    private fun startGpsAndCompassTracking() {
        try {
            locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
            val hasFine = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            val hasCoarse = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
            if (hasFine || hasCoarse) {
                val providers = listOf("fused", LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER)
                var bestLoc: Location? = null
                for (p in providers) {
                    try {
                        val loc = locationManager?.getLastKnownLocation(p) ?: continue
                        if (bestLoc == null || loc.time > bestLoc.time) {
                            bestLoc = loc
                        }
                    } catch (_: Exception) {}
                }
                if (bestLoc != null) {
                    WayfindingNavigator.currentLat = bestLoc.latitude
                    WayfindingNavigator.currentLng = bestLoc.longitude
                    WayfindingNavigator.hasGpsFix = true
                }
                for (p in listOf("fused", LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
                    try {
                        locationManager?.requestLocationUpdates(p, 2500L, 2f, gpsListener, Looper.getMainLooper())
                    } catch (_: Exception) {}
                }
            }
        } catch (_: Exception) {}

        try {
            sensorManager = getSystemService(Context.SENSOR_SERVICE) as SensorManager
            val rotSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
            if (rotSensor != null) {
                sensorManager?.registerListener(this, rotSensor, SensorManager.SENSOR_DELAY_UI)
            }
        } catch (_: Exception) {}
    }

    override fun onSensorChanged(event: SensorEvent?) {
        if (event?.sensor?.type == Sensor.TYPE_ROTATION_VECTOR) {
            val rotMatrix = FloatArray(9)
            val orientation = FloatArray(3)
            SensorManager.getRotationMatrixFromVector(rotMatrix, event.values)
            SensorManager.getOrientation(rotMatrix, orientation)
            val azimuthDeg = ((Math.toDegrees(orientation[0].toDouble()).toFloat()) + 360f) % 360f
            WayfindingNavigator.currentCompassHeadingDeg = azimuthDeg
            WayfindingNavigator.hasCompassFix = true
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    private fun setAiToggleState(enabled: Boolean) {
        aiEnabled = enabled
        mainHandler.removeCallbacks(realtimeLoopRunnable)

        if (aiEnabled) {
            aiToggleBtn.text = "🟢 Live AI: ON"
            aiToggleBtn.setBackgroundColor(Color.parseColor("#00E676"))
            aiToggleBtn.setTextColor(Color.BLACK)
            openRearCamera()
            SpatialEarconSynthesizer.play(EarconKind.SIGNAL_GREEN)
            runSingleInferenceStep(userQuery = "")
            mainHandler.postDelayed(realtimeLoopRunnable, REALTIME_INTERVAL_MS)
        } else {
            aiToggleBtn.text = "🔴 Live AI: OFF"
            aiToggleBtn.setBackgroundColor(Color.parseColor("#3B1219"))
            aiToggleBtn.setTextColor(Color.parseColor("#FFD7D7"))
            stopInlineVoiceListening()
            tts?.stop()
            SpatialEarconSynthesizer.play(EarconKind.BARGE_IN_ACK)
        }
    }

    private fun startInlineVoiceListening() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestRuntimePermissionsIfNeeded()
            return
        }
        inferenceEpoch += 1
        requestInFlight = false
        mainHandler.removeCallbacks(realtimeLoopRunnable)
        tts?.stop()
        SpatialEarconSynthesizer.play(EarconKind.SCANNING_TICK)

        try {
            if (speechRecognizer == null) {
                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this).apply {
                    setRecognitionListener(object : RecognitionListener {
                        override fun onReadyForSpeech(params: Bundle?) {
                            isListeningMic = true
                            talkMicBtn.text = "👂 Listening..."
                            talkMicBtn.setBackgroundColor(Color.parseColor("#FFD400"))
                            talkMicBtn.setTextColor(Color.BLACK)
                            if (::glassTouchpadStatusTv.isInitialized && !isRecordingVoiceFeedback) {
                                glassTouchpadStatusTv.text = "👂 Mic Active — Speak your question or destination!"
                            }
                        }
                        override fun onBeginningOfSpeech() {}
                        override fun onRmsChanged(rmsdB: Float) {}
                        override fun onBufferReceived(buffer: ByteArray?) {}
                        override fun onEndOfSpeech() {
                            isListeningMic = false
                            talkMicBtn.text = "🎙️ Push-to-Talk"
                            talkMicBtn.setBackgroundColor(Color.parseColor("#1E293B"))
                            talkMicBtn.setTextColor(Color.parseColor("#FFD400"))
                        }
                        override fun onError(error: Int) {
                            isListeningMic = false
                            talkMicBtn.text = "🎙️ Push-to-Talk"
                            talkMicBtn.setBackgroundColor(Color.parseColor("#1E293B"))
                            talkMicBtn.setTextColor(Color.parseColor("#FFD400"))
                            if (error == SpeechRecognizer.ERROR_CLIENT || error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                                launchSystemVoiceFallbackDialog()
                            } else if (::glassTouchpadStatusTv.isInitialized) {
                                glassTouchpadStatusTv.text = "⚠️ Didn't catch that — Try holding or tapping Vol UP again"
                            }
                        }
                        override fun onResults(results: Bundle?) {
                            isListeningMic = false
                            talkMicBtn.text = "🎙️ Push-to-Talk"
                            talkMicBtn.setBackgroundColor(Color.parseColor("#1E293B"))
                            talkMicBtn.setTextColor(Color.parseColor("#FFD400"))
                            val spoken = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                                ?.firstOrNull()?.trim() ?: return
                            processRecognizedSpeech(spoken)
                        }
                        override fun onPartialResults(partialResults: Bundle?) {
                            val partial = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                                ?.firstOrNull()?.trim()
                            if (!partial.isNullOrBlank() && ::glassTouchpadStatusTv.isInitialized) {
                                glassTouchpadStatusTv.text = "👂 Hearing: \"$partial\""
                            }
                        }
                        override fun onEvent(eventType: Int, params: Bundle?) {}
                    })
                }
            }

            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ko-KR")
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            }
            speechRecognizer?.cancel()
            speechRecognizer?.startListening(intent)
        } catch (_: Exception) {
            launchSystemVoiceFallbackDialog()
        }
    }

    private fun launchSystemVoiceFallbackDialog() {
        try {
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ko-KR")
                putExtra(RecognizerIntent.EXTRA_PROMPT, if (isRecordingVoiceFeedback) "Speak your feedback note" else "Ask Lumo or say a destination")
            }
            startActivityForResult(intent, REQ_VOICE_FALLBACK)
        } catch (_: Exception) {}
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_VOICE_FALLBACK && resultCode == RESULT_OK) {
            val spoken = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.trim()
            if (!spoken.isNullOrBlank()) {
                processRecognizedSpeech(spoken)
            }
        }
    }

    private fun processRecognizedSpeech(spoken: String) {
        if (isRecordingVoiceFeedback) {
            isRecordingVoiceFeedback = false
            val targetId = latestEntryId
            if (targetId != null) {
                syncExecutor.execute {
                    FeedbackLogStore.updateFeedback(
                        context = this@MainActivity,
                        id = targetId,
                        vote = "DOWN",
                        feedbackText = spoken
                    )
                    FeedbackLogStore.trySyncToServerAsync(this@MainActivity)
                    runOnUiThread { renderHistoryList() }
                }
                glassTouchpadStatusTv.text = "✅ Voice Note Saved: \"$spoken\""
                speakNative("피드백 메모를 저장했어요.", autoListenAfter = false)
            }
            return
        }

        glassTouchpadStatusTv.text = "🗣️ Heard: \"$spoken\" → Thinking..."
        handleUserSpokenConversation(spoken)
    }

    private fun stopInlineVoiceListening() {
        isListeningMic = false
        try { speechRecognizer?.cancel() } catch (_: Exception) {}
        talkMicBtn.text = "🎙️ Push-to-Talk"
        talkMicBtn.setBackgroundColor(Color.parseColor("#1E293B"))
        talkMicBtn.setTextColor(Color.parseColor("#FFD400"))
    }

    /**
     * Handles natural user speech:
     * 1. If destination candidates are currently waiting for confirmation and user says "1번", "첫 번째", "에브리데이", "역삼점", confirms that candidate!
     * 2. If user says "이마트 가자" / "강남역 안내해줘", runs TMAP destination search!
     * 3. Otherwise sends the user's question + live camera frame into the multi-turn conversational Gemini agent!
     */
    private fun handleUserSpokenConversation(spoken: String) {
        tts?.stop()
        if (spoken.contains("그만") || spoken.contains("멈춰") || spoken.contains("조용")) {
            return
        }

        // UC-15: Register expected taxi plate when user types/says "택시 34바 5678" or "장콜 12가 3456"
        val taxiMatch = Regex("(?:택시|장콜|차량|번호판?)\\s*(\\d{2,3}\\s*[가-힣]\\s*\\d{4})").find(spoken)
        if (taxiMatch != null) {
            val plate = taxiMatch.groupValues[1].trim()
            NativeLumoAiClient.expectedTaxiPlate = plate
            val msg = "호출하신 차량 번호 $plate 번을 등록했어요. 이제 진입하는 차량을 카메라로 비추시면 번호판과 뒷좌석 문 손잡이 위치를 안내해 드릴게요."
            speakNative(msg)
            logDialogueTurnAsFeedbackCard("TAXI_REGISTERED", "호출 택시 번호 등록 ($plate)", spoken, msg)
            return
        }

        // LUM-68, LUM-69, LUM-70: If user says "아니 지하철 탄다고" / "아니 지하철로 대중교통" / "버스 말고 지하철"
        // while a destination route or search is active, switch the transport mode of the active mission instead of hallucinating a POI or describing the floor!
        val activeRt = WayfindingNavigator.activeRoute
        val lastSearch = WayfindingNavigator.lastSearchResult
        val targetDest: PoiCandidate? = activeRt?.destination ?: lastSearch?.candidatesRecommended?.firstOrNull()
        val originAddr: String = activeRt?.originAddressKo ?: lastSearch?.originAddressKo ?: WayfindingNavigator.reverseGeocodeOrigin(WayfindingNavigator.currentLat, WayfindingNavigator.currentLng)
        val oLat = activeRt?.originLat ?: lastSearch?.originLat ?: WayfindingNavigator.currentLat
        val oLng = activeRt?.originLng ?: lastSearch?.originLng ?: WayfindingNavigator.currentLng

        val cleanedPlaceCandidate = WayfindingNavigator.extractCleanPlaceQuery(spoken)
        val isTransportSwitchUtterance =
            Regex("지하철|버스|도보|걸어서|노선").containsMatchIn(spoken) &&
                (cleanedPlaceCandidate.isEmpty() || spoken.startsWith("아니") || spoken.contains("말고") || spoken.contains("탄다고") || spoken.contains("탈래"))

        if (isTransportSwitchUtterance && targetDest != null) {
            when {
                spoken.contains("지하철") || spoken.contains("노선") -> {
                    confirmCandidateAndStartNavigation(
                        originAddressKo = originAddr,
                        originLat = oLat,
                        originLng = oLng,
                        candidate = targetDest,
                        preferTransit = true,
                        preferSubwayOnly = true,
                        conversationalPrefixKo = "아, 버스를 타지 않고 지하철로 이동하시겠어요? 바로 ${targetDest.name}까지 가는 지하철 노선 계획으로 바꿔 드릴게요."
                    )
                    return
                }
                spoken.contains("버스") -> {
                    confirmCandidateAndStartNavigation(
                        originAddressKo = originAddr,
                        originLat = oLat,
                        originLng = oLng,
                        candidate = targetDest,
                        preferTransit = true,
                        preferSubwayOnly = false,
                        conversationalPrefixKo = "네, ${targetDest.name}까지 버스로 이동하는 대중교통 계획으로 바꿔 드릴게요."
                    )
                    return
                }
                spoken.contains("도보") || spoken.contains("걸어서") -> {
                    confirmCandidateAndStartNavigation(
                        originAddressKo = originAddr,
                        originLat = oLat,
                        originLng = oLng,
                        candidate = targetDest,
                        preferTransit = false,
                        preferSubwayOnly = false,
                        conversationalPrefixKo = "네, 대중교통을 타지 않고 걸어서 이동하는 도보 계획으로 바꿔 드릴게요."
                    )
                    return
                }
            }
        }

        // If awaiting Phase 2 Macro Plan confirmation ("이 계획대로 출발할까요?") and user says "응/출발/좋아/네/시작"
        val currentRoute = WayfindingNavigator.activeRoute
        if (currentRoute != null && !currentRoute.isConfirmedByUser && candidateConfirmBox.visibility == View.VISIBLE) {
            if (Regex("^(?:응|네|좋아|출발|시작|그렇게|오케이|그래)").containsMatchIn(spoken.trim())) {
                startConfirmedMissionExecution()
                return
            }
        }

        val pendingSearch = WayfindingNavigator.lastSearchResult
        if (pendingSearch != null && candidateConfirmBox.visibility == View.VISIBLE) {
            val cands = pendingSearch.candidatesRecommended
            val numMatch = Regex("(\\d+)\\s*번").find(spoken)?.groupValues?.get(1)?.toIntOrNull()
            val matchedCand = when {
                numMatch != null -> cands.getOrNull(numMatch - 1)
                spoken.contains("첫") -> cands.getOrNull(0)
                spoken.contains("두") -> cands.getOrNull(1)
                spoken.contains("세") -> cands.getOrNull(2)
                else -> cands.find { spoken.contains(it.name) || (spoken.contains("에브리데이") && it.name.contains("에브리데이")) }
            }
            if (matchedCand != null) {
                val wantWalkOnly = spoken.contains("도보") || spoken.contains("걸어서")
                val wantTransit = spoken.contains("대중교통") || spoken.contains("지하철") || spoken.contains("버스") || (!wantWalkOnly && matchedCand.distanceMeters >= 500)
                confirmCandidateAndStartNavigation(
                    originAddressKo = pendingSearch.originAddressKo,
                    originLat = pendingSearch.originLat,
                    originLng = pendingSearch.originLng,
                    candidate = matchedCand,
                    preferTransit = wantTransit
                )
                return
            }
        }

        val navTrigger = Regex("(.+?)(?:으로|로)?\\s*(?:가자|안내해|안내해줘|길찾기|찾아줘|갈래|가고\\s*싶어|가는\\s*길|바꿔|바꿔줘|바꿀래|변경|변경해줘)").find(spoken)
        if (navTrigger != null) {
            val placeKeyword = WayfindingNavigator.extractCleanPlaceQuery(navTrigger.groupValues[1])
            if (placeKeyword.length >= 2) {
                WayfindingNavigator.clearRoute()
                searchDestinationAndPromptUser(placeKeyword)
                return
            }
        }

        // LUM-135, LUM-137, LUM-138: If user interrupted with "그냥 컴포즈 커피 홍제 폭포", "아니 포자랩스", "목적지 포자랩스"
        if (Regex("^(?:그냥|다시|아니|목적지)\\s+").containsMatchIn(spoken.trim()) && cleanedPlaceCandidate.length >= 2 && !spoken.contains("?")) {
            WayfindingNavigator.clearRoute()
            searchDestinationAndPromptUser(cleanedPlaceCandidate)
            return
        }

        // If user just typed a station or place name directly (e.g. "구의역", "이마트")
        if (spoken.endsWith("역") || spoken.contains("이마트") || spoken.contains("마트") || spoken.contains("백화점") || spoken.contains("약국") || spoken.contains("병원")) {
            if (spoken.length <= 12 && !spoken.contains("?")) {
                searchDestinationAndPromptUser(spoken)
                return
            }
        }

        runSingleInferenceStep(userQuery = spoken)
    }

    private data class CapturedFrameResult(
        val base64Jpeg: String?,
        val isTooDark: Boolean,
        val isLowLightZone: Boolean,
        val hasHighGlare: Boolean
    )

    private fun analyzeFrameLuminance(bmp: Bitmap): Triple<Boolean, Boolean, Boolean> {
        var sumLum = 0L
        var glarePixels = 0
        var count = 0
        val stepX = maxOf(1, bmp.width / 12)
        val stepY = maxOf(1, bmp.height / 12)
        for (y in 0 until bmp.height step stepY) {
            for (x in 0 until bmp.width step stepX) {
                val px = bmp.getPixel(x, y)
                val r = (px shr 16) and 0xFF
                val g = (px shr 8) and 0xFF
                val b = px and 0xFF
                val lum = (r * 299 + g * 587 + b * 114) / 1000
                sumLum += lum
                if (lum >= 242) glarePixels++
                count++
            }
        }
        val avgLum = if (count > 0) sumLum / count else 0L
        val glareRatio = if (count > 0) glarePixels.toFloat() / count else 0f
        val isTooDark = avgLum < 12L
        val isLowLight = avgLum in 12L..52L // UC-18: Night blindness / sudden indoor dark adaptation zone
        val hasHighGlare = glareRatio >= 0.32f // UC-19: Strong backlight / LED glare white-out zone
        return Triple(isTooDark, isLowLight, hasHighGlare)
    }

    private fun grabCurrentCameraFrame(): CapturedFrameResult {
        if (!cameraTextureView.isAvailable) return CapturedFrameResult(null, false, false, false)
        val bmp: Bitmap = cameraTextureView.getBitmap(320, 240) ?: return CapturedFrameResult(null, false, false, false)
        val (tooDark, lowLight, highGlare) = analyzeFrameLuminance(bmp)
        val baos = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 52, baos)
        val b64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
        return CapturedFrameResult(b64, tooDark, lowLight, highGlare)
    }

    private fun runSingleInferenceStep(userQuery: String = "") {
        // LUM-142 & LUM-144: NEVER drop an explicit user voice/text query even if a background vision request was in flight!
        if (userQuery.isBlank() && (requestInFlight || isListeningMic)) return
        if (userQuery.isNotBlank()) {
            inferenceEpoch += 1
        }
        val myEpoch = inferenceEpoch
        requestInFlight = true

        updateActiveNavBannerUi()
        val captured = grabCurrentCameraFrame()
        if (captured.isTooDark && userQuery.isBlank()) {
            requestInFlight = false
            val darkReply = NativeLumoAiClient.AutoAiReply(
                ok = true,
                model = "on-device-luminance-guard",
                detectedModeTag = "DARK_FRAME",
                detectedModeLabelKo = "카메라 가림 · 어두움 감지",
                activeWindowSummary = "DARK_GUARD",
                earconKind = EarconKind.SCANNING_TICK,
                spokenKorean = "카메라 화면이 너무 어둡거나 가려져 있어요. 렌즈 앞을 한번 확인해 주실래요?",
                latencyMs = 5L
            )
            val saved = FeedbackLogStore.addEntry(this, darkReply, captured.base64Jpeg)
            if (aiEnabled) {
                speakNative(darkReply.spokenKorean)
            }
            prependEntryCard(saved)
            return
        }

        SpatialEarconSynthesizer.play(EarconKind.SCANNING_TICK)

        val lightingHint = when {
            captured.isLowLightZone -> " (현재 어두운 저조도 구간 진입: 바닥 평탄도와 난간/벽면 동선을 안심할 수 있게 설명해 주세요)"
            captured.hasHighGlare -> " (현재 역광/빛번짐 눈부심 구간: 저시력자가 읽기 힘든 전광판·표지판·신호등 글자를 대신 정확히 읽어 주세요)"
            else -> ""
        }

        ioExecutor.execute {
            val reply = NativeLumoAiClient.analyzeAutoSceneFlashLite(
                userQuery = (userQuery + lightingHint).trim(),
                imageBase64Jpeg = captured.base64Jpeg,
                previousSpeech = lastSpokenText
            )

            // Zero-Wait TTS: Speak and update UI IMMEDIATELY on main thread before disk write or server sync!
            runOnUiThread {
                // Discard stale background camera response if user interrupted with mic/question while it was in flight!
                if (myEpoch != inferenceEpoch) {
                    return@runOnUiThread
                }
                requestInFlight = false
                val displaySpoken = if (userQuery.isNotBlank() && !userQuery.startsWith("(")) {
                    "[Query: $userQuery] → ${reply.spokenKorean}"
                } else {
                    reply.spokenKorean
                }
                lastSpokenText = reply.spokenKorean
                updateGlassHudBanner(reply.detectedModeTag, reply.latencyMs, displaySpoken)
                glassTouchpadStatusTv.text = "✅ Completed (${reply.latencyMs}ms)"

                // Execute Single-Pass LLM Tool Call (`NAV_CONTROL`) if Gemini emitted a navigation action!
                if (!reply.navAction.isNullOrBlank()) {
                    val activeRt = WayfindingNavigator.activeRoute
                    val lastSearch = WayfindingNavigator.lastSearchResult
                    val targetDest = activeRt?.destination ?: lastSearch?.candidatesRecommended?.firstOrNull()
                    val originAddr = activeRt?.originAddressKo ?: lastSearch?.originAddressKo ?: "현재 위치"
                    val oLat = activeRt?.originLat ?: lastSearch?.originLat ?: WayfindingNavigator.currentLat
                    val oLng = activeRt?.originLng ?: lastSearch?.originLng ?: WayfindingNavigator.currentLng

                    when (reply.navAction) {
                        "SWITCH_SUBWAY" -> if (targetDest != null) {
                            confirmCandidateAndStartNavigation(originAddr, oLat, oLng, targetDest, preferTransit = true, preferSubwayOnly = true, conversationalPrefixKo = reply.spokenKorean)
                            return@runOnUiThread
                        }
                        "SWITCH_BUS" -> if (targetDest != null) {
                            confirmCandidateAndStartNavigation(originAddr, oLat, oLng, targetDest, preferTransit = true, preferSubwayOnly = false, conversationalPrefixKo = reply.spokenKorean)
                            return@runOnUiThread
                        }
                        "SWITCH_WALK" -> if (targetDest != null) {
                            confirmCandidateAndStartNavigation(originAddr, oLat, oLng, targetDest, preferTransit = false, preferSubwayOnly = false, conversationalPrefixKo = reply.spokenKorean)
                            return@runOnUiThread
                        }
                        "SEARCH_PLACE" -> if (!reply.navTargetPlace.isNullOrBlank()) {
                            WayfindingNavigator.clearRoute()
                            searchDestinationAndPromptUser(reply.navTargetPlace)
                            return@runOnUiThread
                        }
                        "SELECT_CANDIDATE" -> {
                            val idx = (reply.navCandidateIndex ?: 1) - 1
                            val cand = lastSearch?.candidatesRecommended?.getOrNull(idx)
                            if (cand != null && lastSearch != null) {
                                confirmCandidateAndStartNavigation(lastSearch.originAddressKo, lastSearch.originLat, lastSearch.originLng, cand, preferTransit = cand.distanceMeters >= 500, preferSubwayOnly = true)
                                return@runOnUiThread
                            }
                        }
                        "CONFIRM_START" -> if (activeRt != null) {
                            startConfirmedMissionExecution()
                            return@runOnUiThread
                        }
                    }
                }

                // Safety net for LUM-135 & LUM-137: If Gemini said "포자랩스로 바로 안내해 드릴게요 / 목적지를 포자랩스로 바로 바꿀게요" without [NAV_CONTROL] header, trigger search immediately!
                val impliedPlaceMatch = Regex("(?:목적지를\\s*)?([가-힣A-Za-z0-9\\s]{2,15}?)(?:으로|로)\\s*바로\\s*(?:안내해|바꿀게요|바꿔)").find(reply.spokenKorean)
                if (impliedPlaceMatch != null) {
                    val impliedPlace = WayfindingNavigator.extractCleanPlaceQuery(impliedPlaceMatch.groupValues[1])
                    if (impliedPlace.length >= 2) {
                        WayfindingNavigator.clearRoute()
                        searchDestinationAndPromptUser(impliedPlace)
                        return@runOnUiThread
                    }
                }

                if (aiEnabled || userQuery.isNotBlank()) {
                    SpatialEarconSynthesizer.play(reply.earconKind)
                    speakNative(reply.spokenKorean, autoListenAfter = false)
                }
            }

            // Persist and sync asynchronously on low-priority syncExecutor so it NEVER delays speech or next inference!
            val loggedReply = if (userQuery.isNotBlank() && !userQuery.startsWith("(")) {
                reply.copy(spokenKorean = "[내 질문: $userQuery] → ${reply.spokenKorean}")
            } else {
                reply
            }
            syncExecutor.execute {
                val savedEntry = FeedbackLogStore.addEntry(
                    context = this,
                    reply = loggedReply,
                    imageBase64 = captured.base64Jpeg
                )
                runOnUiThread {
                    latestEntryId = savedEntry.id
                    prependEntryCard(savedEntry)
                }
                FeedbackLogStore.trySyncToServerAsync(this)
            }
        }
    }

    private fun renderHistoryList() {
        historyContainer.removeAllViews()
        val list = FeedbackLogStore.listEntries(this)
        for (entry in list) {
            historyContainer.addView(buildEntryCard(entry))
        }
    }

    private fun prependEntryCard(entry: InferenceFeedbackEntry) {
        historyContainer.addView(buildEntryCard(entry), 0)
    }

    private fun buildEntryCard(entry: InferenceFeedbackEntry): LinearLayout {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 22, 24, 22)
            setBackgroundColor(Color.parseColor("#161D2B"))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, 22)
            }
        }

        val topRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.TOP
        }

        val thumbView = ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams(210, 160).apply {
                setMargins(0, 0, 20, 0)
            }
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(Color.BLACK)
            if (!entry.imageBase64.isNullOrBlank()) {
                try {
                    val bytes = Base64.decode(entry.imageBase64, Base64.DEFAULT)
                    val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    setImageBitmap(bmp)
                } catch (_: Exception) {}
            }
        }

        val metaCol = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }

        val modeLabel = TextView(this).apply {
            text = "🤖 Skill: [${entry.detectedMode}]"
            setTextColor(Color.parseColor("#FFD400"))
            textSize = 13.5f
            typeface = Typeface.DEFAULT_BOLD
        }

        val timeMeta = TextView(this).apply {
            text = "🕒 ${entry.displayTime}  ·  ⏱️ ${entry.latencyMs}ms"
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 12.5f
            setPadding(0, 4, 0, 6)
        }

        val speechText = TextView(this).apply {
            text = "\"${entry.spokenKorean}\""
            setTextColor(Color.WHITE)
            textSize = 15f
            typeface = Typeface.DEFAULT_BOLD
        }

        metaCol.addView(modeLabel)
        metaCol.addView(timeMeta)
        metaCol.addView(speechText)

        topRow.addView(thumbView)
        topRow.addView(metaCol)

        val voteRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 16, 0, 8)
        }

        lateinit var upBtn: Button
        lateinit var downBtn: Button

        fun styleVoteButtons(currentVote: String) {
            if (currentVote == "UP") {
                upBtn.setBackgroundColor(Color.parseColor("#00E676"))
                upBtn.setTextColor(Color.BLACK)
            } else {
                upBtn.setBackgroundColor(Color.parseColor("#243044"))
                upBtn.setTextColor(Color.WHITE)
            }
            if (currentVote == "DOWN") {
                downBtn.setBackgroundColor(Color.parseColor("#FF5252"))
                downBtn.setTextColor(Color.WHITE)
            } else {
                downBtn.setBackgroundColor(Color.parseColor("#243044"))
                downBtn.setTextColor(Color.WHITE)
            }
        }

        upBtn = Button(this).apply {
            text = "👍 Good"
            textSize = 13f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(0, 0, 8, 0)
            }
            setOnClickListener {
                val next = if (entry.vote == "UP") "NONE" else "UP"
                entry.vote = next
                styleVoteButtons(next)
                saveEntryFeedbackAsync(entry)
            }
        }

        downBtn = Button(this).apply {
            text = "👎 Bad"
            textSize = 13f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(8, 0, 0, 0)
            }
            setOnClickListener {
                val next = if (entry.vote == "DOWN") "NONE" else "DOWN"
                entry.vote = next
                styleVoteButtons(next)
                saveEntryFeedbackAsync(entry)
            }
        }

        styleVoteButtons(entry.vote)
        voteRow.addView(upBtn)
        voteRow.addView(downBtn)

        val memoRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        val feedbackInput = EditText(this).apply {
            hint = "Enter feedback note (top panel auto-collapses while typing)"
            setHintTextColor(Color.parseColor("#64748B"))
            setText(entry.feedbackText)
            setTextColor(Color.WHITE)
            textSize = 14f
            minLines = 2
            maxLines = 5
            setBackgroundColor(Color.parseColor("#0B0E14"))
            setPadding(20, 16, 20, 16)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(0, 0, 12, 0)
            }
            setOnFocusChangeListener { _, hasFocus ->
                if (hasFocus) {
                    tts?.stop()
                    cameraTextureView.visibility = View.GONE
                    candidateConfirmBox.visibility = View.GONE
                    activeNavBanner.maxLines = 1
                    historyScrollView.postDelayed({
                        historyScrollView.smoothScrollTo(0, maxOf(0, card.top - 20))
                    }, 180L)
                } else {
                    cameraTextureView.visibility = View.VISIBLE
                    activeNavBanner.maxLines = 4
                }
            }
            setOnClickListener {
                tts?.stop()
                cameraTextureView.visibility = View.GONE
                candidateConfirmBox.visibility = View.GONE
                historyScrollView.postDelayed({
                    historyScrollView.smoothScrollTo(0, maxOf(0, card.top - 20))
                }, 180L)
            }
        }

        val saveMemoBtn = Button(this).apply {
            text = "Save"
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#FFD400"))
            setTextColor(Color.BLACK)
            setOnClickListener {
                entry.feedbackText = feedbackInput.text.toString().trim()
                saveEntryFeedbackAsync(entry)
                feedbackInput.clearFocus()
                val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
                imm?.hideSoftInputFromWindow(feedbackInput.windowToken, 0)
                cameraTextureView.visibility = View.VISIBLE
                Toast.makeText(this@MainActivity, "Feedback saved.", Toast.LENGTH_SHORT).show()
            }
        }

        memoRow.addView(feedbackInput)
        memoRow.addView(saveMemoBtn)

        card.addView(topRow)
        card.addView(voteRow)
        card.addView(memoRow)
        return card
    }

    private fun saveEntryFeedbackAsync(entry: InferenceFeedbackEntry) {
        syncExecutor.execute {
            FeedbackLogStore.updateFeedback(
                context = this,
                id = entry.id,
                vote = entry.vote,
                feedbackText = entry.feedbackText
            )
            FeedbackLogStore.trySyncToServerAsync(this)
        }
    }

    @SuppressLint("MissingPermission")
    private fun openRearCamera() {
        if (cameraDevice != null) return
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return
        val surfaceTexture = cameraTextureView.surfaceTexture ?: return

        try {
            val manager = getSystemService(Context.CAMERA_SERVICE) as CameraManager
            val rearCameraId = manager.cameraIdList.firstOrNull { id ->
                val chars = manager.getCameraCharacteristics(id)
                chars.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK
            } ?: manager.cameraIdList.firstOrNull() ?: return

            surfaceTexture.setDefaultBufferSize(640, 480)
            val previewSurface = Surface(surfaceTexture)

            manager.openCamera(rearCameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) {
                    cameraDevice = camera
                    try {
                        val reqBuilder = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
                            addTarget(previewSurface)
                        }
                        camera.createCaptureSession(
                            listOf(previewSurface),
                            object : CameraCaptureSession.StateCallback() {
                                override fun onConfigured(session: CameraCaptureSession) {
                                    captureSession = session
                                    try {
                                        session.setRepeatingRequest(reqBuilder.build(), null, mainHandler)
                                    } catch (_: Exception) {}
                                }
                                override fun onConfigureFailed(session: CameraCaptureSession) {}
                            },
                            mainHandler
                        )
                    } catch (_: Exception) {}
                }

                override fun onDisconnected(camera: CameraDevice) {
                    camera.close()
                    cameraDevice = null
                }

                override fun onError(camera: CameraDevice, error: Int) {
                    camera.close()
                    cameraDevice = null
                }
            }, mainHandler)
        } catch (_: Exception) {}
    }

    private fun closeRearCamera() {
        try {
            captureSession?.close()
            captureSession = null
            cameraDevice?.close()
            cameraDevice = null
        } catch (_: Exception) {}
    }

    private fun requestRuntimePermissionsIfNeeded() {
        val perms = arrayOf(
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )
        val missing = perms.filter {
            checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
            requestPermissions(missing.toTypedArray(), REQ_PERMS)
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_PERMS) {
            startGpsAndCompassTracking()
            if (cameraTextureView.isAvailable) {
                openRearCamera()
            }
        }
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            tts?.language = Locale.KOREAN
            tts?.setSpeechRate(1.08f)
            tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {}
                override fun onDone(utteranceId: String?) {
                    // Only auto-open inline microphone for explicit Planning / Route Confirmation questions!
                    if (utteranceId?.startsWith("lumo_question_") == true) {
                        mainHandler.postDelayed({ startInlineVoiceListening() }, 250L)
                    } else if (aiEnabled) {
                        // Event-driven next frame trigger: scan next camera frame 650ms after TTS finishes speaking!
                        mainHandler.removeCallbacks(realtimeLoopRunnable)
                        mainHandler.postDelayed(realtimeLoopRunnable, 650L)
                    }
                }
                override fun onError(utteranceId: String?) {}
            })
        }
    }

    private fun speakNative(text: String, autoListenAfter: Boolean = false) {
        val naturalSpeech = NativeLumoAiClient.cleanMovementRelativeDirection(text)
        val utterId = if (autoListenAfter) {
            "lumo_question_${System.currentTimeMillis()}"
        } else {
            "lumo_native_${System.currentTimeMillis()}"
        }
        tts?.speak(naturalSpeech, TextToSpeech.QUEUE_FLUSH, null, utterId)
    }

    override fun onDestroy() {
        mainHandler.removeCallbacksAndMessages(null)
        try { locationManager?.removeUpdates(gpsListener) } catch (_: Exception) {}
        try { sensorManager?.unregisterListener(this) } catch (_: Exception) {}
        try { speechRecognizer?.destroy() } catch (_: Exception) {}
        closeRearCamera()
        tts?.stop()
        tts?.shutdown()
        ioExecutor.shutdownNow()
        syncExecutor.shutdownNow()
        super.onDestroy()
    }
}
