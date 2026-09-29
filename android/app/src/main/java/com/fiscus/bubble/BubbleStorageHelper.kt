package com.fiscus.bubble

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

object BubbleStorageHelper {
  const val PREFS_NAME = "fiscus_bubble_prefs"
  const val PREFS_KEY_TRANSACTIONS = "bubble_transactions"
  const val PREFS_KEY_CATEGORIES = "bubble_categories"
  const val PREFS_KEY_ACCOUNTS = "bubble_accounts"
  const val PREFS_KEY_CURRENCY = "bubble_currency"
  const val ADD_ACCOUNT_OPTION = "Add account"

  data class AccountOption(val name: String, val type: String, val balance: Double)

  fun saveTransaction(
    context: Context,
    type: String,
    amount: Double,
    note: String,
    accountName: String,
    accountType: String,
    category: String,
    createdAtMillis: Long = System.currentTimeMillis()
  ) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val raw = prefs.getString(PREFS_KEY_TRANSACTIONS, "[]") ?: "[]"
    val array = try {
      JSONArray(raw)
    } catch (_: Exception) {
      JSONArray()
    }

    val obj = JSONObject().apply {
      put("id", createdAtMillis.toString())
      put("type", type)
      put("amount", amount)
      put("note", note)
      val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
      }
      put("createdAt", isoFormat.format(Date(createdAtMillis)))
      put("accountName", accountName)
      put("accountType", accountType)
      put("category", category)
    }

    array.put(obj)
    prefs.edit().putString(PREFS_KEY_TRANSACTIONS, array.toString()).apply()
  }

  fun getPendingTransactions(context: Context): String {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    return prefs.getString(PREFS_KEY_TRANSACTIONS, "[]") ?: "[]"
  }

  fun clearPendingTransactions(context: Context) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit().putString(PREFS_KEY_TRANSACTIONS, "[]").apply()
  }

  fun loadCategories(context: Context): List<String> {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val raw = prefs.getString(PREFS_KEY_CATEGORIES, null) ?: return listOf(
      "Groceries",
      "Bills",
      "Travel",
      "Salary",
      "Other"
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

  fun loadAccounts(context: Context): List<AccountOption> {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val raw = prefs.getString(PREFS_KEY_ACCOUNTS, null) ?: return listOf(
      AccountOption(ADD_ACCOUNT_OPTION, "bank", 0.0)
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

  fun getCurrencySymbol(context: Context): String {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    return prefs.getString(PREFS_KEY_CURRENCY, "$") ?: "$"
  }

  fun setCurrencySymbol(context: Context, symbol: String) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit().putString(PREFS_KEY_CURRENCY, symbol).apply()
  }

  fun setBubbleOptions(context: Context, categoriesJson: String, accountsJson: String) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit()
      .putString(PREFS_KEY_CATEGORIES, categoriesJson)
      .putString(PREFS_KEY_ACCOUNTS, accountsJson)
      .apply()
  }
}
