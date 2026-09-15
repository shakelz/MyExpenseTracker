package com.fiscus.notification

import android.app.Notification
import android.content.Context
import android.content.SharedPreferences
import android.os.Handler
import android.os.Looper
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import android.widget.Toast
import com.fiscus.bubble.SystemBubbleService
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.regex.Pattern

class BankNotificationListenerService : NotificationListenerService() {

  companion object {
    private const val TAG = "BankNotificationListener"
    private const val PREFS_NAME = SystemBubbleService.PREFS_NAME
    private const val PREFS_KEY_TRANSACTIONS = SystemBubbleService.PREFS_KEY_TRANSACTIONS
    private const val PREFS_KEY_SEEN = "processed_notification_ids"

    // Callback listener for React Native module
    var onTransactionAddedListener: ((JSONObject) -> Unit)? = null
  }

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    if (sbn == null) return
    val packageName = sbn.packageName ?: return

    // Skip our own notifications
    if (packageName == applicationContext.packageName) return

    val extras = sbn.notification.extras ?: return
    val title = extras.getString(Notification.EXTRA_TITLE) ?: ""
    val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
    val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: ""
    val subText = extras.getString(Notification.EXTRA_SUB_TEXT) ?: ""

    val combinedContent = "$title $text $bigText $subText".trim()
    if (combinedContent.isBlank()) return

    Log.d(TAG, "Notification received from $packageName: $combinedContent")

    // Parse transaction details
    val transaction = parseFinancialNotification(packageName, title, combinedContent) ?: return

    // Deduplication check
    val notificationKey = "${sbn.id}_${sbn.postTime}_${transaction.optDouble("amount")}"
    if (isNotificationAlreadyProcessed(notificationKey)) {
      Log.d(TAG, "Notification already processed: $notificationKey")
      return
    }
    markNotificationProcessed(notificationKey)

    // Save transaction to pending queue
    saveTransaction(transaction)

    // Notify live listener (if app is running)
    try {
      onTransactionAddedListener?.invoke(transaction)
    } catch (e: Exception) {
      Log.e(TAG, "Failed to invoke live listener", e)
    }

    // Show friendly Toast on UI thread
    Handler(Looper.getMainLooper()).post {
      try {
        val amount = transaction.optDouble("amount")
        val account = transaction.optString("accountName")
        val type = transaction.optString("type")
        val verb = if (type == "income") "received" else "spent"
        Toast.makeText(
          applicationContext,
          "Fiscus: Auto-added $verb ${String.format(Locale.US, "%.2f", amount)} ($account)",
          Toast.LENGTH_LONG
        ).show()
      } catch (e: Exception) {
        Log.e(TAG, "Error showing toast", e)
      }
    }
  }

  private fun parseFinancialNotification(
    packageName: String,
    title: String,
    content: String
  ): JSONObject? {
    val lowerContent = content.lowercase(Locale.ROOT)

    // Filter out OTPs and authentication alerts
    if (lowerContent.contains("otp") ||
        lowerContent.contains("verification code") ||
        lowerContent.contains("one time password") ||
        lowerContent.contains("login alert") ||
        lowerContent.contains("logged in") ||
        lowerContent.contains("device registered")
    ) {
      // If it contains "debit" or "credit", make sure it's not just "your OTP for debit card is..."
      if (!lowerContent.contains("debited") && !lowerContent.contains("credited") && !lowerContent.contains("transferred")) {
        return null
      }
    }

    // Determine type: income vs expense
    val isExpense = lowerContent.contains("debit") ||
        lowerContent.contains("debited") ||
        lowerContent.contains("spent") ||
        lowerContent.contains("paid") ||
        lowerContent.contains("payment to") ||
        lowerContent.contains("withdrawn") ||
        lowerContent.contains("purchase") ||
        lowerContent.contains("sent") ||
        lowerContent.contains("charged") ||
        lowerContent.contains("transfer to") ||
        lowerContent.contains("transferred to") ||
        lowerContent.contains("order placed") ||
        lowerContent.contains("deducted")

    val isIncome = lowerContent.contains("credit") ||
        lowerContent.contains("credited") ||
        lowerContent.contains("received") ||
        lowerContent.contains("deposited") ||
        lowerContent.contains("deposit") ||
        lowerContent.contains("salary") ||
        lowerContent.contains("refund") ||
        lowerContent.contains("cashback") ||
        lowerContent.contains("transfer from") ||
        lowerContent.contains("transferred from") ||
        lowerContent.contains("added to your account")

    if (!isExpense && !isIncome) {
      return null
    }

    // Extract amount
    val amount = extractAmount(content) ?: return null
    if (amount <= 0.0) return null

    // Determine bank name & account type
    val (bankName, accountType) = extractBankDetails(packageName, title, content)

    // Smart category
    val category = inferCategory(content, isExpense)

    // Build summary note
    val note = buildNote(content, isExpense, bankName, amount)

    val obj = JSONObject()
    obj.put("id", System.currentTimeMillis().toString())
    obj.put("type", if (isIncome && !isExpense) "income" else "expense")
    obj.put("amount", amount)
    obj.put("note", note)

    val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
    isoFormat.timeZone = TimeZone.getTimeZone("UTC")
    obj.put("createdAt", isoFormat.format(Date()))

    obj.put("accountName", bankName)
    obj.put("accountType", accountType)
    obj.put("category", category)

    return obj
  }

  private fun extractAmount(text: String): Double? {
    // Remove "available balance", "avl bal", "bal:" portions to prevent capturing balance instead of transaction amount
    val cleaned = text.replace(Regex("(?i)(?:avl\\.?\\s*bal(?:ance)?|available\\s*balance|bal(?:ance)?)\\s*[:=-]?\\s*(?:rs\\.?|pkr|inr|usd|eur|gbp|aed|₹|\\$|€|£)?\\s*[0-9,]+(?:\\.[0-9]{1,2})?", RegexOption.IGNORE_CASE), "")

    // Match currency followed by amount or transaction action followed by amount
    val patterns = listOf(
      Pattern.compile("(?:rs\\.?|pkr|inr|usd|eur|gbp|aed|₹|\\$|€|£)\\s*([0-9]+(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)", Pattern.CASE_INSENSITIVE),
      Pattern.compile("(?:debited|credited|spent|paid|sent|received|transfer(?:red)?|amount|withdrawn|charged|purchase(?:d)?)\\s*(?:by|of|is|for)?\\s*(?:rs\\.?|pkr|inr|usd|eur|gbp|aed|₹|\\$|€|£)?\\s*([0-9]+(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)", Pattern.CASE_INSENSITIVE),
      Pattern.compile("([0-9]+(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)\\s*(?:rs\\.?|pkr|inr|usd|eur|gbp|aed|₹|\\$|€|£)", Pattern.CASE_INSENSITIVE)
    )

    for (pattern in patterns) {
      val matcher = pattern.matcher(cleaned)
      if (matcher.find()) {
        val rawNum = matcher.group(1)?.replace(",", "") ?: continue
        val parsed = rawNum.toDoubleOrNull()
        if (parsed != null && parsed > 0.0) {
          return parsed
        }
      }
    }

    return null
  }

  private fun extractBankDetails(packageName: String, title: String, content: String): Pair<String, String> {
    val fullText = "$packageName $title $content".lowercase(Locale.ROOT)

    return when {
      fullText.contains("meezan") || fullText.contains("moazzin") -> Pair("Meezan Bank", "bank")
      fullText.contains("easypaisa") || fullText.contains("telenor") -> Pair("Easypaisa", "wallet")
      fullText.contains("jazzcash") || fullText.contains("mobilink") -> Pair("JazzCash", "wallet")
      fullText.contains("sadapay") -> Pair("SadaPay", "wallet")
      fullText.contains("nayapay") -> Pair("NayaPay", "wallet")
      fullText.contains("hbl") || fullText.contains("habib bank") -> Pair("HBL", "bank")
      fullText.contains("alfalah") || fullText.contains("alfa") -> Pair("Bank Alfalah", "bank")
      fullText.contains("mcb") -> Pair("MCB", "bank")
      fullText.contains("ubl") -> Pair("UBL", "bank")
      fullText.contains("allied") || fullText.contains("abl") -> Pair("Allied Bank", "bank")
      fullText.contains("standard chartered") || fullText.contains("scb") -> Pair("Standard Chartered", "bank")
      fullText.contains("faysal") -> Pair("Faysal Bank", "bank")
      fullText.contains("askari") -> Pair("Askari Bank", "bank")
      fullText.contains("bop") || fullText.contains("bank of punjab") -> Pair("Bank of Punjab", "bank")
      fullText.contains("habib metro") || fullText.contains("habibmetro") -> Pair("Habib Metro", "bank")
      fullText.contains("chase") -> Pair("Chase", "bank")
      fullText.contains("wells fargo") -> Pair("Wells Fargo", "bank")
      fullText.contains("revolut") -> Pair("Revolut", "wallet")
      fullText.contains("monzo") -> Pair("Monzo", "bank")
      fullText.contains("n26") -> Pair("N26", "bank")
      fullText.contains("paypal") -> Pair("PayPal", "wallet")
      fullText.contains("paytm") -> Pair("Paytm", "wallet")
      fullText.contains("phonepe") -> Pair("PhonePe", "wallet")
      fullText.contains("google pay") || fullText.contains("gpay") -> Pair("Google Pay", "wallet")
      else -> {
        // Fallback to title if meaningful (e.g. sender title in SMS)
        val cleanTitle = title.trim()
        if (cleanTitle.isNotBlank() && cleanTitle.length in 3..25 && !cleanTitle.contains("message", true)) {
          Pair(cleanTitle, "bank")
        } else {
          Pair("Bank", "bank")
        }
      }
    }
  }

  private fun inferCategory(content: String, isExpense: Boolean): String {
    if (!isExpense) return "Salary"
    val lower = content.lowercase(Locale.ROOT)

    return when {
      lower.contains("foodpanda") || lower.contains("kfc") || lower.contains("mcdonald") ||
      lower.contains("burger") || lower.contains("pizza") || lower.contains("restaurant") ||
      lower.contains("cafe") || lower.contains("dining") || lower.contains("grocer") ||
      lower.contains("supermarket") || lower.contains("mart") || lower.contains("store") -> "Groceries"

      lower.contains("careem") || lower.contains("uber") || lower.contains("indrive") ||
      lower.contains("petrol") || lower.contains("fuel") || lower.contains("pso") ||
      lower.contains("shell") || lower.contains("transport") || lower.contains("flight") ||
      lower.contains("airline") -> "Travel"

      lower.contains("bill") || lower.contains("electric") || lower.contains("lesco") ||
      lower.contains("kelectric") || lower.contains("iesco") || lower.contains("sngpl") ||
      lower.contains("ssgc") || lower.contains("ptcl") || lower.contains("nayatel") ||
      lower.contains("stormfiber") || lower.contains("utility") -> "Bills"

      lower.contains("netflix") || lower.contains("spotify") || lower.contains("youtube") ||
      lower.contains("cinema") || lower.contains("movie") || lower.contains("steam") ||
      lower.contains("game") -> "Entertainment"

      lower.contains("daraz") || lower.contains("amazon") || lower.contains("aliexpress") ||
      lower.contains("outfitters") || lower.contains("khaadi") || lower.contains("sapphire") ||
      lower.contains("shopping") || lower.contains("mall") -> "Shopping"

      else -> "Other"
    }
  }

  private fun buildNote(content: String, isExpense: Boolean, bankName: String, amount: Double): String {
    // Look for merchant/destination e.g. "at Foodpanda", "to John Doe", "info: xyz"
    val merchantMatcher = Pattern.compile("(?i)(?:at|to|for|info:?)\\s+([A-Za-z0-9 ._-]{3,30})").matcher(content)
    if (merchantMatcher.find()) {
      val target = merchantMatcher.group(1)?.trim() ?: ""
      if (target.isNotBlank() && !target.equals("your", true) && !target.equals("account", true)) {
        val action = if (isExpense) "Spent at" else "Received from"
        return "$action $target"
      }
    }
    return if (isExpense) "Auto Bank Debit" else "Auto Bank Credit"
  }

  private fun saveTransaction(obj: JSONObject) {
    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val raw = prefs.getString(PREFS_KEY_TRANSACTIONS, "[]") ?: "[]"
    val array = JSONArray(raw)
    array.put(obj)
    prefs.edit().putString(PREFS_KEY_TRANSACTIONS, array.toString()).apply()
    Log.d(TAG, "Transaction saved: $obj")
  }

  private fun isNotificationAlreadyProcessed(key: String): Boolean {
    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val seen = prefs.getStringSet(PREFS_KEY_SEEN, emptySet()) ?: emptySet()
    return seen.contains(key)
  }

  private fun markNotificationProcessed(key: String) {
    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val seen = (prefs.getStringSet(PREFS_KEY_SEEN, emptySet()) ?: emptySet()).toMutableSet()
    // Keep max 500 keys to avoid unlimited growth
    if (seen.size > 500) {
      seen.clear()
    }
    seen.add(key)
    prefs.edit().putStringSet(PREFS_KEY_SEEN, seen).apply()
  }
}
