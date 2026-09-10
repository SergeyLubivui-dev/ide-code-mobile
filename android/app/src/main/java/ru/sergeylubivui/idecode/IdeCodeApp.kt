package ru.sergeylubivui.idecode

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build

class IdeCodeApp : Application() {
    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                SessionService.CHANNEL_ID,
                getString(R.string.channel_session),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.channel_session_desc)
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }
}
