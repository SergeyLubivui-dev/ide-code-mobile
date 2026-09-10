package ru.sergeylubivui.idecode

import android.Manifest
import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var splash: View
    private lateinit var status: TextView
    private lateinit var retry: Button

    private val shutdown = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) = finishAndRemoveTask()
    }

    private val askPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        // Отказ ничего не ломает: без уведомления не будет только фоновой службы.
        launchEngine()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        web = findViewById(R.id.web)
        splash = findViewById(R.id.splash)
        status = findViewById(R.id.status)
        retry = findViewById(R.id.retry)

        applyInsets()
        configureWebView()
        retry.setOnClickListener { launchEngine() }

        ContextCompat.registerReceiver(
            this, shutdown, IntentFilter(SessionService.ACTION_SHUTDOWN),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.visibility == View.VISIBLE && web.canGoBack()) web.goBack() else moveTaskToBack(true)
            }
        })

        requestWhatWeNeed()
    }

    /**
     * С targetSdk 35 Android рисует приложение во весь экран, и часы со строкой
     * состояния оказываются поверх интерфейса. Отдаём отступы самому макету:
     * клавиатура так же честно сжимает рабочую область.
     */
    private fun applyInsets() {
        val root = findViewById<View>(R.id.root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(
                maxOf(bars.left, ime.left),
                bars.top,
                maxOf(bars.right, ime.right),
                maxOf(bars.bottom, ime.bottom)
            )
            WindowInsetsCompat.CONSUMED
        }
    }

    /** Разрешения спрашиваем сразу, до первого экрана рабочей среды. */
    private fun requestWhatWeNeed() {
        val wanted = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) wanted += Manifest.permission.POST_NOTIFICATIONS
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED
        ) wanted += Manifest.permission.WRITE_EXTERNAL_STORAGE
        if (wanted.isEmpty()) launchEngine() else askPermissions.launch(wanted.toTypedArray())
    }

    private fun launchEngine() {
        splash.visibility = View.VISIBLE
        web.visibility = View.GONE
        retry.visibility = View.GONE
        status.setText(R.string.engine_starting)
        thread {
            runCatching { Workspace.reserve(this) }
            // Движок живёт в службе, чтобы переживать сворачивание вместе с сессией.
            SessionService.start(this)
            val ok = Engine.start(this) && Engine.awaitReady()
            runOnUiThread {
                if (ok) {
                    splash.visibility = View.GONE
                    web.visibility = View.VISIBLE
                    web.loadUrl(Engine.baseUrl)
                    web.requestFocus()
                } else {
                    status.setText(R.string.engine_failed)
                    retry.visibility = View.VISIBLE
                }
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = false
            useWideViewPort = true
            loadWithOverviewMode = false
            // Планшет: щипком приблизить можно, экранные кнопки зума не нужны.
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
        }
        // Полосы прокрутки скрыты и в самом интерфейсе — системные поверх не рисуем.
        web.isVerticalScrollBarEnabled = false
        web.isHorizontalScrollBarEnabled = false
        web.overScrollMode = View.OVER_SCROLL_NEVER
        // Внешняя клавиатура и мышь: view должна держать фокус и принимать события сама.
        web.isFocusable = true
        web.isFocusableInTouchMode = true
        web.setBackgroundColor(0xFF0B0C0E.toInt())
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        web.addJavascriptInterface(Bridge(), "AndroidFiles")

        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: android.webkit.WebResourceRequest): Boolean {
                val url = request.url
                // Свой движок открываем внутри, внешние ссылки отдаём системе.
                if (url.host == "127.0.0.1" && url.port == Engine.port) return false
                return runCatching {
                    startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true
                }.getOrDefault(true)
            }
        }

        web.setDownloadListener { url, _, disposition, mime, _ ->
            if (url.startsWith("blob:") || url.startsWith("data:")) {
                web.evaluateJavascript(fetchScript(url, disposition, mime), null)
            } else {
                thread { downloadDirect(url, disposition, mime) }
            }
        }
    }

    /** Движок отдаёт файлы по петле, поэтому качаем сами и сразу в свою папку. */
    private fun downloadDirect(url: String, disposition: String?, mime: String?) {
        val name = URLUtil.guessFileName(url, disposition, mime)
        val saved = runCatching {
            val connection = java.net.URL(url).openConnection() as java.net.HttpURLConnection
            CookieManager.getInstance().getCookie(url)?.let { connection.setRequestProperty("Cookie", it) }
            connection.connectTimeout = 10_000
            connection.inputStream.use { input ->
                Workspace.write(this, name, mime ?: Workspace.mimeOf(name)) { output -> input.copyTo(output) }
            }
        }.getOrNull()
        runOnUiThread {
            if (saved == null) toast(getString(R.string.save_failed))
            else toast(getString(R.string.saved_to, "${Workspace.FOLDER}/$saved"))
        }
    }

    private fun fetchScript(url: String, disposition: String?, mime: String?): String {
        val name = URLUtil.guessFileName(url, disposition, mime)
        return """
            (function(){
              fetch(${quote(url)}).then(function(r){return r.blob();}).then(function(b){
                var fr=new FileReader();
                fr.onload=function(){AndroidFiles.save(${quote(name)}, String(fr.result).split(',')[1]||'');};
                fr.readAsDataURL(b);
              }).catch(function(e){AndroidFiles.failed(String(e));});
            })();
        """.trimIndent()
    }

    private fun quote(value: String) = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

    inner class Bridge {
        @JavascriptInterface
        fun save(name: String, base64: String) {
            val bytes = runCatching { Base64.decode(base64, Base64.DEFAULT) }.getOrNull()
                ?: return runOnUiThread { toast(getString(R.string.save_failed)) }
            val stored = Workspace.write(this@MainActivity, name, Workspace.mimeOf(name)) { it.write(bytes) }
            runOnUiThread {
                if (stored == null) toast(getString(R.string.save_failed))
                else toast(getString(R.string.saved_to, "${Workspace.FOLDER}/$stored"))
            }
        }

        @JavascriptInterface
        fun failed(reason: String) = runOnUiThread { toast(getString(R.string.save_failed)) }
    }

    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_SHORT).show()

    override fun onDestroy() {
        runCatching { unregisterReceiver(shutdown) }
        (web.parent as? ViewGroup)?.removeView(web)
        web.destroy()
        super.onDestroy()
    }
}
