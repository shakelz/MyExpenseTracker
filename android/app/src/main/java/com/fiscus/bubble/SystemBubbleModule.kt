package com.fiscus.bubble

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import org.json.JSONArray
import org.json.JSONObject

class SystemBubbleModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SystemBubble"

  @ReactMethod
  fun requestPermission(promise: Promise) {
    val granted = Settings.canDrawOverlays(reactContext)
    if (!granted) {
      val intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:${reactContext.packageName}")
      )
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactContext.startActivity(intent)
    }
    promise.resolve(granted)
  }

  @ReactMethod
  fun isPermissionGranted(promise: Promise) {
    promise.resolve(Settings.canDrawOverlays(reactContext))
  }

  @ReactMethod
  fun initialize(promise: Promise) {
    val intent = Intent(reactContext, SystemBubbleService::class.java)
    intent.action = SystemBubbleService.ACTION_INIT
    reactContext.startForegroundService(intent)
    promise.resolve(null)
  }

  @ReactMethod
  fun showFloatingBubble(x: Int, y: Int) {
    if (!Settings.canDrawOverlays(reactContext)) return
    val intent = Intent(reactContext, SystemBubbleService::class.java)
    intent.action = SystemBubbleService.ACTION_SHOW
    intent.putExtra(SystemBubbleService.EXTRA_X, x)
    intent.putExtra(SystemBubbleService.EXTRA_Y, y)
    reactContext.startService(intent)
  }

  @ReactMethod
  fun hideFloatingBubble() {
    val intent = Intent(reactContext, SystemBubbleService::class.java)
    intent.action = SystemBubbleService.ACTION_HIDE
    reactContext.startService(intent)
  }
  
  @ReactMethod
  fun stopService() {
    val intent = Intent(reactContext, SystemBubbleService::class.java)
    intent.action = SystemBubbleService.ACTION_STOP
    reactContext.startService(intent)
  }

  @ReactMethod
  fun getPendingTransactions(promise: Promise) {
    val prefs = reactContext.getSharedPreferences(
      SystemBubbleService.PREFS_NAME,
      android.content.Context.MODE_PRIVATE
    )
    val payload = prefs.getString(SystemBubbleService.PREFS_KEY_TRANSACTIONS, "[]")
    promise.resolve(payload ?: "[]")
  }

  @ReactMethod
  fun clearPendingTransactions() {
    val prefs = reactContext.getSharedPreferences(
      SystemBubbleService.PREFS_NAME,
      android.content.Context.MODE_PRIVATE
    )
    prefs.edit().putString(SystemBubbleService.PREFS_KEY_TRANSACTIONS, "[]").apply()
  }

  @ReactMethod
  fun setBubbleOptions(categories: ReadableArray, accounts: ReadableArray) {
    val prefs = reactContext.getSharedPreferences(
      SystemBubbleService.PREFS_NAME,
      android.content.Context.MODE_PRIVATE
    )
    val categoryArray = JSONArray()
    for (i in 0 until categories.size()) {
      val value = categories.getString(i)
      if (!value.isNullOrBlank()) {
        categoryArray.put(value)
      }
    }

    val accountArray = JSONArray()
    for (i in 0 until accounts.size()) {
      val map = accounts.getMap(i) ?: continue
      val name = map.getString("name") ?: continue
      val type = map.getString("type") ?: "bank"
      val balance = if (map.hasKey("balance")) map.getDouble("balance") else 0.0
      val obj = JSONObject()
      obj.put("name", name)
      obj.put("type", type)
      obj.put("balance", balance)
      accountArray.put(obj)
    }

    prefs.edit()
      .putString(SystemBubbleService.PREFS_KEY_CATEGORIES, categoryArray.toString())
      .putString(SystemBubbleService.PREFS_KEY_ACCOUNTS, accountArray.toString())
      .apply()
  }

  @ReactMethod
  fun setCurrencySymbol(symbol: String) {
    val prefs = reactContext.getSharedPreferences(
      SystemBubbleService.PREFS_NAME,
      android.content.Context.MODE_PRIVATE
    )
    prefs.edit().putString(SystemBubbleService.PREFS_KEY_CURRENCY, symbol).apply()
  }

  private fun startBubbleService(intent: Intent) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      reactContext.startForegroundService(intent)
    } else {
      reactContext.startService(intent)
    }
  }
}
