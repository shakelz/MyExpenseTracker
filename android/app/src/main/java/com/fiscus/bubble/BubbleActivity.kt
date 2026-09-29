package com.fiscus.bubble

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.ArrayAdapter
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import com.fiscus.MainActivity
import com.fiscus.R

class BubbleActivity : Activity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    val scrollView = ScrollView(this).apply {
      layoutParams = ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
      setBackgroundColor(Color.parseColor("#1B1B3A"))
      isFillViewport = true
    }

    val contentLayout = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dpToPx(18f), dpToPx(18f), dpToPx(18f), dpToPx(24f))
      layoutParams = FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
      )
    }

    // --- Header ---
    val headerLayout = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply {
        bottomMargin = dpToPx(14f)
      }
    }

    val appIcon = ImageView(this).apply {
      setImageResource(R.drawable.ic_fiscus_app)
      layoutParams = LinearLayout.LayoutParams(dpToPx(28f), dpToPx(28f)).apply {
        marginEnd = dpToPx(10f)
      }
    }

    val headerTitle = TextView(this).apply {
      text = "Quick Log"
      textSize = 18f
      setTextColor(Color.WHITE)
      typeface = android.graphics.Typeface.DEFAULT_BOLD
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
    }

    val openAppBtn = TextView(this).apply {
      text = "Open App"
      textSize = 12f
      setTextColor(Color.parseColor("#8E96BF"))
      setPadding(dpToPx(10f), dpToPx(6f), dpToPx(10f), dpToPx(6f))
      background = GradientDrawable().apply {
        cornerRadius = dpToPx(8f).toFloat()
        setColor(Color.parseColor("#26294F"))
      }
      setOnClickListener {
        val intent = Intent(this@BubbleActivity, MainActivity::class.java).apply {
          flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        startActivity(intent)
        finish()
      }
    }

    val closeBtn = TextView(this).apply {
      text = "✕"
      textSize = 15f
      setTextColor(Color.parseColor("#8E96BF"))
      setPadding(dpToPx(10f), dpToPx(6f), dpToPx(10f), dpToPx(6f))
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.WRAP_CONTENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply {
        marginStart = dpToPx(6f)
      }
      setOnClickListener {
        finish()
      }
    }

    headerLayout.addView(appIcon)
    headerLayout.addView(headerTitle)
    headerLayout.addView(openAppBtn)
    headerLayout.addView(closeBtn)
    contentLayout.addView(headerLayout)

    // --- Card Container ---
    val cardLayout = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dpToPx(16f), dpToPx(16f), dpToPx(16f), dpToPx(16f))
      background = GradientDrawable().apply {
        cornerRadius = dpToPx(16f).toFloat()
        setColor(Color.parseColor("#20224A"))
        setStroke(dpToPx(1f), Color.parseColor("#323668"))
      }
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      )
    }

    // --- Income / Expense Toggle ---
    val toggleContainer = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      setPadding(dpToPx(4f), dpToPx(4f), dpToPx(4f), dpToPx(4f))
      background = GradientDrawable().apply {
        cornerRadius = dpToPx(12f).toFloat()
        setColor(Color.parseColor("#171836"))
      }
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply {
        bottomMargin = dpToPx(14f)
      }
    }

    fun createTogglePill(title: String): TextView {
      return TextView(this).apply {
        text = title
        textSize = 13f
        gravity = Gravity.CENTER
        setPadding(dpToPx(12f), dpToPx(8f), dpToPx(12f), dpToPx(8f))
        typeface = android.graphics.Typeface.DEFAULT_BOLD
      }
    }

    val expensePill = createTogglePill("Expense")
    val incomePill = createTogglePill("Income")

    var selectedType = "expense"
    val currencySymbol = BubbleStorageHelper.getCurrencySymbol(this)

    val amountLabel = TextView(this).apply {
      text = "Amount ($currencySymbol)"
      textSize = 12f
      setTextColor(Color.parseColor("#B9BED6"))
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply {
        bottomMargin = dpToPx(6f)
      }
    }

    val updateTypeUI = {
      val isExpense = selectedType == "expense"
      expensePill.background = GradientDrawable().apply {
        cornerRadius = dpToPx(10f).toFloat()
        setColor(if (isExpense) Color.parseColor("#E46666") else Color.TRANSPARENT)
      }
      expensePill.setTextColor(if (isExpense) Color.WHITE else Color.parseColor("#8E96BF"))

      incomePill.background = GradientDrawable().apply {
        cornerRadius = dpToPx(10f).toFloat()
        setColor(if (!isExpense) Color.parseColor("#5AC88C") else Color.TRANSPARENT)
      }
      incomePill.setTextColor(if (!isExpense) Color.parseColor("#0F1C12") else Color.parseColor("#8E96BF"))

      amountLabel.text = if (isExpense) "Expense Amount ($currencySymbol)" else "Income Amount ($currencySymbol)"
    }

    expensePill.setOnClickListener {
      selectedType = "expense"
      updateTypeUI()
    }
    incomePill.setOnClickListener {
      selectedType = "income"
      updateTypeUI()
    }

    toggleContainer.addView(
      expensePill,
      LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
    )
    toggleContainer.addView(
      incomePill,
      LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
    )
    cardLayout.addView(toggleContainer)

    // --- Amount Input ---
    cardLayout.addView(amountLabel)

    val amountInput = EditText(this).apply {
      hint = "$currencySymbol 0.00"
      inputType = EditorInfo.TYPE_CLASS_NUMBER or EditorInfo.TYPE_NUMBER_FLAG_DECIMAL
      setPadding(dpToPx(14f), dpToPx(12f), dpToPx(14f), dpToPx(12f))
      setTextColor(Color.WHITE)
      setHintTextColor(Color.parseColor("#5A6088"))
      textSize = 16f
      background = GradientDrawable().apply {
        cornerRadius = dpToPx(10f).toFloat()
        setColor(Color.parseColor("#171836"))
        setStroke(dpToPx(1f), Color.parseColor("#2E3360"))
      }
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply {
        bottomMargin = dpToPx(12f)
      }
    }
    cardLayout.addView(amountInput)

    // --- Note Input ---
    val noteLabel = TextView(this).apply {
      text = "Description / Note"
      textSize = 12f
      setTextColor(Color.parseColor("#B9BED6"))
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply {
        bottomMargin = dpToPx(6f)
      }
    }
    cardLayout.addView(noteLabel)

    val noteInput = EditText(this).apply {
      hint = "What was this for?"
      inputType = EditorInfo.TYPE_CLASS_TEXT or EditorInfo.TYPE_TEXT_FLAG_CAP_SENTENCES
      setPadding(dpToPx(14f), dpToPx(12f), dpToPx(14f), dpToPx(12f))
      setTextColor(Color.WHITE)
      setHintTextColor(Color.parseColor("#5A6088"))
      textSize = 14f
      background = GradientDrawable().apply {
        cornerRadius = dpToPx(10f).toFloat()
        setColor(Color.parseColor("#171836"))
        setStroke(dpToPx(1f), Color.parseColor("#2E3360"))
      }
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply {
        bottomMargin = dpToPx(12f)
      }
    }
    cardLayout.addView(noteInput)

    // --- Category & Account Spinners ---
    val categoryOptions = BubbleStorageHelper.loadCategories(this)
    val accountOptions = BubbleStorageHelper.loadAccounts(this)

    val rowLayout = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply {
        bottomMargin = dpToPx(18f)
      }
    }

    val catCol = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
        marginEnd = dpToPx(8f)
      }
    }
    val catLabel = TextView(this).apply {
      text = "Category"
      textSize = 12f
      setTextColor(Color.parseColor("#B9BED6"))
      setPadding(0, 0, 0, dpToPx(6f))
    }
    val categorySpinner = Spinner(this).apply {
      adapter = ArrayAdapter(
        this@BubbleActivity,
        android.R.layout.simple_spinner_dropdown_item,
        categoryOptions
      )
      background = GradientDrawable().apply {
        cornerRadius = dpToPx(10f).toFloat()
        setColor(Color.parseColor("#171836"))
        setStroke(dpToPx(1f), Color.parseColor("#2E3360"))
      }
      setPadding(dpToPx(10f), dpToPx(10f), dpToPx(10f), dpToPx(10f))
      minimumHeight = dpToPx(44f)
    }
    catCol.addView(catLabel)
    catCol.addView(categorySpinner)

    val accCol = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
        marginStart = dpToPx(8f)
      }
    }
    val accLabel = TextView(this).apply {
      text = "Account"
      textSize = 12f
      setTextColor(Color.parseColor("#B9BED6"))
      setPadding(0, 0, 0, dpToPx(6f))
    }
    val accountLabels = accountOptions.map {
      if (it.name == BubbleStorageHelper.ADD_ACCOUNT_OPTION) it.name
      else "${it.name} (${currencySymbol}${String.format("%.2f", it.balance)})"
    }
    val accountSpinner = Spinner(this).apply {
      adapter = ArrayAdapter(
        this@BubbleActivity,
        android.R.layout.simple_spinner_dropdown_item,
        accountLabels
      )
      background = GradientDrawable().apply {
        cornerRadius = dpToPx(10f).toFloat()
        setColor(Color.parseColor("#171836"))
        setStroke(dpToPx(1f), Color.parseColor("#2E3360"))
      }
      setPadding(dpToPx(10f), dpToPx(10f), dpToPx(10f), dpToPx(10f))
      minimumHeight = dpToPx(44f)
    }
    accCol.addView(accLabel)
    accCol.addView(accountSpinner)

    rowLayout.addView(catCol)
    rowLayout.addView(accCol)
    cardLayout.addView(rowLayout)

    // --- Save Button ---
    val saveBtn = TextView(this).apply {
      text = "Save Transaction"
      textSize = 15f
      setTextColor(Color.WHITE)
      typeface = android.graphics.Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      setPadding(dpToPx(16f), dpToPx(14f), dpToPx(16f), dpToPx(14f))
      background = GradientDrawable().apply {
        cornerRadius = dpToPx(12f).toFloat()
        setColor(Color.parseColor("#4B7BFF"))
      }
      setOnClickListener {
        val amtText = amountInput.text?.toString()?.trim() ?: ""
        val amount = amtText.toDoubleOrNull()
        if (amount == null || amount <= 0) {
          Toast.makeText(this@BubbleActivity, "Please enter a valid amount", Toast.LENGTH_SHORT).show()
          return@setOnClickListener
        }

        val note = noteInput.text?.toString()?.trim() ?: ""
        val category = categorySpinner.selectedItem?.toString()?.trim() ?: "Other"
        val accIndex = accountSpinner.selectedItemPosition
        val selectedAcc = accountOptions.getOrNull(accIndex)
        val accountName = selectedAcc?.name?.trim() ?: ""
        val accountType = selectedAcc?.type ?: "bank"

        BubbleStorageHelper.saveTransaction(
          context = this@BubbleActivity,
          type = selectedType,
          amount = amount,
          note = note,
          accountName = accountName,
          accountType = accountType,
          category = category
        )

        Toast.makeText(this@BubbleActivity, "Saved to Fiscus!", Toast.LENGTH_SHORT).show()
        finish()
      }
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply {
        bottomMargin = dpToPx(10f)
      }
    }
    cardLayout.addView(saveBtn)

    contentLayout.addView(cardLayout)
    scrollView.addView(contentLayout)
    setContentView(scrollView)

    updateTypeUI()
  }

  private fun dpToPx(dp: Float): Int {
    return TypedValue.applyDimension(
      TypedValue.COMPLEX_UNIT_DIP,
      dp,
      resources.displayMetrics
    ).toInt()
  }
}
