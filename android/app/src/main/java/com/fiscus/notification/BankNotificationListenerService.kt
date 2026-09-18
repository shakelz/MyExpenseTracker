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
    private const val PREFS_KEY_RECENT_TXS = "recent_processed_transactions_v2"

    // Deduplication window: 180 seconds (3 minutes)
    private const val DEDUP_WINDOW_MS = 180_000L

    // Callback listener for React Native module
    var onTransactionAddedListener: ((JSONObject) -> Unit)? = null

    // Known Pakistani bank SMS shortcodes
    private val SMS_SHORTCODES = mapOf(
      "3737" to Pair("Easypaisa", "wallet"),
      "8558" to Pair("JazzCash", "wallet"),
      "8282" to Pair("Meezan Bank", "bank"),
      "4250" to Pair("HBL", "bank"),
      "2252" to Pair("MCB", "bank"),
      "8257" to Pair("UBL", "bank"),
      "9225" to Pair("Bank Alfalah", "bank"),
      "2251" to Pair("Allied Bank", "bank"),
      "8080" to Pair("Faysal Bank", "bank"),
      "2722" to Pair("Askari Bank", "bank"),
      "8088" to Pair("Bank of Punjab", "bank")
    )
  }

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    if (sbn == null) return
    val packageName = sbn.packageName?.lowercase(Locale.ROOT) ?: return

    // 1. Skip our own notifications
    if (packageName == applicationContext.packageName.lowercase(Locale.ROOT)) return

    // 2. Immediate Blacklist Check: E-commerce (Temu, Daraz, AliExpress, etc.), Social, Games, Browsers
    if (isBlacklistedPackage(packageName)) {
      Log.d(TAG, "Ignoring notification from blacklisted package: $packageName")
      return
    }

    val extras = sbn.notification.extras ?: return
    val title = extras.getString(Notification.EXTRA_TITLE) ?: ""
    val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
    val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: ""
    val subText = extras.getString(Notification.EXTRA_SUB_TEXT) ?: ""

    val combinedContent = "$title $text $bigText $subText".trim()
    if (combinedContent.isBlank()) return

    // 3. Package source validation: Must be SMS app or Recognized/Generic Financial app
    val isSms = isSmsPackage(packageName)
    val isFinancialApp = isKnownFinancialPackage(packageName)

    if (!isSms && !isFinancialApp) {
      // If it's an arbitrary 3rd party app, reject unless its package/title explicitly contains banking terms
      if (!isPotentialFinancialApp(packageName, title)) {
        Log.d(TAG, "Skipping non-financial app: $packageName ($title)")
        return
      }
    }

    // 4. Parse transaction details
    val transaction = parseFinancialNotification(packageName, title, combinedContent, isSms) ?: return

    val amount = transaction.optDouble("amount")
    val type = transaction.optString("type")
    val accountName = transaction.optString("accountName")
    val refId = transaction.optString("refId")
    val currentTime = System.currentTimeMillis()

    // 5. Exact Notification ID check (Prevents duplicate callbacks for the same notification update)
    val exactNotificationKey = "${sbn.id}_${sbn.postTime}_${amount}"
    if (isNotificationAlreadyProcessed(exactNotificationKey)) {
      Log.d(TAG, "Exact notification already processed: $exactNotificationKey")
      return
    }

    // 6. Cross-App Deduplication Check (Window: 3 minutes)
    // Prevents duplicate entries when Bank App + SMS or Wallet + SMS alert for the same transaction
    if (isDuplicateTransaction(amount, type, accountName, refId, currentTime)) {
      Log.i(TAG, "Duplicate transaction suppressed (amount: $amount, type: $type, account: $accountName, ref: $refId)")
      markNotificationProcessed(exactNotificationKey)
      return
    }

    // Mark as processed & record in sliding deduplication window
    markNotificationProcessed(exactNotificationKey)
    recordProcessedTransaction(amount, type, accountName, refId, currentTime)

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
        val verb = if (type == "income") "received" else "spent"
        Toast.makeText(
          applicationContext,
          "Fiscus: Auto-added $verb ${String.format(Locale.US, "%.2f", amount)} ($accountName)",
          Toast.LENGTH_LONG
        ).show()
      } catch (e: Exception) {
        Log.e(TAG, "Error showing toast", e)
      }
    }
  }

  private fun isBlacklistedPackage(pkg: String): Boolean {
    // E-commerce & Shopping Apps
    if (pkg.contains("temu") ||
        pkg.contains("daraz") ||
        pkg.contains("aliexpress") ||
        pkg.contains("amazon") ||
        pkg.contains("ebay") ||
        pkg.contains("shopee") ||
        pkg.contains("flipkart") ||
        pkg.contains("shein") ||
        pkg.contains("zzkko") ||
        pkg.contains("walmart") ||
        pkg.contains("target.ui") ||
        pkg.contains("alibaba") ||
        pkg.contains("olx")
    ) return true

    // Social Media & Messaging Chats (avoid false triggers from friends chatting about money)
    if (pkg.contains("whatsapp") ||
        pkg.contains("instagram") ||
        pkg.contains("facebook") ||
        pkg.contains("snapchat") ||
        pkg.contains("tiktok") ||
        pkg.contains("musically") ||
        pkg.contains("twitter") ||
        pkg.contains("telegram") ||
        pkg.contains("reddit") ||
        pkg.contains("discord")
    ) return true

    // Media & Browsers
    if (pkg.contains("chrome") ||
        pkg.contains("firefox") ||
        pkg.contains("browser") ||
        pkg.contains("youtube") ||
        pkg.contains("netflix") ||
        pkg.contains("spotify")
    ) return true

    return false
  }

  private fun isSmsPackage(pkg: String): Boolean {
    return pkg in listOf(
      "com.google.android.apps.messaging",
      "com.samsung.android.messaging",
      "com.android.mms",
      "com.oneplus.mms",
      "com.coloros.mms",
      "com.huawei.message",
      "com.xiaomi.channel",
      "org.thoughtcrime.securesms"
    ) || pkg.endsWith(".mms") || pkg.contains(".messaging") || pkg.contains(".messages")
  }

  private fun isKnownFinancialPackage(pkg: String): Boolean {
    // Wallets & Banks
    return pkg in listOf(
      "pk.com.telenor.phoenix",                 // Easypaisa
      "com.techlogix.mobilink.activity",        // JazzCash
      "com.sadapay",                            // SadaPay
      "com.nayapay",                            // NayaPay
      "com.meezanbank.mobile",                  // Meezan
      "com.hbl.mobilebanking",                  // HBL
      "com.bankalfalah.alfa",                   // Alfa
      "com.mcb.mobilebanking",                  // MCB
      "com.ubl.digital",                        // UBL
      "com.abl.myabl",                          // Allied Bank
      "com.sc.breeze.pk",                       // Standard Chartered PK
      "com.faysalbank.digibank",                // Faysal
      "com.askari.mobile",                      // Askari
      "com.bop.digital",                        // BOP
      "com.habibmetro.sirat",                   // Habib Metro
      "com.google.android.apps.walletnfcrel",   // Google Wallet / Pay
      "com.google.android.apps.nbu.paisa.user", // Google Pay (GPay)
      "net.one97.paytm",                        // Paytm
      "com.phonepe.app",                        // PhonePe
      "com.paypal.android.p2pmobile",           // PayPal
      "com.revolut.revolut",                    // Revolut
      "co.uk.getmondo",                         // Monzo
      "de.number26.android",                    // N26
      "com.chase.sig.android",                  // Chase
      "com.wf.wellsfargomobile",                // Wells Fargo
      "com.infonow.bofa"                        // Bank of America
    ) || pkg.contains(".bank") || pkg.contains(".banking") || pkg.contains(".wallet") ||
         (pkg.contains(".pay") && !pkg.contains("google.android.play"))
  }

  private fun isPotentialFinancialApp(pkg: String, title: String): Boolean {
    val lower = "$pkg $title".lowercase(Locale.ROOT)
    return lower.contains("bank") || lower.contains("wallet") || lower.contains("fintech") || lower.contains("credit union")
  }

  private fun parseFinancialNotification(
    packageName: String,
    title: String,
    content: String,
    isSms: Boolean
  ): JSONObject? {
    val lowerContent = content.lowercase(Locale.ROOT)

    // 1. Filter out OTPs and authentication alerts
    if (lowerContent.contains("otp") ||
        lowerContent.contains("verification code") ||
        lowerContent.contains("one time password") ||
        lowerContent.contains("login alert") ||
        lowerContent.contains("logged in") ||
        lowerContent.contains("security code") ||
        lowerContent.contains("device registered")
    ) {
      if (!lowerContent.contains("debited") && !lowerContent.contains("credited") && !lowerContent.contains("transferred")) {
        return null
      }
    }

    // 2. Strict Promotional & Spam Filter (e.g. Temu offers, flash sales, coupon vouchers)
    if (isPromotionalOrSpam(lowerContent)) {
      Log.d(TAG, "Rejected promotional/spam notification: $content")
      return null
    }

    // 3. For SMS, ensure it actually originates from a financial institution or has bank ledger indicators
    if (isSms && !isSmsLegitimateBanking(title, lowerContent)) {
      Log.d(TAG, "Rejected SMS notification lacking financial ledger indicators: $title -> $content")
      return null
    }

    // 4. Determine transaction intent: Income vs Expense
    // Explicit, unambiguous debit/spent phrases
    val isExpense = lowerContent.contains("debited") ||
        lowerContent.contains("debit of") ||
        lowerContent.contains("paid to") ||
        lowerContent.contains("paid for") ||
        lowerContent.contains("paid rs") ||
        lowerContent.contains("payment to") ||
        lowerContent.contains("payment of") ||
        lowerContent.contains("spent at") ||
        lowerContent.contains("spent on") ||
        lowerContent.contains("spent rs") ||
        lowerContent.contains("withdrawn from") ||
        lowerContent.contains("withdrawn at") ||
        lowerContent.contains("transfer to") ||
        lowerContent.contains("transferred to") ||
        lowerContent.contains("transfer of") ||
        lowerContent.contains("sent to") ||
        lowerContent.contains("sent rs") ||
        lowerContent.contains("charged to") ||
        lowerContent.contains("deducted from") ||
        lowerContent.contains("purchase of") ||
        lowerContent.contains("purchase at")

    // Explicit, unambiguous credit/received phrases
    val isIncome = lowerContent.contains("credited") ||
        lowerContent.contains("credit of") ||
        lowerContent.contains("credited with") ||
        lowerContent.contains("received from") ||
        lowerContent.contains("received rs") ||
        lowerContent.contains("deposited to") ||
        lowerContent.contains("deposited into") ||
        lowerContent.contains("deposited in") ||
        lowerContent.contains("salary credited") ||
        lowerContent.contains("transfer from") ||
        lowerContent.contains("transferred from") ||
        lowerContent.contains("added to your account") ||
        lowerContent.contains("added to wallet") ||
        lowerContent.contains("refund of")

    if (!isExpense && !isIncome) {
      return null
    }

    // 5. Extract amount
    val amount = extractAmount(content) ?: return null
    if (amount <= 0.0) return null

    // 6. Determine bank name & account type
    val (bankName, accountType) = extractBankDetails(packageName, title, content, isSms)
    // If it's not a recognized bank/wallet and couldn't resolve a valid bank name, reject
    if (bankName == "Unknown" || bankName.isBlank()) {
      return null
    }

    // 7. Extract transaction reference ID (if present) for precise deduplication
    val refId = extractReferenceId(content)

    // 8. Smart category & note
    val category = inferCategory(content, isExpense)
    val note = buildNote(content, isExpense, bankName, amount)

    val obj = JSONObject()
    obj.put("id", System.currentTimeMillis().toString())
    obj.put("type", if (isIncome && !isExpense) "income" else "expense")
    obj.put("amount", amount)
    obj.put("note", note)
    obj.put("refId", refId ?: "")

    val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
    isoFormat.timeZone = TimeZone.getTimeZone("UTC")
    obj.put("createdAt", isoFormat.format(Date()))

    obj.put("accountName", bankName)
    obj.put("accountType", accountType)
    obj.put("category", category)

    return obj
  }

  private fun isPromotionalOrSpam(text: String): Boolean {
    val promoKeywords = listOf(
      "coupon", "voucher", "promo code", "promocode", "use code", "apply code",
      "discount", "% off", "flat off", "flash sale", "special offer", "limited offer",
      "limited time offer", "win up to", "stand a chance", "congratulations you won",
      "reward points", "free delivery", "free shipping", "spin the wheel", "cashback offer",
      "pre-approved loan", "apply now", "click here to claim", "claim now", "save up to",
      "gift card", "gift voucher", "earn cashback", "exclusive deal", "deal of the day"
    )

    for (promo in promoKeywords) {
      if (text.contains(promo)) {
        // Only allow if it's an explicit debit/credit confirmation (e.g. "cashback of Rs 50 credited")
        val isExplicitLedger = (text.contains("has been debited") || text.contains("has been credited") ||
                               text.contains("was debited") || text.contains("was credited") ||
                               text.contains("a/c") || text.contains("acct"))
        if (!isExplicitLedger) {
          return true
        }
      }
    }
    return false
  }

  private fun isSmsLegitimateBanking(title: String, content: String): Boolean {
    val cleanTitle = title.trim().uppercase(Locale.ROOT)

    // Check if SMS sender title is a known bank or shortcode
    if (SMS_SHORTCODES.containsKey(cleanTitle)) return true
    val knownSenders = listOf(
      "MEEZAN", "HBL", "UBL", "MCB", "ALFALAH", "ALFA", "EASYPAISA", "JAZZCASH",
      "SADAPAY", "NAYAPAY", "ALLIED", "ABL", "FAYSAL", "ASKARI", "BOP", "HABIBMETRO",
      "SCB", "CHASE", "BOFA", "WELLS"
    )
    if (knownSenders.any { cleanTitle.contains(it) }) return true

    // Or content contains explicit bank account masking or reference indicators
    val hasAccountMask = content.contains("a/c") ||
                         content.contains("acct") ||
                         content.contains("account ending") ||
                         content.contains("card ending") ||
                         content.contains("ending in") ||
                         content.contains("avl bal") ||
                         content.contains("available bal") ||
                         content.contains("trx id") ||
                         content.contains("txn id") ||
                         content.contains("ref no") ||
                         content.contains("utr") ||
                         content.contains("ibft") ||
                         content.contains("raast")

    return hasAccountMask
  }

  private fun extractReferenceId(text: String): String? {
    val patterns = listOf(
      Pattern.compile("(?i)(?:trx\\s*id|txn\\s*id|transaction\\s*id|ref(?:erence)?\\s*(?:no|id)?|utr)[:\\s#]+([A-Za-z0-9]{6,25})"),
      Pattern.compile("(?i)(?:id|no)[:\\s#]+([0-9]{8,20})")
    )
    for (p in patterns) {
      val m = p.matcher(text)
      if (m.find()) {
        return m.group(1)?.trim()
      }
    }
    return null
  }

  private fun extractAmount(text: String): Double? {
    // Remove "available balance", "avl bal", "bal:" portions to prevent capturing balance instead of transaction amount
    val cleaned = text.replace(
      Regex("(?i)(?:avl\\.?\\s*bal(?:ance)?|available\\s*balance|bal(?:ance)?)\\s*[:=-]?\\s*(?:rs\\.?|pkr|inr|usd|eur|gbp|aed|sar|₹|\\$|€|£)?\\s*[0-9,]+(?:\\.[0-9]{1,2})?", RegexOption.IGNORE_CASE),
      ""
    )

    val patterns = listOf(
      Pattern.compile("(?:rs\\.?|pkr|inr|usd|eur|gbp|aed|sar|₹|\\$|€|£)\\s*([0-9]+(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)", Pattern.CASE_INSENSITIVE),
      Pattern.compile("(?:debited|credited|spent|paid|sent|received|transfer(?:red)?|amount|withdrawn|charged)\\s*(?:by|of|is|for)?\\s*(?:rs\\.?|pkr|inr|usd|eur|gbp|aed|sar|₹|\\$|€|£)?\\s*([0-9]+(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)", Pattern.CASE_INSENSITIVE),
      Pattern.compile("([0-9]+(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)\\s*(?:rs\\.?|pkr|inr|usd|eur|gbp|aed|sar|₹|\\$|€|£)", Pattern.CASE_INSENSITIVE)
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

  private fun extractBankDetails(
    packageName: String,
    title: String,
    content: String,
    isSms: Boolean
  ): Pair<String, String> {
    val cleanTitle = title.trim()

    // 1. Check SMS Shortcodes first
    if (isSms && SMS_SHORTCODES.containsKey(cleanTitle)) {
      return SMS_SHORTCODES[cleanTitle]!!
    }

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
      fullText.contains("google pay") || fullText.contains("gpay") || fullText.contains("walletnfcrel") -> Pair("Google Pay", "wallet")
      else -> {
        if (isSms) {
          // If SMS sender has a clean bank-like title (e.g. "Citibank", "Barclays")
          if (cleanTitle.isNotBlank() && cleanTitle.length in 3..25 && !cleanTitle.contains("message", true)) {
            Pair(cleanTitle, "bank")
          } else {
            Pair("Bank", "bank")
          }
        } else if (isKnownFinancialPackage(packageName)) {
          Pair("Bank", "bank")
        } else {
          Pair("Unknown", "other")
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

      lower.contains("outfitters") || lower.contains("khaadi") || lower.contains("sapphire") ||
      lower.contains("shopping") || lower.contains("mall") -> "Shopping"

      else -> "Other"
    }
  }

  private fun buildNote(content: String, isExpense: Boolean, bankName: String, amount: Double): String {
    val merchantMatcher = Pattern.compile("(?i)(?:at|to|for|info:?)\\s+([A-Za-z0-9 ._-]{3,30})").matcher(content)
    if (merchantMatcher.find()) {
      val target = merchantMatcher.group(1)?.trim() ?: ""
      if (target.isNotBlank() &&
          !target.equals("your", true) &&
          !target.equals("account", true) &&
          !target.equals("a/c", true)
      ) {
        val action = if (isExpense) "Spent at" else "Received from"
        return "$action $target"
      }
    }
    return if (isExpense) "Auto Bank Debit ($bankName)" else "Auto Bank Credit ($bankName)"
  }

  // --- SMART SLIDING-WINDOW DEDUPLICATION ENGINE ---

  private fun isDuplicateTransaction(
    amount: Double,
    type: String,
    accountName: String,
    refId: String,
    currentTime: Long
  ): Boolean {
    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val raw = prefs.getString(PREFS_KEY_RECENT_TXS, "[]") ?: "[]"
    val array = try { JSONArray(raw) } catch (e: Exception) { JSONArray() }

    val cutoff = currentTime - DEDUP_WINDOW_MS

    for (i in 0 until array.length()) {
      val item = array.optJSONObject(i) ?: continue
      val itemTime = item.optLong("time", 0L)
      if (itemTime < cutoff) continue

      val itemAmount = item.optDouble("amount", 0.0)
      val itemType = item.optString("type", "")
      val itemRefId = item.optString("refId", "")
      val itemAccount = item.optString("account", "")

      // 1. Exact amount and same type check
      val amountMatch = Math.abs(itemAmount - amount) < 0.01
      val typeMatch = itemType == type

      if (amountMatch && typeMatch) {
        // If reference ID exists on both and matches -> Definite duplicate
        if (refId.isNotBlank() && itemRefId.isNotBlank() && refId.equals(itemRefId, ignoreCase = true)) {
          return true
        }

        // If from the same account or one is generic "Bank" -> Duplicate
        if (itemAccount.equals(accountName, ignoreCase = true) ||
            itemAccount == "Bank" ||
            accountName == "Bank"
        ) {
          return true
        }

        // Within 3 minutes, identical amount and type arriving from dual sources (e.g. GPay + Bank or Bank + SMS)
        return true
      }
    }

    return false
  }

  private fun recordProcessedTransaction(
    amount: Double,
    type: String,
    accountName: String,
    refId: String,
    currentTime: Long
  ) {
    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val raw = prefs.getString(PREFS_KEY_RECENT_TXS, "[]") ?: "[]"
    val array = try { JSONArray(raw) } catch (e: Exception) { JSONArray() }

    val cutoff = currentTime - DEDUP_WINDOW_MS
    val freshArray = JSONArray()

    // Keep only recent unexpired entries
    for (i in 0 until array.length()) {
      val item = array.optJSONObject(i) ?: continue
      if (item.optLong("time", 0L) >= cutoff) {
        freshArray.put(item)
      }
    }

    val newEntry = JSONObject()
    newEntry.put("amount", amount)
    newEntry.put("type", type)
    newEntry.put("account", accountName)
    newEntry.put("refId", refId)
    newEntry.put("time", currentTime)
    freshArray.put(newEntry)

    prefs.edit().putString(PREFS_KEY_RECENT_TXS, freshArray.toString()).apply()
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
    if (seen.size > 500) {
      seen.clear()
    }
    seen.add(key)
    prefs.edit().putStringSet(PREFS_KEY_SEEN, seen).apply()
  }
}
