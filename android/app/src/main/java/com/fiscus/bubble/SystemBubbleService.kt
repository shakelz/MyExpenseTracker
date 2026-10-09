package com.fiscus.bubble

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.WindowManager
import android.view.animation.OvershootInterpolator
import android.view.inputmethod.EditorInfo
import android.widget.ArrayAdapter
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationCompat
import com.facebook.rebound.SimpleSpringListener
import com.facebook.rebound.Spring
import com.facebook.rebound.SpringConfig
import com.facebook.rebound.SpringSystem
import com.fiscus.R
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Premium Facebook Messenger-style Chat Heads built using Facebook's Rebound Spring Physics.
 *
 * Features:
 * - High-fidelity floating chat head with dual-layer glow, depth elevation, and Quick-Add '+' badge
 * - Facebook Rebound Spring physics for tactile touch-down squash, edge-snapping oscillation & wall impact
 * - Dynamic dragging tilt angle based on velocity (Messenger wobble effect)
 * - Magnetic Close Target ('✕') with suction force, red danger state, and haptic feedback
 * - Revolut/Messenger styled Quick Transaction floating card with category chips & account selector
 */
class SystemBubbleService : Service() {
  private var windowManager: WindowManager? = null
  private var bubbleView: View? = null
  private var bubbleIcon: ImageView? = null
  private var formView: View? = null
  private var formRoot: FrameLayout? = null
  private var formCard: FrameLayout? = null
  private var formContent: View? = null
  private var formBackground: GradientDrawable? = null
  private var isAnimatingForm: Boolean = false
  private var layoutParams: WindowManager.LayoutParams? = null
  private var lastBubbleX: Int = 0
  private var lastBubbleY: Int = 0
  private var bubbleSizePx: Int = 0

  // Close target
  private var removeTargetView: View? = null
  private var isOverRemoveTarget: Boolean = false

  // Facebook Rebound Physics System
  private val springSystem = SpringSystem.create()
  private val snapSpringConfig = SpringConfig.fromOrigamiTensionAndFriction(44.0, 6.8)
  private val scaleSpringConfig = SpringConfig.fromOrigamiTensionAndFriction(140.0, 8.5)
  private val targetSpringConfig = SpringConfig.fromOrigamiTensionAndFriction(90.0, 8.0)

  private var springX: Spring? = null
  private var springY: Spring? = null
  private var scaleSpring: Spring? = null
  private var targetScaleSpring: Spring? = null

  private data class AccountOption(val name: String, val type: String, val balance: Double)

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    initReboundSprings()
  }

  private fun initReboundSprings() {
    // Spring for X position
    springX = springSystem.createSpring().apply {
      springConfig = snapSpringConfig
      addListener(object : SimpleSpringListener() {
        override fun onSpringUpdate(spring: Spring) {
          val params = layoutParams ?: return
          val view = bubbleView ?: return
          params.x = spring.currentValue.toInt()
          lastBubbleX = params.x
          try {
            windowManager?.updateViewLayout(view, params)
          } catch (_: Exception) {}
        }
      })
    }

    // Spring for Y position
    springY = springSystem.createSpring().apply {
      springConfig = snapSpringConfig
      addListener(object : SimpleSpringListener() {
        override fun onSpringUpdate(spring: Spring) {
          val params = layoutParams ?: return
          val view = bubbleView ?: return
          params.y = spring.currentValue.toInt()
          lastBubbleY = params.y
          try {
            windowManager?.updateViewLayout(view, params)
          } catch (_: Exception) {}
        }
      })
    }

    // Spring for Chat Head Touch Scale
    scaleSpring = springSystem.createSpring().apply {
      springConfig = scaleSpringConfig
      addListener(object : SimpleSpringListener() {
        override fun onSpringUpdate(spring: Spring) {
          val scale = spring.currentValue.toFloat()
          bubbleView?.scaleX = scale
          bubbleView?.scaleY = scale
        }
      })
    }

    // Spring for Close Target Scale
    targetScaleSpring = springSystem.createSpring().apply {
      springConfig = targetSpringConfig
      addListener(object : SimpleSpringListener() {
        override fun onSpringUpdate(spring: Spring) {
          val scale = spring.currentValue.toFloat()
          val target = removeTargetView as? FrameLayout ?: return
          val circle = target.getChildAt(0) ?: return
          circle.scaleX = scale
          circle.scaleY = scale
        }
      })
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_INIT -> {
        startForeground(NOTIFICATION_ID, createNotification())
        hideBubble()
      }
      ACTION_SHOW -> {
        startForeground(NOTIFICATION_ID, createNotification())
        val x = intent.getIntExtra(EXTRA_X, 0)
        val y = intent.getIntExtra(EXTRA_Y, 0)
        showBubble(x, y)
      }
      ACTION_HIDE -> {
        hideBubble()
        hideForm()
        hideRemoveTarget()
      }
      ACTION_STOP -> {
        hideBubble()
        hideForm()
        hideRemoveTarget()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
      }
    }
    return START_STICKY
  }

  override fun onDestroy() {
    hideBubble()
    hideForm()
    hideRemoveTarget()
    springX?.removeAllListeners()
    springY?.removeAllListeners()
    scaleSpring?.removeAllListeners()
    targetScaleSpring?.removeAllListeners()
    super.onDestroy()
  }

  private fun showBubble(preferredX: Int = 0, preferredY: Int = 0) {
    if (bubbleView != null) return
    hideForm()

    val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    windowManager = wm

    val sizePx = dpToPx(64f)
    bubbleSizePx = sizePx

    // Root container with padding for shadow & glow
    val container = FrameLayout(this).apply {
      clipChildren = false
      clipToPadding = false
    }

    // Outer subtle glow ring
    val glowRing = View(this).apply {
      val bg = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(0x334F83FF.toInt())
      }
      background = bg
    }
    container.addView(
      glowRing,
      FrameLayout.LayoutParams(sizePx + dpToPx(6f), sizePx + dpToPx(6f)).apply {
        gravity = Gravity.CENTER
      }
    )

    // Inner circular chat head body
    val bubble = ImageView(this).apply {
      val bg = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        colors = intArrayOf(0xFF282E4E.toInt(), 0xFF141728.toInt())
        gradientType = GradientDrawable.RADIAL_GRADIENT
        gradientRadius = dpToPx(38f).toFloat()
        setStroke(dpToPx(2.5f), 0xFF4F83FF.toInt())
      }
      background = bg
      setImageResource(R.drawable.ic_fiscus_app)
      scaleType = ImageView.ScaleType.CENTER_INSIDE
      setPadding(dpToPx(13f), dpToPx(13f), dpToPx(13f), dpToPx(13f))
      elevation = dpToPx(10f).toFloat()
    }
    bubbleIcon = bubble

    container.addView(
      bubble,
      FrameLayout.LayoutParams(sizePx, sizePx).apply {
        gravity = Gravity.CENTER
      }
    )

    // Facebook-style Quick Action badge '+' indicator at bottom right
    val badgeSize = dpToPx(22f)
    val actionBadge = FrameLayout(this).apply {
      val badgeBg = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        colors = intArrayOf(0xFF10B981.toInt(), 0xFF059669.toInt())
        orientation = GradientDrawable.Orientation.TOP_BOTTOM
        setStroke(dpToPx(2f), 0xFF141728.toInt())
      }
      background = badgeBg
      elevation = dpToPx(12f).toFloat()

      val plusIcon = TextView(this@SystemBubbleService).apply {
        text = "+"
        textSize = 14f
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
      }
      addView(
        plusIcon,
        FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
      )
    }

    container.addView(
      actionBadge,
      FrameLayout.LayoutParams(badgeSize, badgeSize).apply {
        gravity = Gravity.BOTTOM or Gravity.END
        rightMargin = dpToPx(3f)
        bottomMargin = dpToPx(3f)
      }
    )

    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }

    val metrics = resources.displayMetrics
    val screenWidth = metrics.widthPixels
    val screenHeight = metrics.heightPixels

    val initialX = if (preferredX > 0) preferredX else (screenWidth - sizePx - dpToPx(8f))
    val initialY = if (preferredY > 0) preferredY else (screenHeight / 3)

    layoutParams = WindowManager.LayoutParams(
      sizePx + dpToPx(16f),
      sizePx + dpToPx(16f),
      type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = initialX
      y = initialY
    }

    lastBubbleX = initialX
    lastBubbleY = initialY

    container.setOnTouchListener(FacebookBubbleTouchListener())

    wm.addView(container, layoutParams)
    bubbleView = container

    scaleSpring?.currentValue = 0.0
    scaleSpring?.endValue = 1.0

    // Ensure it snaps to nearest edge smoothly using Rebound spring
    springX?.currentValue = initialX.toDouble()
    springY?.currentValue = initialY.toDouble()
    snapBubbleToEdgeRebound(0f)
  }

  private fun hideBubble() {
    val view = bubbleView ?: return
    try {
      windowManager?.removeView(view)
    } catch (_: Exception) {}
    bubbleView = null
    bubbleIcon = null
  }

  private fun handleBubbleClick() {
    val bubble = bubbleView
    if (bubble == null) {
      showForm()
      return
    }

    vibrateDevice(20)
    scaleSpring?.endValue = 1.15
    bubble.postDelayed({
      scaleSpring?.endValue = 1.0
      hideBubble()
      showForm()
    }, 120)
  }

  // --- Revolut/Messenger-Styled Quick Add Modal ---
  private fun showForm() {
    if (formView != null) return
    val wm = windowManager ?: return

    val root = object : FrameLayout(this) {
      override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
          vibrateDevice(15)
          closeFormAndReturnBubble()
          return true
        }
        return super.dispatchKeyEvent(event)
      }
    }.apply {
      layoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT
      )
      setBackgroundColor(0x88090B14.toInt())
    }

    val cardBackground = GradientDrawable().apply {
      cornerRadius = dpToPx(28f).toFloat()
      colors = intArrayOf(0xF8171B2D.toInt(), 0xF8101322.toInt())
      gradientType = GradientDrawable.LINEAR_GRADIENT
      orientation = GradientDrawable.Orientation.TOP_BOTTOM
      setStroke(dpToPx(1.5f), 0x554F83FF.toInt())
    }

    val cardContainer = FrameLayout(this).apply {
      background = cardBackground
      elevation = dpToPx(20f).toFloat()
      setPadding(dpToPx(20f), dpToPx(16f), dpToPx(20f), dpToPx(20f))
    }

    val cardContent = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      alpha = 0f
    }
    cardContent.layoutParams = FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.WRAP_CONTENT
    )

    // Top Pill Drag Handle
    val dragHandle = View(this).apply {
      background = GradientDrawable().apply {
        cornerRadius = dpToPx(3f).toFloat()
        setColor(0x44FFFFFF)
      }
    }
    val dragParams = LinearLayout.LayoutParams(dpToPx(42f), dpToPx(4.5f)).apply {
      gravity = Gravity.CENTER_HORIZONTAL
      bottomMargin = dpToPx(12f)
    }
    cardContent.addView(dragHandle, dragParams)

    // Header: App Mini Icon + Title & Subtitle + Close Button
    val headerRow = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }

    val headerIcon = ImageView(this).apply {
      setImageResource(R.drawable.ic_fiscus_app)
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(0xFF262C47.toInt())
        setStroke(dpToPx(1f), 0xFF4F83FF.toInt())
      }
      setPadding(dpToPx(5f), dpToPx(5f), dpToPx(5f), dpToPx(5f))
    }
    headerRow.addView(headerIcon, LinearLayout.LayoutParams(dpToPx(32f), dpToPx(32f)))

    val titleColumn = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dpToPx(10f), 0, 0, 0)
    }
    val headerTitle = TextView(this).apply {
      text = "Quick Transaction"
      textSize = 17f
      setTypeface(typeface, Typeface.BOLD)
      setTextColor(Color.WHITE)
    }
    val headerSub = TextView(this).apply {
      text = "Instantly log without opening app"
      textSize = 11f
      setTextColor(0xFF7E85A6.toInt())
    }
    titleColumn.addView(headerTitle)
    titleColumn.addView(headerSub)
    headerRow.addView(titleColumn, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

    val headerClose = FrameLayout(this).apply {
      val closeBg = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(0x33FFFFFF)
      }
      background = closeBg
      val xText = TextView(this@SystemBubbleService).apply {
        text = "✕"
        textSize = 14f
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(0xFFB0B7D6.toInt())
        gravity = Gravity.CENTER
      }
      addView(xText, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
      setOnClickListener {
        vibrateDevice(15)
        closeFormAndReturnBubble()
      }
    }
    headerRow.addView(headerClose, LinearLayout.LayoutParams(dpToPx(30f), dpToPx(30f)))

    cardContent.addView(headerRow)
    cardContent.addView(spaceView(14f))

    // Segmented Expense / Income Switcher
    val toggleContainer = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      setPadding(dpToPx(4f), dpToPx(4f), dpToPx(4f), dpToPx(4f))
      background = GradientDrawable().apply {
        cornerRadius = dpToPx(16f).toFloat()
        setColor(0xFF22263D.toInt())
      }
    }

    fun createSegmentPill(textValue: String, activeBg: Int): TextView {
      return TextView(this).apply {
        text = textValue
        textSize = 13.5f
        setTypeface(typeface, Typeface.BOLD)
        gravity = Gravity.CENTER
        setPadding(dpToPx(16f), dpToPx(10f), dpToPx(16f), dpToPx(10f))
      }
    }

    val expenseToggle = createSegmentPill("↓ Expense", 0xFFEF4444.toInt())
    val incomeToggle = createSegmentPill("↑ Income", 0xFF10B981.toInt())

    var selectedType = "expense"
    val currencySymbol = getCurrencySymbol()

    val updateTypeUi = {
      val isExpense = selectedType == "expense"
      expenseToggle.background = GradientDrawable().apply {
        cornerRadius = dpToPx(12f).toFloat()
        setColor(if (isExpense) 0xFFEF4444.toInt() else Color.TRANSPARENT)
      }
      expenseToggle.setTextColor(if (isExpense) Color.WHITE else 0xFF7E85A6.toInt())

      incomeToggle.background = GradientDrawable().apply {
        cornerRadius = dpToPx(12f).toFloat()
        setColor(if (!isExpense) 0xFF10B981.toInt() else Color.TRANSPARENT)
      }
      incomeToggle.setTextColor(if (!isExpense) Color.WHITE else 0xFF7E85A6.toInt())
    }

    expenseToggle.setOnClickListener {
      vibrateDevice(12)
      selectedType = "expense"
      updateTypeUi()
    }
    incomeToggle.setOnClickListener {
      vibrateDevice(12)
      selectedType = "income"
      updateTypeUi()
    }

    toggleContainer.addView(expenseToggle, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
    toggleContainer.addView(incomeToggle, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
    updateTypeUi()
    cardContent.addView(toggleContainer)
    cardContent.addView(spaceView(12f))

    // Hero Amount Input Card
    val amountCard = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dpToPx(16f), dpToPx(6f), dpToPx(16f), dpToPx(6f))
      background = GradientDrawable().apply {
        cornerRadius = dpToPx(16f).toFloat()
        setColor(0xFF20243A.toInt())
        setStroke(dpToPx(1.5f), 0x334F83FF.toInt())
      }
    }

    val currLabel = TextView(this).apply {
      text = currencySymbol
      textSize = 24f
      setTypeface(typeface, Typeface.BOLD)
      setTextColor(0xFF4F83FF.toInt())
    }
    amountCard.addView(currLabel)

    val amountInput = EditText(this).apply {
      hint = "0.00"
      textSize = 26f
      setTypeface(typeface, Typeface.BOLD)
      inputType = EditorInfo.TYPE_CLASS_NUMBER or EditorInfo.TYPE_NUMBER_FLAG_DECIMAL
      imeOptions = EditorInfo.IME_ACTION_NEXT
      setPadding(dpToPx(10f), dpToPx(10f), dpToPx(10f), dpToPx(10f))
      setTextColor(Color.WHITE)
      setHintTextColor(0xFF555C7E.toInt())
      background = null
      minHeight = dpToPx(52f)
    }
    amountCard.addView(amountInput, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

    cardContent.addView(amountCard)
    cardContent.addView(spaceView(10f))

    // Note / Merchant Input
    val noteInput = EditText(this).apply {
      hint = "Note (e.g. Groceries, Coffee, Fuel)"
      textSize = 13.5f
      inputType = EditorInfo.TYPE_CLASS_TEXT or EditorInfo.TYPE_TEXT_FLAG_CAP_SENTENCES
      imeOptions = EditorInfo.IME_ACTION_DONE
      setPadding(dpToPx(16f), dpToPx(12f), dpToPx(16f), dpToPx(12f))
      setTextColor(Color.WHITE)
      setHintTextColor(0xFF555C7E.toInt())
      background = GradientDrawable().apply {
        cornerRadius = dpToPx(14f).toFloat()
        setColor(0xFF20243A.toInt())
        setStroke(dpToPx(1f), 0x224F83FF.toInt())
      }
      minHeight = dpToPx(46f)
    }

    amountInput.setOnEditorActionListener { _, actionId, _ ->
      if (actionId == EditorInfo.IME_ACTION_NEXT) {
        noteInput.requestFocus()
        true
      } else false
    }

    cardContent.addView(noteInput)
    cardContent.addView(spaceView(12f))

    // Category Selector with Horizontal Chips
    val categoryHeader = TextView(this).apply {
      text = "SELECT CATEGORY"
      textSize = 10.5f
      setTypeface(typeface, Typeface.BOLD)
      setTextColor(0xFF7E85A6.toInt())
      letterSpacing = 0.08f
    }
    cardContent.addView(categoryHeader)
    cardContent.addView(spaceView(6f))

    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val categoryOptions = loadCategories(prefs)
    var selectedCategory = categoryOptions.firstOrNull() ?: "Food"

    val categoryScroll = HorizontalScrollView(this).apply {
      isHorizontalScrollBarEnabled = false
    }
    val categoryChipRow = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
    }

    val categoryChipViews = mutableListOf<TextView>()

    fun getCategoryIcon(name: String): String {
      return when (name.lowercase(Locale.ROOT)) {
        "food", "groceries" -> "🍔"
        "transport", "travel" -> "🚗"
        "bills" -> "💡"
        "shopping" -> "🛒"
        "health" -> "🏥"
        "salary" -> "💰"
        "bonus" -> "🎁"
        "refund" -> "↩️"
        "interest" -> "📈"
        "entertainment" -> "🍿"
        else -> "📦"
      }
    }

    fun updateCategoryChipsUi() {
      categoryChipViews.forEach { chip ->
        val catName = chip.tag as? String ?: return@forEach
        val isSelected = catName == selectedCategory
        chip.background = GradientDrawable().apply {
          cornerRadius = dpToPx(12f).toFloat()
          if (isSelected) {
            setColor(0xFF4F83FF.toInt())
            setStroke(dpToPx(1f), 0xFF85AAFF.toInt())
          } else {
            setColor(0xFF20243A.toInt())
            setStroke(dpToPx(1f), 0x22FFFFFF)
          }
        }
        chip.setTextColor(if (isSelected) Color.WHITE else 0xFF8E95B8.toInt())
      }
    }

    categoryOptions.forEach { cat ->
      val icon = getCategoryIcon(cat)
      val chip = TextView(this).apply {
        tag = cat
        text = "$icon $cat"
        textSize = 12f
        setTypeface(typeface, Typeface.BOLD)
        setPadding(dpToPx(12f), dpToPx(8f), dpToPx(12f), dpToPx(8f))
        setOnClickListener {
          vibrateDevice(10)
          selectedCategory = cat
          updateCategoryChipsUi()
        }
      }
      categoryChipViews.add(chip)
      val chipParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.WRAP_CONTENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply {
        rightMargin = dpToPx(8f)
      }
      categoryChipRow.addView(chip, chipParams)
    }
    updateCategoryChipsUi()
    categoryScroll.addView(categoryChipRow)
    cardContent.addView(categoryScroll)
    cardContent.addView(spaceView(12f))

    // Account / Wallet Selector
    val accountHeader = TextView(this).apply {
      text = "ACCOUNT / WALLET"
      textSize = 10.5f
      setTypeface(typeface, Typeface.BOLD)
      setTextColor(0xFF7E85A6.toInt())
      letterSpacing = 0.08f
    }
    cardContent.addView(accountHeader)
    cardContent.addView(spaceView(6f))

    val accountOptions = loadAccounts(prefs)
    val accountLabels = accountOptions.map { option ->
      if (option.name == ADD_ACCOUNT_OPTION) {
        "+ $ADD_ACCOUNT_OPTION"
      } else {
        val icon = when (option.type.lowercase(Locale.ROOT)) {
          "cash" -> "💵"
          "wallet" -> "👛"
          else -> "💳"
        }
        "$icon ${option.name}  ($currencySymbol${String.format(Locale.US, "%.2f", option.balance)})"
      }
    }

    val accountSpinner = Spinner(this).apply {
      adapter = ArrayAdapter(
        this@SystemBubbleService,
        android.R.layout.simple_spinner_dropdown_item,
        accountLabels
      )
      background = GradientDrawable().apply {
        cornerRadius = dpToPx(14f).toFloat()
        setColor(0xFF20243A.toInt())
        setStroke(dpToPx(1f), 0x224F83FF.toInt())
      }
      setPadding(dpToPx(14f), dpToPx(10f), dpToPx(14f), dpToPx(10f))
      minimumHeight = dpToPx(46f)
    }
    accountSpinner.setSelection(0)
    cardContent.addView(accountSpinner)
    cardContent.addView(spaceView(16f))

    // Primary "✓ Save Transaction" Button
    val saveButton = TextView(this).apply {
      text = "✓ Save to Fiscus"
      textSize = 15f
      setTypeface(typeface, Typeface.BOLD)
      setTextColor(Color.WHITE)
      gravity = Gravity.CENTER
      setPadding(dpToPx(16f), dpToPx(14f), dpToPx(16f), dpToPx(14f))
      background = GradientDrawable().apply {
        cornerRadius = dpToPx(16f).toFloat()
        colors = intArrayOf(0xFF4F83FF.toInt(), 0xFF356AE6.toInt())
        orientation = GradientDrawable.Orientation.TOP_BOTTOM
      }
      elevation = dpToPx(6f).toFloat()
    }

    saveButton.setOnClickListener {
      val amountText = amountInput.text?.toString()?.trim() ?: ""
      val amount = amountText.toDoubleOrNull()
      if (amount == null || amount <= 0) {
        vibrateDevice(30)
        Toast.makeText(this, "Please enter a valid amount", Toast.LENGTH_SHORT).show()
        return@setOnClickListener
      }
      val note = noteInput.text?.toString()?.trim() ?: ""
      val accountIndex = accountSpinner.selectedItemPosition
      val selectedAccount = accountOptions.getOrNull(accountIndex)
      val selectedBank = selectedAccount?.name?.trim() ?: ""
      val selectedAccountType = selectedAccount?.type ?: "bank"

      if (selectedBank == ADD_ACCOUNT_OPTION) {
        openAddAccount()
        Toast.makeText(this, "Open app to add accounts", Toast.LENGTH_SHORT).show()
        closeFormAndReturnBubble()
        return@setOnClickListener
      }

      saveTransaction(
        selectedType,
        amount,
        note,
        selectedBank,
        selectedAccountType,
        selectedCategory,
        System.currentTimeMillis(),
      )
      vibrateDevice(50)
      Toast.makeText(this, "✓ Logged $currencySymbol$amountText ($selectedCategory)", Toast.LENGTH_SHORT).show()
      closeFormAndReturnBubble()
    }

    cardContent.addView(saveButton)

    val metrics = resources.displayMetrics
    val screenWidth = metrics.widthPixels
    val cardMargin = dpToPx(18f)
    val cardWidth = screenWidth - cardMargin * 2

    val cardParams = FrameLayout.LayoutParams(
      cardWidth,
      FrameLayout.LayoutParams.WRAP_CONTENT
    ).apply {
      gravity = Gravity.CENTER
    }

    val cardScroll = ScrollView(this).apply {
      isVerticalScrollBarEnabled = false
      overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
    }
    cardScroll.addView(
      cardContent,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.WRAP_CONTENT
      )
    )
    cardContainer.addView(cardScroll)
    root.addView(cardContainer, cardParams)

    // Touch outside card to close
    root.setOnTouchListener { _, event ->
      if (event.action == MotionEvent.ACTION_DOWN) {
        val rect = android.graphics.Rect()
        cardContainer.getGlobalVisibleRect(rect)
        if (!rect.contains(event.rawX.toInt(), event.rawY.toInt())) {
          vibrateDevice(15)
          closeFormAndReturnBubble()
          return@setOnTouchListener true
        }
      }
      false
    }

    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }

    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      type,
      WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.CENTER
      softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
    }

    wm.addView(root, params)
    formView = root
    formRoot = root
    formCard = cardContainer
    formContent = cardContent
    formBackground = cardBackground
    isAnimatingForm = false

    // Animate dialog entrance with spring feel
    cardContainer.scaleX = 0.82f
    cardContainer.scaleY = 0.82f
    cardContainer.alpha = 0f
    cardContainer.animate()
      .scaleX(1.0f)
      .scaleY(1.0f)
      .alpha(1.0f)
      .setDuration(220)
      .setInterpolator(OvershootInterpolator(1.25f))
      .start()

    cardContent.animate()
      .alpha(1.0f)
      .setDuration(180)
      .start()
  }

  private fun hideForm() {
    val view = formView ?: return
    try {
      windowManager?.removeView(view)
    } catch (_: Exception) {}
    formView = null
    formRoot = null
    formCard = null
    formContent = null
    formBackground = null
    isAnimatingForm = false
  }

  private fun closeFormAndReturnBubble() {
    if (isAnimatingForm) return
    val card = formCard
    if (card == null) {
      hideForm()
      showBubble(lastBubbleX, lastBubbleY)
      return
    }

    isAnimatingForm = true
    card.animate()
      .scaleX(0.85f)
      .scaleY(0.85f)
      .alpha(0f)
      .setDuration(160)
      .withEndAction {
        hideForm()
        showBubble(lastBubbleX, lastBubbleY)
        isAnimatingForm = false
      }
      .start()
  }

  private fun saveTransaction(
    type: String,
    amount: Double,
    note: String,
    accountName: String,
    accountType: String,
    category: String,
    createdAtMillis: Long,
  ) {
    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val raw = prefs.getString(PREFS_KEY_TRANSACTIONS, "[]") ?: "[]"
    val array = JSONArray(raw)
    val obj = JSONObject()
    obj.put("id", System.currentTimeMillis().toString())
    obj.put("type", type)
    obj.put("amount", amount)
    val finalNote = if (note.isBlank()) category else note
    obj.put("note", finalNote)
    val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
      timeZone = TimeZone.getTimeZone("UTC")
    }
    obj.put("createdAt", isoFormat.format(Date(createdAtMillis)))
    obj.put("accountName", accountName)
    obj.put("accountType", accountType)
    obj.put("category", category)
    array.put(obj)
    prefs.edit().putString(PREFS_KEY_TRANSACTIONS, array.toString()).apply()
  }

  private fun spaceView(dp: Float): View {
    return View(this).apply {
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        dpToPx(dp)
      )
    }
  }

  private fun createNotification(): Notification {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Floating bubble",
        NotificationManager.IMPORTANCE_LOW
      )
      manager.createNotificationChannel(channel)
    }

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("Fiscus Chat Head Active")
      .setContentText("Tap to quick-log expense or income")
      .setOngoing(true)
      .build()
  }

  private fun dpToPx(dp: Float): Int {
    return TypedValue.applyDimension(
      TypedValue.COMPLEX_UNIT_DIP,
      dp,
      resources.displayMetrics
    ).toInt()
  }

  private fun loadCategories(prefs: android.content.SharedPreferences): List<String> {
    val raw = prefs.getString(PREFS_KEY_CATEGORIES, null) ?: return listOf(
      "Food",
      "Transport",
      "Bills",
      "Shopping",
      "Health",
      "Travel",
      "Salary",
      "Other",
    )
    return try {
      val array = JSONArray(raw)
      val items = mutableListOf<String>()
      for (i in 0 until array.length()) {
        val value = array.optString(i).trim()
        if (value.isNotBlank()) {
          items.add(value)
        }
      }
      if (items.isEmpty()) listOf("Food", "Shopping", "Bills", "Other") else items
    } catch (_: Exception) {
      listOf("Food", "Shopping", "Bills", "Other")
    }
  }

  private fun loadAccounts(prefs: android.content.SharedPreferences): List<AccountOption> {
    val raw = prefs.getString(PREFS_KEY_ACCOUNTS, null) ?: return listOf(
      AccountOption(ADD_ACCOUNT_OPTION, "bank", 0.0),
    )
    return try {
      val array = JSONArray(raw)
      val items = mutableListOf<AccountOption>()
      for (i in 0 until array.length()) {
        val obj = array.optJSONObject(i) ?: continue
        val name = obj.optString("name").trim()
        val type = obj.optString("type").trim().ifBlank { "bank" }
        val balance = obj.optDouble("balance", 0.0)
        if (name.isNotBlank()) {
          items.add(AccountOption(name, type, balance))
        }
      }
      if (items.isEmpty()) listOf(AccountOption(ADD_ACCOUNT_OPTION, "bank", 0.0)) else items
    } catch (_: Exception) {
      listOf(AccountOption(ADD_ACCOUNT_OPTION, "bank", 0.0))
    }
  }

  private fun openAddAccount() {
    try {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse("fiscus://add-account"))
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      startActivity(intent)
    } catch (_: Exception) {}
  }

  // --- Facebook Messenger Magnetic Close Target ---
  private fun showRemoveTarget() {
    if (removeTargetView != null) return
    val wm = windowManager ?: return
    val targetSize = dpToPx(76f)

    val targetLayout = FrameLayout(this).apply {
      clipChildren = false
      clipToPadding = false
    }

    val circle = FrameLayout(this).apply {
      val bg = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(0xEE1A1E32.toInt())
        setStroke(dpToPx(2.5f), 0x99FFFFFF.toInt())
      }
      background = bg
      elevation = dpToPx(12f).toFloat()
    }

    val xIcon = TextView(this).apply {
      text = "✕"
      textSize = 24f
      setTypeface(typeface, Typeface.BOLD)
      setTextColor(Color.WHITE)
      gravity = Gravity.CENTER
    }
    circle.addView(
      xIcon,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT
      )
    )

    val circleParams = FrameLayout.LayoutParams(targetSize, targetSize).apply {
      gravity = Gravity.CENTER
    }
    targetLayout.addView(circle, circleParams)

    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }

    val targetParams = WindowManager.LayoutParams(
      targetSize + dpToPx(36f),
      targetSize + dpToPx(36f),
      type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
      y = dpToPx(46f)
    }

    wm.addView(targetLayout, targetParams)
    removeTargetView = targetLayout

    targetScaleSpring?.currentValue = 0.0
    targetScaleSpring?.endValue = 1.0
  }

  private fun hideRemoveTarget() {
    val target = removeTargetView ?: return
    val wm = windowManager ?: return

    targetScaleSpring?.endValue = 0.0
    target.postDelayed({
      try {
        wm.removeView(target)
      } catch (_: Exception) {}
      if (removeTargetView == target) {
        removeTargetView = null
      }
    }, 150)
    isOverRemoveTarget = false
  }

  private fun updateRemoveTargetState(isHovering: Boolean) {
    if (isOverRemoveTarget == isHovering) return
    isOverRemoveTarget = isHovering
    val target = removeTargetView as? FrameLayout ?: return
    val circle = target.getChildAt(0) as? FrameLayout ?: return
    val bg = circle.background as? GradientDrawable ?: return

    if (isHovering) {
      // Facebook red alert dismiss
      bg.setColor(0xEEFF3838.toInt())
      bg.setStroke(dpToPx(3.5f), Color.WHITE)
      targetScaleSpring?.endValue = 1.30
      scaleSpring?.endValue = 0.65
      vibrateDevice(35)
    } else {
      bg.setColor(0xEE1A1E32.toInt())
      bg.setStroke(dpToPx(2.5f), 0x99FFFFFF.toInt())
      targetScaleSpring?.endValue = 1.0
      scaleSpring?.endValue = 0.90
    }
  }

  private fun vibrateDevice(durationMs: Long) {
    try {
      val v = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        v?.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE))
      } else {
        @Suppress("DEPRECATION")
        v?.vibrate(durationMs)
      }
    } catch (_: Exception) {}
  }

  // --- Facebook Messenger Touch & Spring Physics Listener ---
  private inner class FacebookBubbleTouchListener : View.OnTouchListener {
    private var initialX = 0
    private var initialY = 0
    private var initialTouchX = 0f
    private var initialTouchY = 0f
    private var isClick = false
    private var downTime = 0L
    private var velocityTracker: VelocityTracker? = null

    private val clickSlop = dpToPx(8f)
    private val clickTimeout = 250L

    override fun onTouch(v: View?, event: MotionEvent): Boolean {
      val params = layoutParams ?: return false

      if (velocityTracker == null) {
        velocityTracker = VelocityTracker.obtain()
      }
      velocityTracker?.addMovement(event)

      when (event.action) {
        MotionEvent.ACTION_DOWN -> {
          // Stop any active snapping springs
          springX?.setAtRest()
          springY?.setAtRest()

          isClick = true
          initialX = params.x
          initialY = params.y
          initialTouchX = event.rawX
          initialTouchY = event.rawY
          downTime = System.currentTimeMillis()

          // Facebook spring scale-down feedback on press + tactile tick
          vibrateDevice(15)
          scaleSpring?.endValue = 0.90
          return true
        }

        MotionEvent.ACTION_MOVE -> {
          val dx = (event.rawX - initialTouchX).toInt()
          val dy = (event.rawY - initialTouchY).toInt()

          if (abs(dx) > clickSlop || abs(dy) > clickSlop) {
            if (isClick) {
              isClick = false
              showRemoveTarget()
            }
          }

          if (!isClick) {
            val metrics = resources.displayMetrics
            val screenWidth = metrics.widthPixels
            val screenHeight = metrics.heightPixels
            val targetCenterX = screenWidth / 2
            val targetCenterY = screenHeight - dpToPx(102f)

            val currentX = initialX + dx
            val currentY = initialY + dy
            val bubbleCenterX = currentX + bubbleSizePx / 2
            val bubbleCenterY = currentY + bubbleSizePx / 2

            val dist = sqrt(
              ((bubbleCenterX - targetCenterX) * (bubbleCenterX - targetCenterX) +
               (bubbleCenterY - targetCenterY) * (bubbleCenterY - targetCenterY)).toDouble()
            ).toFloat()

            val snapThreshold = dpToPx(130f).toFloat()

            if (dist < snapThreshold) {
              updateRemoveTargetState(true)
              // Magnetic suction into target center
              params.x = targetCenterX - bubbleSizePx / 2
              params.y = targetCenterY - bubbleSizePx / 2
              bubbleView?.rotation = 0f
            } else {
              updateRemoveTargetState(false)
              params.x = currentX
              params.y = currentY
              // Messenger drag tilt wobble effect
              bubbleView?.rotation = (dx / 18f).coerceIn(-16f, 16f)
            }

            lastBubbleX = params.x
            lastBubbleY = params.y
            try {
              windowManager?.updateViewLayout(bubbleView, params)
            } catch (_: Exception) {}
          }
          return true
        }

        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          val duration = System.currentTimeMillis() - downTime

          velocityTracker?.computeCurrentVelocity(1000)
          val vx = velocityTracker?.xVelocity ?: 0f
          val vy = velocityTracker?.yVelocity ?: 0f
          velocityTracker?.recycle()
          velocityTracker = null

          val wasOverTarget = isOverRemoveTarget
          hideRemoveTarget()
          scaleSpring?.endValue = 1.0

          // Smoothly reset tilt angle
          bubbleView?.animate()?.rotation(0f)?.setDuration(180)?.start()

          if (wasOverTarget) {
            // Dismiss bubble with scale-down collapse & vibration
            vibrateDevice(50)
            bubbleView?.animate()
              ?.scaleX(0f)?.scaleY(0f)?.alpha(0f)
              ?.setDuration(160)
              ?.withEndAction {
                hideBubble()
                hideForm()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
              }
              ?.start()
            return true
          }

          if (isClick && duration < clickTimeout) {
            handleBubbleClick()
            return true
          }

          // Use Facebook Rebound physics to snap to nearest edge
          snapBubbleToEdgeRebound(vx)
          return true
        }
      }
      return false
    }
  }

  /**
   * Snaps the floating chat head to either left or right edge of the screen using
   * Facebook Rebound spring physics.
   */
  private fun snapBubbleToEdgeRebound(flingVelocityX: Float) {
    val params = layoutParams ?: return
    val metrics = resources.displayMetrics
    val screenWidth = metrics.widthPixels
    val screenHeight = metrics.heightPixels

    val bubbleCenter = params.x + bubbleSizePx / 2
    val edgeMargin = dpToPx(8f)

    // Determine target X based on center or fling velocity
    val targetX = when {
      flingVelocityX > 900 -> screenWidth - bubbleSizePx - edgeMargin
      flingVelocityX < -900 -> edgeMargin
      bubbleCenter < screenWidth / 2 -> edgeMargin
      else -> screenWidth - bubbleSizePx - edgeMargin
    }

    val topLimit = dpToPx(40f)
    val bottomLimit = screenHeight - bubbleSizePx - dpToPx(70f)
    val clampedY = params.y.coerceIn(topLimit, bottomLimit)

    springX?.currentValue = params.x.toDouble()
    springX?.velocity = flingVelocityX.toDouble()
    springX?.endValue = targetX.toDouble()

    springY?.currentValue = params.y.toDouble()
    springY?.endValue = clampedY.toDouble()
  }

  private fun getCurrencySymbol(): String {
    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    return prefs.getString(PREFS_KEY_CURRENCY, "$") ?: "$"
  }

  companion object {
    const val ACTION_INIT = "com.fiscus.bubble.INIT"
    const val ACTION_SHOW = "com.fiscus.bubble.SHOW"
    const val ACTION_HIDE = "com.fiscus.bubble.HIDE"
    const val ACTION_STOP = "com.fiscus.bubble.STOP"
    const val EXTRA_X = "bubble_x"
    const val EXTRA_Y = "bubble_y"
    const val CHANNEL_ID = "fiscus_bubble_channel"
    const val NOTIFICATION_ID = 4021
    const val PREFS_NAME = "fiscus_bubble_prefs"
    const val PREFS_KEY_TRANSACTIONS = "bubble_transactions"
    const val PREFS_KEY_CATEGORIES = "bubble_categories"
    const val PREFS_KEY_ACCOUNTS = "bubble_accounts"
    const val PREFS_KEY_CURRENCY = "bubble_currency"
    const val ADD_ACCOUNT_OPTION = "Add account"
  }
}
