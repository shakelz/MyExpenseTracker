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

    // Deduplication window: 12 hours (prevents multi-stage transfer status duplicates from Wise/Banks)
    private const val DEDUP_WINDOW_MS = 12 * 60 * 60 * 1000L

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

    // 3. Package source validation: Must be SMS app or Recognized/Generic Financial app OR contain explicit financial ledger indicators
    val isSms = isSmsPackage(packageName)
    val isFinancialApp = isKnownFinancialPackage(packageName)

    if (!isSms && !isFinancialApp) {
      if (!isPotentialFinancialApp(packageName, title) && !hasExplicitFinancialLedger(combinedContent)) {
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
    val note = transaction.optString("note")
    val currentTime = System.currentTimeMillis()

    // 5. Exact Notification ID check (Prevents duplicate callbacks for the same notification update)
    val exactNotificationKey = "${sbn.id}_${sbn.postTime}_${amount}"
    if (isNotificationAlreadyProcessed(exactNotificationKey)) {
      Log.d(TAG, "Exact notification already processed: $exactNotificationKey")
      return
    }

    // 6. Cross-App Deduplication Check (Window: 3 minutes)
    // Prevents duplicate entries when Bank App + SMS or Wallet + SMS alert for the same transaction
    if (isDuplicateTransaction(amount, type, accountName, refId, note, currentTime)) {
      Log.i(TAG, "Duplicate transaction suppressed (amount: $amount, type: $type, account: $accountName, ref: $refId, note: $note)")
      markNotificationProcessed(exactNotificationKey)
      return
    }

    // Mark as processed & record in sliding deduplication window
    markNotificationProcessed(exactNotificationKey)
    recordProcessedTransaction(amount, type, accountName, refId, note, currentTime)

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

    // News & Media Apps
    if (pkg.contains("news") ||
        pkg.contains("magazines") ||
        pkg.contains("daily") ||
        pkg.contains("dawn") ||
        pkg.contains("tribune") ||
        pkg.contains("geo") ||
        pkg.contains("ary") ||
        pkg.contains("bbc") ||
        pkg.contains("cnn") ||
        pkg.contains("inshorts")
    ) return true

    // Food delivery & Ride tracking (status updates like 'rider 5 mins away' - not financial alerts)
    if (pkg.contains("foodpanda") ||
        pkg.contains("careem") ||
        pkg.contains("uber") ||
        pkg.contains("indrive") ||
        pkg.contains("zomato") ||
        pkg.contains("swiggy") ||
        pkg.contains("deliveroo") ||
        pkg.contains("talabat")
    ) return true

    // Telecom self-care apps promo alerts
    if (pkg == "com.jazz.world" ||
        pkg == "com.telenor.pakistan.mytelenor" ||
        pkg == "com.zong.myzong" ||
        pkg == "com.ufone.selfcare"
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
      "com.motorola.messaging",
      "com.truecaller",
      "org.thoughtcrime.securesms"
    ) || pkg.endsWith(".mms") || pkg.contains(".messaging") || pkg.contains(".messages") || pkg.contains(".sms")
  }

  private fun isKnownFinancialPackage(pkg: String): Boolean {
    // Wallets & Banks worldwide (PK, EU, US, IN, UAE)
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
      "com.db.pbc.mi",                          // Deutsche Bank Mobile
      "com.db.mm.app",                          // Deutsche Bank
      "com.transferwise.android",               // Wise
      "com.remitly.android",                    // Remitly
      "com.westernunion.android.mtapp",         // Western Union
      "com.payoneer.android",                   // Payoneer
      "com.dreamplug.androidapp",               // CRED
      "in.org.npci.upiapp",                     // BHIM UPI
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
    return lower.contains("bank") || lower.contains("wallet") || lower.contains("fintech") ||
           lower.contains("credit union") || lower.contains("finance") || lower.contains("money") ||
           lower.contains("deutsche") || lower.contains("revolut") || lower.contains("pay")
  }

  private fun hasExplicitFinancialLedger(content: String): Boolean {
    val lower = content.lowercase(Locale.ROOT)
    val hasAmount = extractAmount(content) != null
    if (!hasAmount) return false
    return lower.contains("debited") || lower.contains("credited") || lower.contains("transferred") ||
           lower.contains("transfer") || lower.contains("withdrawn") || lower.contains("paid") ||
           lower.contains("spent") || lower.contains("purchase") || lower.contains("salary") ||
           lower.contains("cashback") || lower.contains("refund") || lower.contains("atm")
  }

  private fun parseFinancialNotification(
    packageName: String,
    title: String,
    content: String,
    isSms: Boolean
  ): JSONObject? {
    val lowerContent = content.lowercase(Locale.ROOT)

    // 1. STRICT Filter: OTPs, Security Codes, and Auth alerts (NEVER record OTPs as transactions)
    if (lowerContent.contains("otp") ||
        lowerContent.contains("verification code") ||
        lowerContent.contains("one time password") ||
        lowerContent.contains("do not share") ||
        lowerContent.contains("never share") ||
        lowerContent.contains("secret code") ||
        lowerContent.contains("security code") ||
        lowerContent.contains("login alert") ||
        lowerContent.contains("logged in") ||
        lowerContent.contains("authorization code") ||
        lowerContent.contains("device registered") ||
        lowerContent.contains("passcode") ||
        lowerContent.contains("auth code")
    ) {
      Log.d(TAG, "Rejected OTP or security authentication notification: $content")
      return null
    }

    // 1b. Reject balance inquiry alerts (e.g. 'Your balance is Rs 50.00' without debit/credit)
    if (lowerContent.contains("your balance is") ||
        lowerContent.contains("remaining balance is") ||
        lowerContent.contains("current balance is") ||
        lowerContent.contains("balance inquiry") ||
        lowerContent.contains("mini statement")
    ) {
      if (!lowerContent.contains("debited") && !lowerContent.contains("credited") && !lowerContent.contains("spent") && !lowerContent.contains("received")) {
        return null
      }
    }

    // 1c. Reject telecom advance loan and bundle activation alerts
    if (lowerContent.contains("advance loan") ||
        lowerContent.contains("super card") ||
        lowerContent.contains("bundle subscribed") ||
        lowerContent.contains("package subscribed") ||
        lowerContent.contains("mbs remaining") ||
        lowerContent.contains("free mins")
    ) {
      return null
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

    // 4. Robust Intent Parsing: EXPENSE vs INCOME
    // Debit, purchase, payment, and outgoing transfer phrases
    val hasTransferTo = Regex("(?i)\\b(?:transfer(?:red)?|sent|paid|payment)\\s+(?:of\\s+)?[^\\n.]*?\\bto\\b").containsMatchIn(lowerContent)
    val hasDebitIndicators = lowerContent.contains("debited") ||
        lowerContent.contains("debit of") ||
        lowerContent.contains("debit:") ||
        lowerContent.contains("paid to") ||
        lowerContent.contains("paid for") ||
        lowerContent.contains("paid rs") ||
        lowerContent.contains("paid") ||
        lowerContent.contains("payment to") ||
        lowerContent.contains("payment of") ||
        lowerContent.contains("payment made") ||
        lowerContent.contains("spent at") ||
        lowerContent.contains("spent on") ||
        lowerContent.contains("spent rs") ||
        lowerContent.contains("spent") ||
        lowerContent.contains("withdrawn from") ||
        lowerContent.contains("withdrawn at") ||
        lowerContent.contains("withdrawn") ||
        lowerContent.contains("withdrawal of") ||
        lowerContent.contains("atm cash") ||
        lowerContent.contains("atm withdrawal") ||
        lowerContent.contains("transfer to") ||
        lowerContent.contains("transferred to") ||
        lowerContent.contains("transfer of") ||
        lowerContent.contains("sent to") ||
        lowerContent.contains("sent rs") ||
        lowerContent.contains("you sent") ||
        lowerContent.contains("charged to") ||
        lowerContent.contains("charged for") ||
        lowerContent.contains("deducted from") ||
        lowerContent.contains("purchase of") ||
        lowerContent.contains("purchase at") ||
        lowerContent.contains("purchased at") ||
        lowerContent.contains("fund transfer") ||
        lowerContent.contains("funds transfer") ||
        lowerContent.contains("bank transfer") ||
        lowerContent.contains("ibft outward") ||
        lowerContent.contains("raast transfer") ||
        lowerContent.contains("raast p2p") ||
        lowerContent.contains("transfer from your") ||
        lowerContent.contains("transferred from your") ||
        lowerContent.contains("from your a/c") ||
        lowerContent.contains("from your account") ||
        lowerContent.contains("from a/c") ||
        lowerContent.contains("from acct") ||
        hasTransferTo

    // Credit and incoming deposit phrases
    val hasCreditIndicators = lowerContent.contains("salary credited") ||
        lowerContent.contains("salary deposited") ||
        lowerContent.contains("salary") ||
        lowerContent.contains("refund of") ||
        lowerContent.contains("refund credited") ||
        lowerContent.contains("cashback credited") ||
        lowerContent.contains("cashback of") ||
        lowerContent.contains("reversal") ||
        lowerContent.contains("inward ibft") ||
        lowerContent.contains("ibft inward") ||
        lowerContent.contains("inward transfer") ||
        lowerContent.contains("inward remittance") ||
        lowerContent.contains("received from") ||
        lowerContent.contains("received rs") ||
        lowerContent.contains("received transfer") ||
        lowerContent.contains("transfer received") ||
        lowerContent.contains("payment received") ||
        lowerContent.contains("deposited to") ||
        lowerContent.contains("deposited into") ||
        lowerContent.contains("deposited in") ||
        lowerContent.contains("deposit of") ||
        lowerContent.contains("transferred to your account") ||
        lowerContent.contains("transferred to your a/c") ||
        lowerContent.contains("transferred into your account") ||
        lowerContent.contains("transferred into your a/c") ||
        lowerContent.contains("added to your account") ||
        lowerContent.contains("added to wallet") ||
        (lowerContent.contains("credited") && !lowerContent.contains("debited") && !hasTransferTo && !lowerContent.contains("from your") && !lowerContent.contains("from a/c"))

    if (!hasDebitIndicators && !hasCreditIndicators) {
      return null
    }

    // STRICT DISAMBIGUATION:
    // If the message contains ANY indication that money was sent out, transferred to another party,
    // or user's account is debited, it is strictly an EXPENSE.
    val isExplicitDebitOrTransferOut = lowerContent.contains("debited") ||
        lowerContent.contains("withdrawn") ||
        lowerContent.contains("spent") ||
        lowerContent.contains("paid") ||
        lowerContent.contains("purchase") ||
        lowerContent.contains("from your") ||
        lowerContent.contains("from a/c") ||
        lowerContent.contains("from acct") ||
        lowerContent.contains("from account") ||
        lowerContent.contains("from card") ||
        hasTransferTo ||
        ((lowerContent.contains("transfer") || lowerContent.contains("ibft") || lowerContent.contains("raast")) &&
         !lowerContent.contains("received") && !lowerContent.contains("inward") && !lowerContent.contains("refund"))

    val isExpense = isExplicitDebitOrTransferOut || !hasCreditIndicators
    val isIncome = !isExpense

    // 5. Extract amount
    val amount = extractAmount(content) ?: return null
    if (amount <= 0.0) return null

    // 6. Determine bank name & account type
    val (bankName, accountType) = extractBankDetails(packageName, title, content, isSms)
    val resolvedBank = if (bankName.isBlank() || bankName == "Unknown") "Bank Account" else bankName

    // 7. Extract transaction reference ID (if present) for precise deduplication
    val refId = extractReferenceId(content)

    // 8. Smart category & rich descriptive note
    val category = inferCategory(content, isExpense)
    val note = buildNote(title, content, isExpense, resolvedBank, amount)

    val obj = JSONObject()
    obj.put("id", System.currentTimeMillis().toString())
    obj.put("type", if (isIncome) "income" else "expense")
    obj.put("amount", amount)
    obj.put("note", note)
    obj.put("refId", refId ?: "")

    val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
    isoFormat.timeZone = TimeZone.getTimeZone("UTC")
    obj.put("createdAt", isoFormat.format(Date()))

    obj.put("accountName", resolvedBank)
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
      "gift card", "gift voucher", "earn cashback", "exclusive deal", "deal of the day",
      "congratulations", "lucky draw", "bumper prize", "scratch card", "invest in",
      "credit limit upgrade", "upgrade your card", "subscribe now"
    )

    for (promo in promoKeywords) {
      if (text.contains(promo)) {
        // Only allow if it's an explicit debit/credit confirmation (e.g. "cashback of Rs 50 credited")
        val isExplicitLedger = (text.contains("has been debited") || text.contains("has been credited") ||
                               text.contains("was debited") || text.contains("was credited") ||
                               text.contains("a/c ending") || text.contains("acct ending"))
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
      "SCB", "CHASE", "BOFA", "WELLS", "DEUTSCHE", "REVOLUT", "WISE", "SONERI",
      "SAMBA", "JSBANK", "JS BANK", "DIB", "DUBAI ISLAMIC", "ALBARAKA", "BANKISLAMI",
      "PAYONEER", "REMITLY", "WESTERN", "CRED", "BHIM", "PAYTM", "PHONEPE", "GOOGLE",
      "BARCLAYS", "HSBC", "SANTANDER", "LLOYDS", "NATWEST", "N26", "MONZO", "CITI"
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
                         content.contains("raast") ||
                         content.contains("debited") ||
                         content.contains("credited") ||
                         content.contains("paid") ||
                         content.contains("spent") ||
                         content.contains("transferred") ||
                         content.contains("transfer") ||
                         content.contains("withdrawn") ||
                         content.contains("purchase") ||
                         content.contains("payment")

    return hasAccountMask
  }

  private fun extractReferenceId(text: String): String? {
    val patterns = listOf(
      Pattern.compile("(?i)(?:transfer\\s*(?:id|#|no|number)|trx\\s*id|txn\\s*id|transaction\\s*id|ref(?:erence)?\\s*(?:no|id)?|utr|rrn|stan)[:\\s#]+([A-Za-z0-9_-]{5,30})"),
      Pattern.compile("(?i)\\b(?:transfer\\s*#?\\s*|txn\\s*#?\\s*)([0-9]{6,20})\\b"),
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
      Pattern.compile("(?:rs\\.?|pkr|inr|usd|eur|gbp|aed|sar|₹|\\$|€|£)[:\\s]*([0-9]+(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)", Pattern.CASE_INSENSITIVE),
      Pattern.compile("(?:debited|credited|spent|paid|sent|received|transfer(?:red)?|amount|amt|withdrawn|charged)[:\\s]*(?:by|of|is|for)?[:\\s]*(?:rs\\.?|pkr|inr|usd|eur|gbp|aed|sar|₹|\\$|€|£)?[:\\s]*([0-9]+(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)", Pattern.CASE_INSENSITIVE),
      Pattern.compile("([0-9]+(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)\\s*(?:rs\\.?|pkr|inr|usd|eur|gbp|aed|sar|₹|\\$|€|£)", Pattern.CASE_INSENSITIVE)
    )

    for (pattern in patterns) {
      val matcher = pattern.matcher(cleaned)
      if (matcher.find()) {
        var rawNum = matcher.group(1)?.trim() ?: continue
        // Handle European comma decimals (e.g. 15,00)
        if (rawNum.contains(",") && !rawNum.contains(".") && rawNum.matches(Regex("^[0-9]+,[0-9]{2}$"))) {
          rawNum = rawNum.replace(",", ".")
        } else {
          rawNum = rawNum.replace(",", "")
        }
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
      fullText.contains("deutsche") || packageName.contains("com.db.pbc.mi") || packageName.contains("com.db.mm.app") -> Pair("Deutsche Bank", "bank")
      fullText.contains("transferwise") || fullText.contains("wise") -> Pair("Wise", "bank")
      fullText.contains("remitly") -> Pair("Remitly", "wallet")
      fullText.contains("western union") -> Pair("Western Union", "wallet")
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
          if (cleanTitle.isNotBlank() && cleanTitle.length in 3..25 &&
              !cleanTitle.contains("message", true) && !cleanTitle.contains("sms", true)) {
            Pair(cleanTitle, "bank")
          } else {
            Pair("Bank Account", "bank")
          }
        } else if (isKnownFinancialPackage(packageName) || isPotentialFinancialApp(packageName, title)) {
          if (cleanTitle.isNotBlank() && !cleanTitle.contains("alert", true) && !cleanTitle.contains("notification", true)) {
            Pair(cleanTitle, "bank")
          } else {
            Pair("Bank Account", "bank")
          }
        } else {
          Pair("Bank Account", "bank")
        }
      }
    }
  }

  private fun inferCategory(content: String, isExpense: Boolean): String {
    val lower = content.lowercase(Locale.ROOT)
    if (!isExpense) {
      return when {
        lower.contains("salary") -> "Salary"
        lower.contains("bonus") -> "Bonus"
        lower.contains("refund") || lower.contains("cashback") -> "Refund"
        lower.contains("interest") || lower.contains("profit") -> "Interest"
        else -> "Other"
      }
    }

    return when {
      lower.contains("foodpanda") || lower.contains("kfc") || lower.contains("mcdonald") ||
      lower.contains("burger") || lower.contains("pizza") || lower.contains("restaurant") ||
      lower.contains("cafe") || lower.contains("dining") || lower.contains("grocer") ||
      lower.contains("supermarket") || lower.contains("mart") || lower.contains("store") ||
      lower.contains("bakery") || lower.contains("meat") || lower.contains("bread") ||
      lower.contains("subway") || lower.contains("hardees") || lower.contains("domino") -> "Food"

      lower.contains("careem") || lower.contains("uber") || lower.contains("indrive") ||
      lower.contains("petrol") || lower.contains("fuel") || lower.contains("pso") ||
      lower.contains("shell") || lower.contains("total parco") || lower.contains("cng") ||
      lower.contains("ride") || lower.contains("cab") || lower.contains("metro") ||
      lower.contains("bus") || lower.contains("toll") -> "Transport"

      lower.contains("bill") || lower.contains("electric") || lower.contains("lesco") ||
      lower.contains("kelectric") || lower.contains("iesco") || lower.contains("sngpl") ||
      lower.contains("ssgc") || lower.contains("ptcl") || lower.contains("nayatel") ||
      lower.contains("stormfiber") || lower.contains("utility") || lower.contains("gas bill") ||
      lower.contains("water") || lower.contains("challan") || lower.contains("fee") -> "Bills"

      lower.contains("outfitters") || lower.contains("khaadi") || lower.contains("sapphire") ||
      lower.contains("shopping") || lower.contains("mall") || lower.contains("daraz") ||
      lower.contains("amazon") || lower.contains("ebay") || lower.contains("aliexpress") ||
      lower.contains("clothes") || lower.contains("shoes") || lower.contains("fashion") -> "Shopping"

      lower.contains("hospital") || lower.contains("clinic") || lower.contains("pharmacy") ||
      lower.contains("doctor") || lower.contains("medicine") || lower.contains("medical") ||
      lower.contains("chughtai") || lower.contains("shaukat khanum") || lower.contains("health") -> "Health"

      lower.contains("flight") || lower.contains("airline") || lower.contains("pia") ||
      lower.contains("airblue") || lower.contains("hotel") || lower.contains("booking") ||
      lower.contains("tour") || lower.contains("travel") || lower.contains("trip") -> "Travel"

      else -> "Other"
    }
  }

  private fun buildNote(
    title: String,
    content: String,
    isExpense: Boolean,
    bankName: String,
    amount: Double
  ): String {
    val lowerContent = content.lowercase(Locale.ROOT)

    // 1. Identify specific transaction sub-type
    val isAtm = lowerContent.contains("atm") || lowerContent.contains("cash withdrawal") ||
                lowerContent.contains("withdrawn at atm")
    val isSalary = lowerContent.contains("salary")
    val isRefund = lowerContent.contains("refund") || lowerContent.contains("reversal")
    val isCashback = lowerContent.contains("cashback")

    // Check specific utility billers
    val billers = listOf(
      "K-Electric", "KElectric", "LESCO", "IESCO", "FESCO", "MEPCO", "GEPCO",
      "SNGPL", "SSGC", "PTCL", "Nayatel", "StormFiber", "Wateen", "Sui Gas"
    )
    val matchedBiller = billers.firstOrNull { content.contains(it, ignoreCase = true) }

    if (isAtm) return "ATM Cash Withdrawal ($bankName)"
    if (isSalary) return "Salary Credit ($bankName)"
    if (isCashback) return "Cashback Reward ($bankName)"
    if (isRefund) return "Refund Credit ($bankName)"
    if (matchedBiller != null) return "$matchedBiller Bill Payment"

    val isBill = lowerContent.contains("bill") || lowerContent.contains("utility") ||
                 lowerContent.contains("challan") || lowerContent.contains("fee")
    val isTransfer = lowerContent.contains("transfer") || lowerContent.contains("ibft") ||
                     lowerContent.contains("raast") || lowerContent.contains("sent to") ||
                     lowerContent.contains("received from")

    // 2. Extract Party Name / Merchant
    var target = extractPartyOrMerchant(content, isExpense)

    // 3. If target not found in content, check title
    if (target.isNullOrBlank()) {
      val cleanTitle = cleanMerchantName(title)
      if (isValidPartyName(cleanTitle, bankName)) {
        target = cleanTitle
      }
    }

    val cleanTarget = if (!target.isNullOrBlank()) cleanMerchantName(target) else ""

    if (cleanTarget.isNotBlank() && isValidPartyName(cleanTarget, bankName)) {
      return if (isExpense) {
        if (isTransfer) "Transfer to $cleanTarget" else "Payment to $cleanTarget"
      } else {
        if (isTransfer) "Transfer from $cleanTarget" else "Received from $cleanTarget"
      }
    }

    // 4. Try extracting masked card/account detail so user has context instead of missing info
    val maskedAcct = extractMaskedAccountOrCard(content)
    if (maskedAcct != null) {
      return if (isExpense) {
        if (isTransfer) "Transfer from $maskedAcct ($bankName)"
        else "Payment via $maskedAcct ($bankName)"
      } else {
        if (isTransfer) "Transfer to $maskedAcct ($bankName)"
        else "Credit to $maskedAcct ($bankName)"
      }
    }

    // 5. Intelligent Fallback
    return if (isExpense) {
      if (isBill) "Bill Payment ($bankName)"
      else if (isTransfer) "Bank Transfer ($bankName)"
      else "Bank Payment ($bankName)"
    } else {
      if (isTransfer) "Bank Transfer Received ($bankName)"
      else "Account Credit ($bankName)"
    }
  }

  private fun extractPartyOrMerchant(content: String, isExpense: Boolean): String? {
    val patterns = if (isExpense) {
      listOf(
        // "transferred/sent/paid Rs 1500 to Muhammad Ali"
        Pattern.compile("(?i)(?:transfer(?:red)?|sent|paid|payment(?:\\s+made)?)\\s+(?:of\\s+)?(?:rs\\.?|pkr|inr|usd|eur|gbp|aed|sar|₹|\\$|€|£)?[\\s0-9,.]*\\s+to\\s+([A-Za-z0-9 ._&-]{2,40})"),
        // "Beneficiary / Account Title: Muhammad Ali"
        Pattern.compile("(?i)(?:beneficiary(?:\\s*name)?|account\\s*title|title|payee(?:\\s*name)?|biller(?:\\s*name)?|merchant(?:\\s*name)?|receiver)[:\\s]+([A-Za-z0-9 ._&-]{2,40})"),
        // "spent at / pos purchase at / paid at KFC"
        Pattern.compile("(?i)(?:spent\\s+at|purchase(?:d)?\\s+at|pos\\s+(?:purchase\\s+)?at|shopping\\s+at|paid\\s+at|at)\\s+([A-Za-z0-9 ._&-]{2,40})"),
        // "Transfer to / Paid to / Sent to Ali"
        Pattern.compile("(?i)(?:transfer(?:red)?\\s+to|paid\\s+to|payment\\s+to|sent\\s+to|towards)\\s+([A-Za-z0-9 ._&-]{2,40})"),
        // "Raast ID / Mobile: 03001234567"
        Pattern.compile("(?i)(?:raast(?:\\s*p2p|\\s*id|\\s*to)?|mobile(?:\\s*no)?|phone)\\s*[:\\s]+([0-9+]{7,16})"),
        // "purpose / for"
        Pattern.compile("(?i)(?:purpose|payment\\s+for)[:\\s]+([A-Za-z0-9 ._&-]{2,40})")
      )
    } else {
      listOf(
        // "received Rs 2500 from Babar Azam"
        Pattern.compile("(?i)(?:received|transfer(?:red)?\\s+received|payment\\s+received)\\s+(?:of\\s+)?(?:rs\\.?|pkr|inr|usd|eur|gbp|aed|sar|₹|\\$|€|£)?[\\s0-9,.]*\\s+from\\s+([A-Za-z0-9 ._&-]{2,40})"),
        // "Sender / Remitter: Babar Azam"
        Pattern.compile("(?i)(?:sender(?:\\s*name)?|remitter(?:\\s*name)?|source)[:\\s]+([A-Za-z0-9 ._&-]{2,40})"),
        // "Received from / from Babar Azam"
        Pattern.compile("(?i)(?:received\\s+from|transferred?\\s+from|from)\\s+([A-Za-z0-9 ._&-]{2,40})")
      )
    }

    for (p in patterns) {
      val m = p.matcher(content)
      if (m.find()) {
        val raw = m.group(1)?.trim() ?: continue
        val cleaned = cleanMerchantName(raw)
        if (cleaned.isNotBlank()) {
          return cleaned
        }
      }
    }
    return null
  }

  private fun cleanMerchantName(raw: String): String {
    var s = raw.trim()
    if (!s.all { it.isDigit() || it == '+' }) {
      s = s.replace(Regex("\\([0-9+]+\\)"), "").trim()
    }
    s = s.replace(Regex("(?i)\\s+(?:on|dated|date|ref|trx|txn|avl|bal|balance|via|using|acct|account|a/c|ending|details|successful|success|fee|new\\s+bal).*$"), "")
    s = s.replace(Regex("(?i)\\s*(?:rs\\.?|pkr|eur|usd|inr|gbp|aed|sar|₹|\\$|€|£)\\s*[0-9,.]+.*$"), "")
    s = s.replace(Regex("(?i)\\b(?:xx+|\\*+)[0-9]+\\b"), "")
    s = s.trim { it <= ' ' || it == ':' || it == '-' || it == '.' || it == ',' || it == '#' || it == '/' || it == '(' || it == ')' }
    return toTitleCase(s)
  }

  private fun toTitleCase(s: String): String {
    if (s.isBlank()) return s
    val words = s.split(Regex("\\s+"))
    return words.joinToString(" ") { word ->
      if (word.length <= 1) word.uppercase(Locale.ROOT)
      else if (word.all { it.isUpperCase() } && word.length > 3) {
        word.substring(0, 1).uppercase(Locale.ROOT) + word.substring(1).lowercase(Locale.ROOT)
      } else if (word.all { it.isLowerCase() }) {
        word.substring(0, 1).uppercase(Locale.ROOT) + word.substring(1).lowercase(Locale.ROOT)
      } else {
        word
      }
    }
  }

  private fun extractMaskedAccountOrCard(content: String): String? {
    val patterns = listOf(
      Pattern.compile("(?i)(?:card\\s+(?:ending\\s+(?:in\\s+)?)?|card\\s*#?\\s*[:\\s]*)[*xX]*([0-9]{4})"),
      Pattern.compile("(?i)(?:a/c|account|acct)\\s+(?:ending\\s+(?:in\\s+)?)?[*xX]*([0-9]{4,8})")
    )
    for (p in patterns) {
      val m = p.matcher(content)
      if (m.find()) {
        val digits = m.group(1)?.trim() ?: continue
        return if (m.pattern().pattern().contains("card")) {
          "Card *$digits"
        } else {
          "A/C *$digits"
        }
      }
    }
    return null
  }

  private fun isValidPartyName(name: String, bankName: String): Boolean {
    val lower = name.lowercase(Locale.ROOT).trim()
    if (lower.length < 2 || lower.length > 35) return false

    // Reject conversational sentences, verbs, punctuation, and news/status text
    if (lower.contains("!") || lower.contains("?") || lower.contains(".") ||
        lower.contains("was") || lower.contains("fast") || lower.contains("your") ||
        lower.contains("on its way") || lower.contains("arrived") || lower.contains("news") ||
        lower.contains("thank") || lower.contains("please") || lower.contains("sent") ||
        lower.contains("team") || lower.contains("support") || lower.contains("update") ||
        lower.contains("status") || lower.contains("notice") || lower.contains("alert")
    ) {
      return false
    }

    val invalidWords = listOf(
      "your", "account", "a/c", "acct", "wallet", "card", "bank", "details", "payment",
      "received", "transaction", "trx", "txn", "ref", "amount", "rs", "pkr", "eur",
      "usd", "inr", "balance", "available", "debited", "credited", "spent", "paid",
      "transfer", "success", "successful", "completed", "alert", "notification", "messages",
      "scopex", "wise", "transferwise"
    )
    if (invalidWords.contains(lower)) return false
    if (lower == bankName.lowercase(Locale.ROOT)) return false

    // Sentence detection (more than 4 words or containing common stop words)
    val words = lower.split(Regex("\\s+"))
    if (words.size > 4) return false
    val stopWords = setOf("is", "are", "the", "a", "an", "for", "to", "from", "in", "on", "at", "by", "with", "has", "have", "had", "been")
    if (words.any { it in stopWords }) return false

    // If it's a phone number or account number (digits), it's VALID!
    if (name.all { it.isDigit() || it == '+' || it == ' ' || it == '-' }) {
      val digitsOnly = name.filter { it.isDigit() }
      return digitsOnly.length in 7..16
    }

    return true
  }

  // --- SMART SLIDING-WINDOW DEDUPLICATION ENGINE ---

  private fun isDuplicateTransaction(
    amount: Double,
    type: String,
    accountName: String,
    refId: String,
    note: String,
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
        if (refId.isNotBlank() && itemRefId.isNotBlank()) {
          if (refId.equals(itemRefId, ignoreCase = true)) {
            return true
          }
        }

        // If reference IDs are different non-empty strings -> Definitely separate transactions!
        if (refId.isNotBlank() && itemRefId.isNotBlank() && !refId.equals(itemRefId, ignoreCase = true)) {
          continue
        }

        val timeDiff = Math.abs(currentTime - itemTime)

        // Same account/bank or generic bank account with identical amount within 12 hours:
        // Status updates (e.g. Wise "Sent" -> "Verifying" -> "On its way" -> "Completed")
        // occur within minutes to hours. We MUST suppress them!
        val isSameOrGenericAccount = itemAccount.equals(accountName, ignoreCase = true) ||
            itemAccount == "Bank Account" || accountName == "Bank Account" ||
            itemAccount.contains("Wise", true) || accountName.contains("Wise", true)

        if (isSameOrGenericAccount && timeDiff < DEDUP_WINDOW_MS) {
          return true
        }

        // Cross-bank alert within 5 minutes with identical amount -> Duplicate
        if (timeDiff < 300_000L) {
          return true
        }
      }
    }

    return false
  }

  private fun recordProcessedTransaction(
    amount: Double,
    type: String,
    accountName: String,
    refId: String,
    note: String,
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
    newEntry.put("note", note)
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
