package com.fiscus.bubble

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.animation.ValueAnimator
import android.os.Build
import android.os.IBinder
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.ArrayAdapter
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationCompat
import com.fiscus.R
import org.json.JSONArray
import org.json.JSONObject

class SystemBubbleService : Service() {
  private var windowManager: WindowManager? = null
  private var bubbleView: View? = null
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

  private data class AccountOption(val name: String, val type: String, val balance: Double)

  override fun onBind(intent: Intent?): IBinder? = null

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
      }
      ACTION_STOP -> {
        hideBubble()
        hideForm()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
      }
    }
    return START_STICKY
  }

  override fun onDestroy() {
    hideBubble()
    super.onDestroy()
  }

  private fun showBubble(x: Int, y: Int) {
    if (bubbleView != null) return
    hideForm()

    val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    windowManager = wm

    val sizePx = dpToPx(56f)
    bubbleSizePx = sizePx
    val container = FrameLayout(this)
    val bubble = ImageView(this)

    val bg = GradientDrawable().apply {
      shape = GradientDrawable.OVAL
      setColor(0xFFFFFFFF.toInt())
      setStroke(dpToPx(1f), 0x22000000)
    }
    bubble.background = bg
    bubble.setImageResource(R.drawable.ic_fiscus_app)
    bubble.scaleType = ImageView.ScaleType.CENTER_INSIDE
    bubble.setPadding(dpToPx(10f), dpToPx(10f), dpToPx(10f), dpToPx(10f))

    container.addView(
      bubble,
      FrameLayout.LayoutParams(sizePx, sizePx)
    )

    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }

    layoutParams = WindowManager.LayoutParams(
      sizePx,
      sizePx,
      type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      this.x = x
      this.y = y
    }

    lastBubbleX = x
    lastBubbleY = y

    container.setOnTouchListener(BubbleTouchListener())

    wm.addView(container, layoutParams)
    bubbleView = container
  }

  private fun hideBubble() {
    val view = bubbleView ?: return
    windowManager?.removeView(view)
    bubbleView = null
  }

  private fun handleBubbleClick() {
    val bubble = bubbleView
    if (bubble == null) {
      showForm()
      return
    }

    bubble.animate()
      .translationYBy(dpToPx(12f).toFloat())
      .alpha(0f)
      .setDuration(120)
      .withEndAction {
        hideBubble()
        showForm()
      }
      .start()
  }

  private fun showForm() {
    if (formView != null) return
    val wm = windowManager ?: return

    val root = FrameLayout(this)
    root.layoutParams = FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.MATCH_PARENT
    )
    root.setBackgroundColor(0x00000000)

    val bubbleSize = if (bubbleSizePx > 0) bubbleSizePx else dpToPx(56f)

    val cardBackground = GradientDrawable().apply {
      cornerRadius = bubbleSize / 2f
      setColor(0xCC1F243A.toInt())
      setStroke(dpToPx(1f), 0x55FFFFFF)
    }

    val cardContainer = FrameLayout(this).apply {
      background = cardBackground
      elevation = dpToPx(10f).toFloat()
    }

    val cardContent = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dpToPx(16f), dpToPx(16f), dpToPx(16f), dpToPx(16f))
      alpha = 0f
    }
    cardContent.layoutParams = FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.WRAP_CONTENT
    )

    val dragHandle = View(this).apply {
      background = GradientDrawable().apply {
        cornerRadius = dpToPx(3f).toFloat()
        setColor(0x66FFFFFF)
      }
    }
    val dragParams = LinearLayout.LayoutParams(dpToPx(44f), dpToPx(6f)).apply {
      gravity = Gravity.CENTER_HORIZONTAL
      bottomMargin = dpToPx(10f)
    }
    cardContent.addView(dragHandle, dragParams)

    fun createPill(textValue: String, bgColor: Int, textColor: Int): TextView {
      return TextView(this).apply {
        text = textValue
        textSize = 12f
        setTextColor(textColor)
        setPadding(dpToPx(12f), dpToPx(8f), dpToPx(12f), dpToPx(8f))
        background = GradientDrawable().apply {
          cornerRadius = dpToPx(12f).toFloat()
          setColor(bgColor)
        }
      }
    }

    val toggleContainer = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      setPadding(dpToPx(4f), dpToPx(4f), dpToPx(4f), dpToPx(4f))
      background = GradientDrawable().apply {
        cornerRadius = dpToPx(14f).toFloat()
        setColor(0xFF3A3D5C.toInt())
      }
    }

    val incomeToggle = createPill("Income", 0xFF5AC88C.toInt(), 0xFF0F1C12.toInt())
    val expenseToggle = createPill("Expense", 0xFF4A4E72.toInt(), 0xFFFFFFFF.toInt())

    val currencySymbol = getCurrencySymbol()
    val amountLabel = TextView(this).apply {
      text = "Total Expense (${currencySymbol})"
      textSize = 12f
      setTextColor(0xFFB9BED6.toInt())
    }

    var selectedType = "expense"
    val updateTypeUi = {
      val incomeSelected = selectedType == "income"
      incomeToggle.background = GradientDrawable().apply {
        cornerRadius = dpToPx(12f).toFloat()
        setColor(if (incomeSelected) 0xFF5AC88C.toInt() else 0xFF4A4E72.toInt())
      }
      incomeToggle.setTextColor(if (incomeSelected) 0xFF0F1C12.toInt() else 0xFFFFFFFF.toInt())
      expenseToggle.background = GradientDrawable().apply {
        cornerRadius = dpToPx(12f).toFloat()
        setColor(if (incomeSelected) 0xFF4A4E72.toInt() else 0xFFE46666.toInt())
      }
      expenseToggle.setTextColor(if (incomeSelected) 0xFFFFFFFF.toInt() else 0xFFFFFFFF.toInt())
      amountLabel.text = if (incomeSelected) {
        "Total Income (${currencySymbol})"
      } else {
        "Total Expense (${currencySymbol})"
      }
    }

    incomeToggle.setOnClickListener {
      selectedType = "income"
      updateTypeUi()
    }
    expenseToggle.setOnClickListener {
      selectedType = "expense"
      updateTypeUi()
    }

    toggleContainer.addView(
      incomeToggle,
      LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
    )
    toggleContainer.addView(
      expenseToggle,
      LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
    )

    fun createInputBackground(): GradientDrawable {
      return GradientDrawable().apply {
        cornerRadius = dpToPx(12f).toFloat()
        setColor(0xFFFFFFFF.toInt())
      }
    }

    val amountInput = EditText(this).apply {
      hint = "${currencySymbol} 0.00"
      inputType = EditorInfo.TYPE_CLASS_NUMBER or EditorInfo.TYPE_NUMBER_FLAG_DECIMAL
      setPadding(dpToPx(12f), dpToPx(10f), dpToPx(12f), dpToPx(10f))
      setTextColor(0xFF1B1F33.toInt())
      setHintTextColor(0xFF9BA3C7.toInt())
      background = createInputBackground()
      minHeight = dpToPx(44f)
    }

    val noteInput = EditText(this).apply {
      hint = "What did you buy?"
      inputType = EditorInfo.TYPE_CLASS_TEXT or EditorInfo.TYPE_TEXT_FLAG_CAP_SENTENCES
      setPadding(dpToPx(12f), dpToPx(10f), dpToPx(12f), dpToPx(10f))
      setTextColor(0xFF1B1F33.toInt())
      setHintTextColor(0xFF9BA3C7.toInt())
      background = createInputBackground()
      minHeight = dpToPx(44f)
    }

    val categoryLabel = TextView(this).apply {
      text = "Category"
      textSize = 12f
      setTextColor(0xFFB9BED6.toInt())
    }
    val bankLabel = TextView(this).apply {
      text = "Bank/Wallet"
      textSize = 12f
      setTextColor(0xFFB9BED6.toInt())
    }
    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val categoryOptions = loadCategories(prefs)
    val accountOptions = loadAccounts(prefs)

    val categorySpinner = Spinner(this).apply {
      adapter = ArrayAdapter(
        this@SystemBubbleService,
        android.R.layout.simple_spinner_dropdown_item,
        categoryOptions
      )
      background = createInputBackground()
      setPadding(dpToPx(12f), dpToPx(10f), dpToPx(12f), dpToPx(10f))
      minimumHeight = dpToPx(44f)
    }

    val accountLabels = accountOptions.map { option ->
      if (option.name == ADD_ACCOUNT_OPTION) {
        option.name
      } else {
        "${option.name} · ${currencySymbol}${String.format("%.2f", option.balance)}"
      }
    }

    val accountSpinner = Spinner(this).apply {
      adapter = ArrayAdapter(
        this@SystemBubbleService,
        android.R.layout.simple_spinner_dropdown_item,
        accountLabels
      )
      background = createInputBackground()
      setPadding(dpToPx(12f), dpToPx(10f), dpToPx(12f), dpToPx(10f))
      minimumHeight = dpToPx(44f)
    }

    var selectedCategory = categoryOptions.firstOrNull() ?: "Other"
    var selectedBank = accountOptions.firstOrNull()?.name ?: ""
    var selectedAccountType = accountOptions.firstOrNull()?.type ?: "bank"
    categorySpinner.setSelection(0)
    accountSpinner.setSelection(0)


    val saveButton = TextView(this).apply {
      text = "Save Transaction"
      textSize = 14f
      setTextColor(0xFFFFFFFF.toInt())
      setPadding(dpToPx(14f), dpToPx(12f), dpToPx(14f), dpToPx(12f))
      background = GradientDrawable().apply {
        cornerRadius = dpToPx(12f).toFloat()
        setColor(0xFF4B7BFF.toInt())
      }
      gravity = Gravity.CENTER
    }
    val cancelButton = TextView(this).apply {
      text = "Cancel"
      textSize = 12f
      setTextColor(0xFFB9BED6.toInt())
      gravity = Gravity.CENTER
    }

    saveButton.setOnClickListener {
      val amountText = amountInput.text?.toString()?.trim() ?: ""
      val amount = amountText.toDoubleOrNull()
      if (amount == null || amount <= 0) {
        Toast.makeText(this, "Enter a valid amount", Toast.LENGTH_SHORT).show()
        return@setOnClickListener
      }
      val note = noteInput.text?.toString()?.trim() ?: ""
      selectedCategory = categorySpinner.selectedItem?.toString()?.trim() ?: "Other"
      val accountIndex = accountSpinner.selectedItemPosition
      val selectedAccount = accountOptions.getOrNull(accountIndex)
      selectedBank = selectedAccount?.name?.trim() ?: ""
      selectedAccountType = selectedAccount?.type ?: "bank"
      if (selectedBank == ADD_ACCOUNT_OPTION) {
        openAddAccount()
        Toast.makeText(this, "Open the app to add an account", Toast.LENGTH_SHORT).show()
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
      Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show()
      closeFormAndReturnBubble()
    }

    cancelButton.setOnClickListener {
      closeFormAndReturnBubble()
    }

    cardContent.addView(toggleContainer)
    cardContent.addView(spaceView(10f))
    cardContent.addView(amountLabel)
    cardContent.addView(spaceView(6f))

    amountInput.layoutParams = LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      LinearLayout.LayoutParams.WRAP_CONTENT
    )
    cardContent.addView(amountInput)
    cardContent.addView(spaceView(8f))
    noteInput.layoutParams = LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      LinearLayout.LayoutParams.WRAP_CONTENT
    )
    cardContent.addView(noteInput)
    cardContent.addView(spaceView(10f))

    val row = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
    }
    val categoryColumn = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
    }
    val bankColumn = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
    }
    categoryColumn.addView(categoryLabel)
    categoryColumn.addView(spaceView(6f))
    categorySpinner.layoutParams = LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      LinearLayout.LayoutParams.WRAP_CONTENT
    )
    categoryColumn.addView(categorySpinner)
    bankColumn.addView(bankLabel)
    bankColumn.addView(spaceView(6f))
    accountSpinner.layoutParams = LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      LinearLayout.LayoutParams.WRAP_CONTENT
    )
    bankColumn.addView(accountSpinner)
    row.addView(
      categoryColumn,
      LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
    )
    row.addView(View(this).apply {
      layoutParams = LinearLayout.LayoutParams(dpToPx(10f), LinearLayout.LayoutParams.MATCH_PARENT)
    })
    row.addView(
      bankColumn,
      LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
    )

    cardContent.addView(row)
    cardContent.addView(spaceView(12f))
    cardContent.addView(saveButton)
    cardContent.addView(spaceView(6f))
    cardContent.addView(cancelButton)

    updateTypeUi()

    var dragStartX = 0f
    var dragStartY = 0f
    var cardStartMarginX = 0
    var cardStartMarginY = 0
    var isDragging = false
    val dragSlop = dpToPx(8f)

    cardContainer.setOnTouchListener { _, event ->
      when (event.action) {
        MotionEvent.ACTION_DOWN -> {
          dragStartX = event.rawX
          dragStartY = event.rawY
          val params = cardContainer.layoutParams as FrameLayout.LayoutParams
          cardStartMarginX = params.leftMargin
          cardStartMarginY = params.topMargin
          isDragging = false
          true
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = event.rawX - dragStartX
          val dy = event.rawY - dragStartY
          if (!isDragging && (Math.abs(dx) > dragSlop || Math.abs(dy) > dragSlop)) {
            isDragging = true
          }
          if (isDragging) {
            val params = cardContainer.layoutParams as FrameLayout.LayoutParams
            val maxX = (root.width - cardContainer.width).coerceAtLeast(0)
            val maxY = (root.height - cardContainer.height).coerceAtLeast(0)
            params.leftMargin = (cardStartMarginX + dx.toInt()).coerceIn(0, maxX)
            params.topMargin = (cardStartMarginY + dy.toInt()).coerceIn(0, maxY)
            cardContainer.layoutParams = params
          }
          true
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          isDragging = false
          true
        }
        else -> false
      }
    }

    dragHandle.setOnTouchListener { v, event ->
      cardContainer.onTouchEvent(event)
    }

    cardContainer.addView(cardContent)

    val cardParams = FrameLayout.LayoutParams(
      bubbleSize,
      bubbleSize
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      leftMargin = lastBubbleX
      topMargin = lastBubbleY
    }

    root.addView(cardContainer, cardParams)
    cardContainer.post {
      val metrics = resources.displayMetrics
      val targetWidth = dpToPx(320f)
      val widthSpec = View.MeasureSpec.makeMeasureSpec(targetWidth, View.MeasureSpec.EXACTLY)
      val heightSpec = View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
      cardContent.measure(widthSpec, heightSpec)
      val targetHeight = cardContent.measuredHeight

      val startWidth = bubbleSize
      val startHeight = bubbleSize
      val startX = lastBubbleX
      val startY = lastBubbleY
      val targetX = ((metrics.widthPixels - targetWidth) / 2f).toInt()
      val targetY = (metrics.heightPixels * 0.12f).toInt()
      val startRadius = bubbleSize / 2f
      val targetRadius = dpToPx(18f).toFloat()

      val animator = ValueAnimator.ofFloat(0f, 1f)
      animator.duration = 260
      isAnimatingForm = true
      animator.addUpdateListener { animation ->
        val progress = animation.animatedValue as Float
        val nextWidth = (startWidth + (targetWidth - startWidth) * progress).toInt()
        val nextHeight = (startHeight + (targetHeight - startHeight) * progress).toInt()
        val nextX = (startX + (targetX - startX) * progress).toInt()
        val nextY = (startY + (targetY - startY) * progress).toInt()
        val params = cardContainer.layoutParams as FrameLayout.LayoutParams
        params.width = nextWidth
        params.height = nextHeight
        params.leftMargin = nextX
        params.topMargin = nextY
        cardContainer.layoutParams = params
        cardBackground.cornerRadius = startRadius + (targetRadius - startRadius) * progress
        val contentAlpha = ((progress - 0.2f) / 0.8f).coerceIn(0f, 1f)
        cardContent.alpha = contentAlpha
      }
      animator.addListener(object : android.animation.AnimatorListenerAdapter() {
        override fun onAnimationEnd(animation: android.animation.Animator) {
          val params = cardContainer.layoutParams as FrameLayout.LayoutParams
          params.width = targetWidth
          params.height = targetHeight
          params.leftMargin = targetX
          params.topMargin = targetY
          cardContainer.layoutParams = params
          cardContent.alpha = 1f
          isAnimatingForm = false
        }
      })
      animator.start()
    }

    root.setOnTouchListener { _, event ->
      if (event.action == MotionEvent.ACTION_DOWN) {
        val cardRect = android.graphics.Rect()
        cardContainer.getGlobalVisibleRect(cardRect)
        if (!cardRect.contains(event.rawX.toInt(), event.rawY.toInt())) {
          val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
          val isKeyboardOpen = imm.isAcceptingText
          if (isKeyboardOpen) {
            imm.hideSoftInputFromWindow(root.windowToken, 0)
            root.clearFocus()
          } else {
            closeFormAndReturnBubble()
          }
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
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING
    }

    wm.addView(root, params)
    formView = root
    formRoot = root
    formCard = cardContainer
    formContent = cardContent
    formBackground = cardBackground
    isAnimatingForm = false
  }

  private fun hideForm() {
    val view = formView ?: return
    windowManager?.removeView(view)
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
    val root = formRoot
    val content = formContent
    val background = formBackground
    if (card == null || root == null || content == null || background == null) {
      hideForm()
      showBubble(lastBubbleX, lastBubbleY)
      snapBubbleToEdge()
      return
    }

    val params = card.layoutParams as? FrameLayout.LayoutParams
    if (params == null) {
      hideForm()
      showBubble(lastBubbleX, lastBubbleY)
      snapBubbleToEdge()
      return
    }

    isAnimatingForm = true
    val startWidth = card.width
    val startHeight = card.height
    val startX = params.leftMargin
    val startY = params.topMargin
    val bubbleSize = if (bubbleSizePx > 0) bubbleSizePx else dpToPx(56f)
    val targetWidth = bubbleSize
    val targetHeight = bubbleSize
    val targetX = lastBubbleX
    val targetY = lastBubbleY
    val startRadius = background.cornerRadius
    val targetRadius = bubbleSize / 2f

    val animator = ValueAnimator.ofFloat(0f, 1f)
    animator.duration = 220
    animator.addUpdateListener { animation ->
      val progress = animation.animatedValue as Float
      val nextWidth = (startWidth + (targetWidth - startWidth) * progress).toInt()
      val nextHeight = (startHeight + (targetHeight - startHeight) * progress).toInt()
      val nextX = (startX + (targetX - startX) * progress).toInt()
      val nextY = (startY + (targetY - startY) * progress).toInt()
      params.width = nextWidth
      params.height = nextHeight
      params.leftMargin = nextX
      params.topMargin = nextY
      card.layoutParams = params
      background.cornerRadius = startRadius + (targetRadius - startRadius) * progress
      content.alpha = (1f - progress).coerceIn(0f, 1f)
    }
    animator.addListener(object : android.animation.AnimatorListenerAdapter() {
      override fun onAnimationEnd(animation: android.animation.Animator) {
        hideForm()
        showBubble(lastBubbleX, lastBubbleY)
        snapBubbleToEdge()
        isAnimatingForm = false
      }
    })
    animator.start()
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
    obj.put("note", note)
    val isoFormat = java.text.SimpleDateFormat(
      "yyyy-MM-dd'T'HH:mm:ss'Z'",
      java.util.Locale.US
    )
    isoFormat.timeZone = java.util.TimeZone.getTimeZone("UTC")
    obj.put("createdAt", isoFormat.format(java.util.Date(createdAtMillis)))
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
      .setContentTitle("Fiscus bubble active")
      .setContentText("Tap the bubble to add a transaction")
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
      "Groceries",
      "Bills",
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
      if (items.isEmpty()) listOf("Other") else items
    } catch (_: Exception) {
      listOf("Other")
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
    } catch (_: Exception) {
      // ignore
    }
  }

  private inner class BubbleTouchListener : View.OnTouchListener {
    private var initialX = 0
    private var initialY = 0
    private var initialTouchX = 0f
    private var initialTouchY = 0f
    private var isClick = false
    private var downTime = 0L

    private val clickSlop = dpToPx(6f)
    private val longPressMs = 250L

    override fun onTouch(v: View?, event: MotionEvent): Boolean {
      val params = layoutParams ?: return false
      when (event.action) {
        MotionEvent.ACTION_DOWN -> {
          isClick = true
          initialX = params.x
          initialY = params.y
          initialTouchX = event.rawX
          initialTouchY = event.rawY
          downTime = System.currentTimeMillis()
          return true
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = (event.rawX - initialTouchX).toInt()
          val dy = (event.rawY - initialTouchY).toInt()
          if (kotlin.math.abs(dx) > clickSlop || kotlin.math.abs(dy) > clickSlop) {
            isClick = false
          }
          params.x = initialX + dx
          params.y = initialY + dy
          windowManager?.updateViewLayout(bubbleView, params)
          return true
        }
        MotionEvent.ACTION_UP -> {
          val duration = System.currentTimeMillis() - downTime
          if (isClick && duration < longPressMs) {
            handleBubbleClick()
          }
          lastBubbleX = params.x
          lastBubbleY = params.y
          if (!isClick) {
            snapBubbleToEdge()
          }
          return true
        }
      }
      return false
    }
  }

  private fun snapBubbleToEdge() {
    val params = layoutParams ?: return
    val metrics = resources.displayMetrics
    val screenWidth = metrics.widthPixels
    val screenHeight = metrics.heightPixels
    val edgeX = if (params.x + bubbleSizePx / 2 < screenWidth / 2) 0
    else screenWidth - bubbleSizePx
    val clampedY = params.y.coerceIn(0, screenHeight - bubbleSizePx)
    val startX = params.x
    val startY = params.y
    val animator = ValueAnimator.ofFloat(0f, 1f)
    animator.duration = 200
    animator.addUpdateListener { valueAnimator ->
      val t = valueAnimator.animatedValue as Float
      params.x = (startX + (edgeX - startX) * t).toInt()
      params.y = (startY + (clampedY - startY) * t).toInt()
      windowManager?.updateViewLayout(bubbleView, params)
      lastBubbleX = params.x
      lastBubbleY = params.y
    }
    animator.start()
  }

  private fun moveBubbleToCenter() {
    val params = layoutParams ?: return
    val metrics = resources.displayMetrics
    val screenWidth = metrics.widthPixels
    val screenHeight = metrics.heightPixels
    val targetX = (screenWidth - bubbleSizePx) / 2
    val targetY = (screenHeight - bubbleSizePx) / 2
    params.x = targetX
    params.y = targetY
    windowManager?.updateViewLayout(bubbleView, params)
    lastBubbleX = params.x
    lastBubbleY = params.y
  }

  // keep bubble on the nearest side edge

  private fun getCurrencySymbol(): String {
    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    return prefs.getString(PREFS_KEY_CURRENCY, "$" ) ?: "$"
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
