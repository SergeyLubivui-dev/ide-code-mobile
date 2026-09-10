package ru.sergeylubivui.idecode

import android.content.Context
import android.util.Log
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.ServerSocket
import java.net.URL
import kotlin.concurrent.thread

/**
 * Движок IDE Code работает на самом устройстве: отдельный процесс из нативной
 * библиотеки APK, слушает только петлю. Файлы, проекты и терминал — локальные,
 * сети наружу движку не нужно.
 *
 * Бинарник лежит как `libidecode.so`, потому что исполнять файлы разрешено
 * только из каталога нативных библиотек; отсюда же и `extractNativeLibs=true`.
 */
object Engine {

    @Volatile
    var port: Int = 0
        private set

    private var process: Process? = null
    private val lock = Any()

    val baseUrl: String get() = "http://127.0.0.1:$port"

    fun isAlive(): Boolean = synchronized(lock) { process?.isAlive == true }

    fun start(context: Context): Boolean = synchronized(lock) {
        if (process?.isAlive == true) return true
        val binary = File(context.applicationInfo.nativeLibraryDir, "libidecode.so")
        if (!binary.exists()) {
            Log.e(TAG, "engine binary is missing at ${binary.absolutePath}")
            return false
        }
        val root = File(context.filesDir, "idecode").apply { mkdirs() }
        File(root, "home").mkdirs()
        val chosen = if (port != 0) port else freePort()

        val builder = ProcessBuilder(binary.absolutePath)
            .directory(root)
            .redirectErrorStream(true)
        builder.environment().apply {
            put("IDECODE_ROOT", root.absolutePath)
            put("LISTEN_ADDR", "127.0.0.1:$chosen")
            put("IDECODE_SHELL", shell())
            put("HOME", File(root, "home").absolutePath)
            put("TMPDIR", context.cacheDir.absolutePath)
            // Ключ по умолчанию: движок отдаёт его в чат, а пользователь может
            // заменить своим в настройках — тогда сохранённый перекроет этот.
            put("IDECODE_API_KEY", BuildConfig.CHAT_API_KEY)
        }
        return try {
            val started = builder.start()
            process = started
            port = chosen
            drain(started)
            true
        } catch (e: IOException) {
            Log.e(TAG, "cannot start engine", e)
            false
        }
    }

    fun stop() = synchronized(lock) {
        process?.destroy()
        process = null
    }

    /** Ждём готовности движка, а не гадаем по таймеру. */
    fun awaitReady(timeoutMs: Long = 15_000): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (!isAlive()) return false
            try {
                val connection = URL("$baseUrl/api/v1/health/live").openConnection() as HttpURLConnection
                connection.connectTimeout = 500
                connection.readTimeout = 500
                val code = connection.responseCode
                connection.disconnect()
                if (code in 200..299) return true
            } catch (_: Exception) {
                // движок ещё поднимается
            }
            Thread.sleep(100)
        }
        return false
    }

    private fun shell(): String =
        listOf("/system/bin/sh", "/bin/sh").firstOrNull { File(it).canExecute() } ?: "/system/bin/sh"

    private fun freePort(): Int = try {
        ServerSocket(0).use { it.localPort }
    } catch (e: IOException) {
        58730
    }

    /** Логи движка уходят в logcat, иначе процесс встанет на заполненном буфере. */
    private fun drain(process: Process) = thread(isDaemon = true, name = "engine-log") {
        runCatching {
            process.inputStream.bufferedReader().forEachLine { Log.i(TAG, it) }
        }
    }

    private const val TAG = "IdeCodeEngine"
}
