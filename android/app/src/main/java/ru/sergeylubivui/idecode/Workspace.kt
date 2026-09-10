package ru.sergeylubivui.idecode

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import java.io.File
import java.io.OutputStream

/**
 * Приложение занимает под себя одну папку в «Загрузках» и держит всё своё там.
 * На Android 10+ это делается через MediaStore без разрешений на хранилище;
 * пустую папку MediaStore не создаёт, поэтому её материализует файл-описание.
 */
object Workspace {
    const val FOLDER = "IDE Code"
    private val RELATIVE_PATH = Environment.DIRECTORY_DOWNLOADS + File.separator + FOLDER

    /** Вызывается при старте: папка должна существовать до первой загрузки. */
    fun reserve(context: Context): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            val dir = legacyDir()
            if (!dir.exists()) dir.mkdirs()
            val readme = File(dir, "README.txt")
            if (!readme.exists()) readme.writeText(context.getString(R.string.folder_readme))
            return dir.absolutePath
        }
        if (!exists(context, "README.txt")) {
            write(context, "README.txt", "text/plain") { it.write(context.getString(R.string.folder_readme).toByteArray()) }
        }
        return RELATIVE_PATH
    }

    fun relativePath(): String = RELATIVE_PATH

    fun legacyDir(): File =
        File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), FOLDER)

    private fun exists(context: Context, name: String): Boolean {
        val projection = arrayOf(MediaStore.Downloads._ID)
        val selection = "${MediaStore.Downloads.RELATIVE_PATH} LIKE ? AND ${MediaStore.Downloads.DISPLAY_NAME} = ?"
        val args = arrayOf("$RELATIVE_PATH%", name)
        context.contentResolver.query(collection(), projection, selection, args, null)?.use { cursor ->
            return cursor.moveToFirst()
        }
        return false
    }

    private fun collection(): Uri =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
            MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        else MediaStore.Files.getContentUri("external")

    fun mimeOf(name: String): String {
        val ext = name.substringAfterLast('.', "").lowercase()
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
    }

    /** Пишет файл в занятую папку и возвращает его имя (уникальное имя выбирает система). */
    fun write(context: Context, name: String, mime: String, body: (OutputStream) -> Unit): String? {
        val safe = name.replace(Regex("[\\\\/:*?\"<>|\\x00-\\x1f]"), "_").ifBlank { "file" }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            val dir = legacyDir().apply { if (!exists()) mkdirs() }
            var target = File(dir, safe)
            var n = 1
            while (target.exists()) {
                target = File(dir, "${safe.substringBeforeLast('.', safe)}($n)" +
                    safe.substringAfterLast('.', "").let { if (it.isEmpty()) "" else ".$it" })
                n++
            }
            target.outputStream().use(body)
            return target.name
        }
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, safe)
            put(MediaStore.Downloads.MIME_TYPE, mime)
            put(MediaStore.Downloads.RELATIVE_PATH, RELATIVE_PATH)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = context.contentResolver.insert(collection(), values) ?: return null
        return try {
            context.contentResolver.openOutputStream(uri)?.use(body) ?: return null
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            context.contentResolver.update(uri, values, null, null)
            uri.lastPathSegment?.let { safe } ?: safe
        } catch (e: Exception) {
            context.contentResolver.delete(uri, null, null)
            null
        }
    }
}
