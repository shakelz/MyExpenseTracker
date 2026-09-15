package com.fiscus.auth

import android.accounts.Account
import android.accounts.AccountManager
import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class GoogleAuthModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var pendingPromise: Promise? = null

    companion object {
        const val NAME = "GoogleAuthModule"
        const val REQUEST_CODE_CHOOSE_ACCOUNT = 8901
    }

    override fun getName(): String = NAME

    init {
        reactContext.addActivityEventListener(object : BaseActivityEventListener() {
            override fun onActivityResult(
                activity: Activity,
                requestCode: Int,
                resultCode: Int,
                data: Intent?
            ) {
                if (requestCode == REQUEST_CODE_CHOOSE_ACCOUNT) {
                    if (resultCode == Activity.RESULT_OK && data != null) {
                        val email = data.getStringExtra(AccountManager.KEY_ACCOUNT_NAME)
                        if (!email.isNullOrBlank()) {
                            pendingPromise?.resolve(email)
                        } else {
                            pendingPromise?.reject("E_NO_ACCOUNT", "No account was selected")
                        }
                    } else {
                        pendingPromise?.reject("E_CANCELLED", "Account selection cancelled")
                    }
                    pendingPromise = null
                }
            }
        })
    }

    @ReactMethod
    fun chooseGoogleAccount(promise: Promise) {
        val activity = reactContext.currentActivity
        if (activity == null) {
            promise.reject("E_NO_ACTIVITY", "Current activity is not available")
            return
        }

        try {
            pendingPromise = promise
            val intent = AccountManager.newChooseAccountIntent(
                null,
                null,
                arrayOf("com.google"),
                true,
                null,
                null,
                null,
                null
            )
            activity.startActivityForResult(intent, REQUEST_CODE_CHOOSE_ACCOUNT)
        } catch (e: Exception) {
            pendingPromise = null
            promise.reject("E_CHOOSE_FAILED", e.message ?: "Failed to open account picker")
        }
    }

    @ReactMethod
    fun getDeviceGoogleAccounts(promise: Promise) {
        try {
            val am = AccountManager.get(reactContext)
            val accounts: Array<Account> = am.getAccountsByType("com.google")
            val array = Arguments.createArray()
            for (acc in accounts) {
                array.pushString(acc.name)
            }
            promise.resolve(array)
        } catch (e: Exception) {
            promise.resolve(Arguments.createArray())
        }
    }
}
