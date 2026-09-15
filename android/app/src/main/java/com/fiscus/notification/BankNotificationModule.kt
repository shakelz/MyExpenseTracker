package com.fiscus.notification

import android.content.ComponentName
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject

class BankNotificationModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  init {
    BankNotificationListenerService.onTransactionAddedListener = { json ->
      sendEvent("onBankNotificationReceived", json)
    }
  }

  override fun getName(): String = "BankNotification"

  @ReactMethod
  fun isNotificationListenerEnabled(promise: Promise) {
    try {
      val packageName = reactContext.packageName
      val enabledPackages = NotificationManagerCompat.getEnabledListenerPackages(reactContext)
      val isEnabled = enabledPackages.contains(packageName)
      promise.resolve(isEnabled)
    } catch (e: Exception) {
      // Fallback check via Secure Settings
      try {
        val flat = Settings.Secure.getString(
          reactContext.contentResolver,
          "enabled_notification_listeners"
        )
        val isEnabled = flat != null && flat.contains(reactContext.packageName)
        promise.resolve(isEnabled)
      } catch (ex: Exception) {
        promise.resolve(false)
      }
    }
  }

  @ReactMethod
  fun openNotificationListenerSettings(promise: Promise) {
    try {
      val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS).apply {
          val cn = ComponentName(reactContext, BankNotificationListenerService::class.java)
          putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, cn.flattenToString())
        }
      } else {
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
      }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactContext.startActivity(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      try {
        val fallbackIntent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        fallbackIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        reactContext.startActivity(fallbackIntent)
        promise.resolve(true)
      } catch (ex: Exception) {
        promise.reject("SETTINGS_ERROR", ex.message)
      }
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {
    // Required for RN built-in Event Emitter
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // Required for RN built-in Event Emitter
  }

  private fun sendEvent(eventName: String, json: JSONObject) {
    if (!reactContext.hasActiveReactInstance()) return

    val params = Arguments.createMap().apply {
      putString("id", json.optString("id"))
      putString("type", json.optString("type"))
      putDouble("amount", json.optDouble("amount"))
      putString("note", json.optString("note"))
      putString("createdAt", json.optString("createdAt"))
      putString("accountName", json.optString("accountName"))
      putString("accountType", json.optString("accountType"))
      putString("category", json.optString("category"))
    }

    try {
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(eventName, params)
    } catch (e: Exception) {
      // ignore event delivery errors if JS context not ready
    }
  }
}
