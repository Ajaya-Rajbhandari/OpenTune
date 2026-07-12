/*
 * OpenTune Project Original (2026)
 * Arturo254 (github.com/Arturo254)
 * Licensed Under GPL-3.0 | see git history for contributors
 */

package com.arturo254.opentune.ui.screens.settings

import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarScrollBehavior
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.arturo254.opentune.LocalPlayerAwareWindowInsets
import com.arturo254.opentune.R
import com.arturo254.opentune.constants.DataSyncIdKey
import com.arturo254.opentune.constants.InnerTubeCookieKey
import com.arturo254.opentune.constants.PoTokenKey
import com.arturo254.opentune.constants.VisitorDataKey
import com.arturo254.opentune.innertube.utils.parseCookieString
import com.arturo254.opentune.ui.component.IconButton
import com.arturo254.opentune.ui.utils.backToMain
import com.arturo254.opentune.utils.rememberPreference
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.net.HttpURLConnection
import java.net.URL

const val WEB_PAIRING_ROUTE = "settings/web_pairing"
const val WEB_PAIRING_SERVER_ARGUMENT = "server"
const val WEB_PAIRING_CODE_ARGUMENT = "code"

fun buildWebPairingRoute(server: String? = null, code: String? = null): String {
    val params = listOfNotNull(
        server?.trim()?.takeIf { it.isNotBlank() }?.let { "$WEB_PAIRING_SERVER_ARGUMENT=${Uri.encode(it)}" },
        code?.trim()?.takeIf { it.isNotBlank() }?.let { "$WEB_PAIRING_CODE_ARGUMENT=${Uri.encode(it)}" },
    )
    return if (params.isEmpty()) WEB_PAIRING_ROUTE else "$WEB_PAIRING_ROUTE?${params.joinToString("&")}"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WebPairingScreen(
    navController: NavController,
    scrollBehavior: TopAppBarScrollBehavior,
    initialServer: String? = null,
    initialCode: String? = null,
) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    val (innerTubeCookie) = rememberPreference(InnerTubeCookieKey, "")
    val (visitorData) = rememberPreference(VisitorDataKey, "")
    val (dataSyncId) = rememberPreference(DataSyncIdKey, "")
    val (poToken) = rememberPreference(PoTokenKey, "")
    val isLoggedIn = remember(innerTubeCookie) { "SAPISID" in parseCookieString(innerTubeCookie) }

    var server by remember(initialServer) { mutableStateOf(initialServer.orEmpty()) }
    var code by remember(initialCode) { mutableStateOf(initialCode.orEmpty()) }
    var pairing by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .windowInsetsPadding(LocalPlayerAwareWindowInsets.current)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 88.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            text = "Pair OpenTune Web",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = "Generate a pairing code in OpenTune Web, then send this Android login session to that local web server.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        if (!isLoggedIn) {
            Surface(
                color = MaterialTheme.colorScheme.errorContainer,
                shape = MaterialTheme.shapes.medium,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    text = "Log in to YouTube Music on Android before pairing with OpenTune Web.",
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    modifier = Modifier.padding(14.dp),
                )
            }
        }

        OutlinedTextField(
            value = server,
            onValueChange = { server = it },
            label = { Text("Web server URL") },
            placeholder = { Text("http://192.168.1.20:8080") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )

        OutlinedTextField(
            value = code,
            onValueChange = { code = normalizePairingCode(it) },
            label = { Text("Pairing code") },
            placeholder = { Text("ABCDEFGH") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )

        Button(
            enabled = isLoggedIn && !pairing && server.isNotBlank() && code.isNotBlank(),
            onClick = {
                pairing = true
                status = "Pairing..."
                coroutineScope.launch {
                    val result = completeWebPairing(
                        server = server,
                        code = code,
                        cookie = innerTubeCookie,
                        visitorData = visitorData,
                        dataSyncId = dataSyncId,
                        poToken = poToken,
                    )
                    pairing = false
                    status = result.fold(
                        onSuccess = { "OpenTune Web is paired." },
                        onFailure = { it.message ?: "Pairing failed" },
                    )
                    Toast.makeText(context, status.orEmpty(), Toast.LENGTH_SHORT).show()
                    if (result.isSuccess) navController.navigateUp()
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (pairing) "Pairing..." else "Pair with web")
        }

        status?.let {
            SelectionContainer {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontFamily = if (it.startsWith("http")) FontFamily.Monospace else null,
                )
            }
        }

        Spacer(Modifier.height(12.dp))
    }

    TopAppBar(
        title = { Text("Pair Web") },
        navigationIcon = {
            IconButton(
                onClick = navController::navigateUp,
                onLongClick = navController::backToMain,
            ) {
                Icon(
                    painterResource(R.drawable.arrow_back),
                    contentDescription = null,
                    modifier = Modifier.size(24.dp),
                )
            }
        },
        scrollBehavior = scrollBehavior,
    )
}

private suspend fun completeWebPairing(
    server: String,
    code: String,
    cookie: String,
    visitorData: String,
    dataSyncId: String,
    poToken: String,
): Result<Unit> = withContext(Dispatchers.IO) {
    runCatching {
        val endpoint = URL("${normalizeServerUrl(server)}/api/auth/pairing/complete")
        val payload = webPairingJson.encodeToString(
            WebPairingCompleteRequest(
                code = normalizePairingCode(code),
                cookie = cookie,
                visitorData = visitorData.takeIf { it.isNotBlank() },
                dataSyncId = dataSyncId.takeIf { it.isNotBlank() },
                poToken = poToken.takeIf { it.isNotBlank() },
            ),
        )
        val connection = (endpoint.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 10_000
            readTimeout = 15_000
            doOutput = true
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Content-Type", "application/json")
        }

        connection.outputStream.use { output ->
            output.write(payload.toByteArray(Charsets.UTF_8))
        }

        val body = runCatching {
            val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
            stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        }.getOrDefault("")

        if (connection.responseCode !in 200..299) {
            val error = runCatching {
                webPairingJson.decodeFromString(WebPairingError.serializer(), body).error
            }.getOrNull()
            throw IllegalStateException(error ?: "OpenTune Web rejected pairing (${connection.responseCode})")
        }
    }
}

private fun normalizeServerUrl(value: String): String {
    val trimmed = value.trim().trimEnd('/')
    val withScheme = if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed else "http://$trimmed"
    require(withScheme.length > "http://".length) { "Enter the OpenTune Web server URL" }
    return withScheme
}

private fun normalizePairingCode(value: String): String =
    value.filter { it.isLetterOrDigit() }.uppercase()

private val webPairingJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}

@Serializable
private data class WebPairingCompleteRequest(
    val code: String,
    val cookie: String,
    val visitorData: String? = null,
    val dataSyncId: String? = null,
    val poToken: String? = null,
)

@Serializable
private data class WebPairingError(
    val error: String? = null,
)
