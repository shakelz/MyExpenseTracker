package com.fiscus.bubble

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import com.fiscus.R

object BubbleNotificationHelper {
  const val CHANNEL_ID = "fiscus_native_bubbles_channel"
  const val NOTIFICATION_ID = 5021
  const val SHORTCUT_ID = "fiscus_bubble_shortcut_id"

  fun isNativeBubblesSupported(): Boolean {
    return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
  }

  fun canPostNotifications(context: Context): Boolean {
    return NotificationManagerCompat.from(context).areNotificationsEnabled()
  }

  fun areBubblesAllowed(context: Context): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      return notificationManager.bubblePreference != NotificationManager.BUBBLE_PREFERENCE_NONE
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      return notificationManager.areBubblesAllowed()
    }
    return false
  }

  fun createNotificationChannel(context: Context) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val name = "Quick Add Bubbles"
      val descriptionText = "Floating native conversation bubbles to quickly add transactions"
      val importance = NotificationManager.IMPORTANCE_HIGH
      val channel = NotificationChannel(CHANNEL_ID, name, importance).apply {
        description = descriptionText
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          setAllowBubbles(true)
        }
      }
      notificationManager.createNotificationChannel(channel)
    }
  }

  fun showNativeBubble(
    context: Context,
    title: String = "Fiscus Quick Add",
    message: String = "Tap bubble to log an expense or income"
  ): Boolean {
    createNotificationChannel(context)

    val bubbleIntent = Intent(context, BubbleActivity::class.java).apply {
      action = Intent.ACTION_VIEW
      data = Uri.parse("fiscus://quick-bubble")
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }

    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    } else {
      PendingIntent.FLAG_UPDATE_CURRENT
    }

    val bubblePendingIntent = PendingIntent.getActivity(
      context,
      0,
      bubbleIntent,
      flags
    )

    val icon = IconCompat.createWithResource(context, R.drawable.ic_fiscus_app)

    val person = Person.Builder()
      .setName("Fiscus Quick Log")
      .setIcon(icon)
      .setBot(true)
      .setImportant(true)
      .build()

    // Android 11+ requires bubbles to be conversation shortcuts
    val shortcut = ShortcutInfoCompat.Builder(context, SHORTCUT_ID)
      .setShortLabel("Fiscus Quick Log")
      .setLongLabel("Log Expense or Income")
      .setIcon(icon)
      .setIntent(bubbleIntent)
      .setPerson(person)
      .setLongLived(true)
      .build()

    ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)

    val bubbleMetadata = NotificationCompat.BubbleMetadata.Builder(bubblePendingIntent, icon)
      .setDesiredHeight(600)
      .setAutoExpandBubble(true)
      .setSuppressNotification(false)
      .build()

    val messagingStyle = NotificationCompat.MessagingStyle(person)
      .addMessage(message, System.currentTimeMillis(), person)
      .setConversationTitle(title)

    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(title)
      .setContentText(message)
      .setContentIntent(bubblePendingIntent)
      .setBubbleMetadata(bubbleMetadata)
      .setShortcutInfo(shortcut)
      .addPerson(person)
      .setStyle(messagingStyle)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setAutoCancel(true)

    try {
      NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build())
      return true
    } catch (e: SecurityException) {
      return false
    }
  }

  fun cancelNativeBubble(context: Context) {
    NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
  }
}
