package com.arturo254.opentune.webapi

import com.arturo254.opentune.innertube.NewPipeUtils
import com.arturo254.opentune.innertube.PlaybackAuthState
import com.arturo254.opentune.innertube.YouTube
import com.arturo254.opentune.innertube.models.AccountInfo
import com.arturo254.opentune.innertube.models.AlbumItem
import com.arturo254.opentune.innertube.models.Artist
import com.arturo254.opentune.innertube.models.ArtistItem
import com.arturo254.opentune.innertube.models.BrowseEndpoint
import com.arturo254.opentune.innertube.models.PlaylistItem
import com.arturo254.opentune.innertube.models.SongItem
import com.arturo254.opentune.innertube.models.WatchEndpoint
import com.arturo254.opentune.innertube.models.YTItem
import com.arturo254.opentune.innertube.models.YouTubeClient
import com.arturo254.opentune.innertube.pages.BrowseResult
import com.arturo254.opentune.innertube.pages.ExplorePage
import com.arturo254.opentune.innertube.pages.HomePage
import com.arturo254.opentune.innertube.pages.MoodAndGenres
import com.arturo254.opentune.innertube.pages.SearchResult
import com.arturo254.opentune.innertube.pages.SearchSummary
import com.arturo254.opentune.innertube.pages.SearchSummaryPage
import com.arturo254.opentune.innertube.models.response.PlayerResponse
import com.arturo254.opentune.innertube.utils.completed
import com.arturo254.opentune.innertube.utils.parseCookieString
import com.arturo254.opentune.kugou.KuGou
import com.arturo254.opentune.lrclib.LrcLib
import io.ktor.client.plugins.ClientRequestException
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.ApplicationCallPipeline
import io.ktor.server.application.call
import io.ktor.server.application.install
import io.ktor.server.request.path
import io.ktor.server.cio.EngineMain
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.response.respondFile
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import io.ktor.server.routing.routing
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.net.Inet4Address
import java.net.NetworkInterface
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.nio.file.attribute.PosixFilePermission
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

fun main(args: Array<String>) = EngineMain.main(args)

@Volatile
private var cachedWebAccount: WebAccountDto? = null

@Volatile
private var cachedWebAccountAtMillis: Long = 0L

private val webAuthJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
}
private val webAuthSessionPath: Path = resolveWebAuthSessionPath()

private const val ACCESS_TOKEN_HEADER = "X-OpenTune-Token"

/**
 * Endpoints reachable without the access token.
 *
 * `/api/health` exposes nothing. `/api/auth/pairing/complete` is called by the phone, which has no
 * way to know the token -- the short-lived, single-use pairing code is the credential there, and it
 * is only ever issued to a request that already presented the token.
 */
private val unauthenticatedApiPaths = setOf(
    "/api/health",
    "/api/auth/pairing/complete",
    "/api/auth/pairing/claim",
)

private val webAccessTokenPath: Path = resolveWebAccessTokenPath()
private val webAccessToken: String = resolveWebAccessToken()

private const val MAX_CACHE_ENTRIES = 512

private val catalogCacheTtl = TimeUnit.MINUTES.toMillis(10)
private val searchCacheTtl = TimeUnit.MINUTES.toMillis(5)
private val libraryCacheTtl = TimeUnit.MINUTES.toMillis(5)
private val lyricsCacheTtl = TimeUnit.HOURS.toMillis(24)
private val playerCacheMaxTtl = TimeUnit.MINUTES.toMillis(30)

/** Retire a stream URL well before YouTube does, so a cached one is never handed out dead. */
private val playerCacheSafetyMargin = TimeUnit.MINUTES.toMillis(5)

private class CachedResponse(val value: Any, val expiresAt: Long) {
    val isExpired: Boolean
        get() = System.currentTimeMillis() > expiresAt
}

private val responseCache = ConcurrentHashMap<String, CachedResponse>()

/**
 * Serves [key] from cache when it is still fresh, otherwise runs [block] and stores the result.
 *
 * Only successful results are cached: [block] throwing propagates, so a transient upstream failure
 * is retried on the next request rather than being remembered for the whole TTL.
 */
private suspend fun <T : Any> cached(key: String, ttlMillis: Long, block: suspend () -> T): T {
    responseCache[key]?.takeIf { !it.isExpired }?.let {
        @Suppress("UNCHECKED_CAST")
        return it.value as T
    }

    val value = block()
    cacheResponse(key, value, ttlMillis)
    return value
}

private fun cacheResponse(key: String, value: Any, ttlMillis: Long) {
    if (ttlMillis <= 0) return

    if (responseCache.size >= MAX_CACHE_ENTRIES) {
        responseCache.entries.removeIf { it.value.isExpired }
        if (responseCache.size >= MAX_CACHE_ENTRIES) responseCache.clear()
    }
    responseCache[key] = CachedResponse(value, System.currentTimeMillis() + ttlMillis)
}

/**
 * Drops every cached response.
 *
 * Browse, search and library requests all carry the signed-in identity, so their responses belong to
 * whoever was logged in when they were stored. Keeping them across a login, logout or session
 * degrade would serve one account's library to the next.
 */
private fun invalidateResponseCache() {
    responseCache.clear()
}

private fun invalidateCachePrefix(prefix: String) {
    responseCache.keys.removeIf { it.startsWith(prefix) }
}
private val pairingRandom = SecureRandom()
private val pendingPairings = ConcurrentHashMap<String, PairingSession>()
private const val pairingCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
private val pairingTtlMillis = TimeUnit.MINUTES.toMillis(10)
private val authVerifyTimeoutMillis = TimeUnit.SECONDS.toMillis(10)
private val accountCacheTtlMillis = TimeUnit.MINUTES.toMillis(5)

fun Application.module() {
    restorePersistedWebAuthSession()
    announceAccessUrl()
    verifyRestoredWebAuthSession()

    install(ContentNegotiation) {
        json(
            Json {
                ignoreUnknownKeys = true
                explicitNulls = false
                encodeDefaults = true
            },
        )
    }

    // Guards the API only. The app shell itself is not sensitive, and gating it would break reload:
    // the client strips the token from the URL once it has stored it, so a refresh arrives with no
    // token and would be met with a 401 page instead of the app.
    intercept(ApplicationCallPipeline.Plugins) {
        if (!call.request.path().startsWith("/api")) return@intercept
        if (call.isAccessAuthorized()) return@intercept

        call.respond(
            HttpStatusCode.Unauthorized,
            ApiError("Missing or invalid OpenTune access token"),
        )
        finish()
    }

    routing {
        route("/api") {
            get("/health") {
                call.respond(
                    HealthResponse(
                        service = "opentune-web-api",
                        status = "ok",
                    ),
                )
            }

            route("/auth") {
                get("/status") {
                    call.respond(webAuthStatus())
                }

                route("/pairing") {
                    post("/start") {
                        pruneExpiredPairings()
                        val code = generatePairingCode()
                        val expiresAt = System.currentTimeMillis() + pairingTtlMillis
                        pendingPairings[code] = PairingSession(expiresAt = expiresAt)
                        call.respond(
                            PairingStartResponseDto(
                                code = code,
                                expiresAt = expiresAt,
                            ),
                        )
                    }

                    get("/status") {
                        val code = normalizePairingCode(call.requiredQuery("code") ?: return@get)
                        val pairing = pendingPairings[code]
                        when {
                            pairing == null -> call.respond(PairingStatusResponseDto(state = "missing"))
                            pairing.isExpired -> {
                                pendingPairings.remove(code)
                                call.respond(PairingStatusResponseDto(state = "expired"))
                            }
                            pairing.authStatus != null -> call.respond(
                                PairingStatusResponseDto(
                                    state = "paired",
                                    auth = pairing.authStatus,
                                ),
                            )
                            else -> call.respond(
                                PairingStatusResponseDto(
                                    state = "pending",
                                    expiresAt = pairing.expiresAt,
                                ),
                            )
                        }
                    }

                    post("/complete") {
                        pruneExpiredPairings()
                        val request = call.receive<PairingCompleteRequestDto>()
                        val code = normalizePairingCode(request.code)
                        val pairing = pendingPairings[code]
                        if (pairing == null || pairing.isExpired) {
                            if (pairing?.isExpired == true) pendingPairings.remove(code)
                            call.respond(HttpStatusCode.NotFound, ApiError("Pairing code expired or not found"))
                            return@post
                        }

                        val session = request.session()
                        val cookie = session.cookie.normalizedAuthValue().orEmpty()
                        if (cookie.isBlank()) {
                            call.respond(HttpStatusCode.BadRequest, ApiError("Missing YouTube Music cookie"))
                            return@post
                        }
                        if ("SAPISID" !in parseCookieString(cookie)) {
                            call.respond(HttpStatusCode.BadRequest, ApiError("Cookie must include SAPISID"))
                            return@post
                        }

                        val normalizedSession = session.copy(
                            cookie = cookie,
                            visitorData = session.visitorData.normalizedAuthValue(),
                            dataSyncId = session.dataSyncId.normalizedAuthValue(),
                            poToken = session.poToken.normalizedAuthValue(),
                        )
                        applyVerifiedWebAuthSession(normalizedSession).onFailure { error ->
                            call.respond(HttpStatusCode.Unauthorized, ApiError(rejectedSessionMessage(error)))
                            return@post
                        }
                        persistWebAuthSession(normalizedSession)
                        val status = webAuthStatus()
                        pendingPairings[code] = pairing.copy(authStatus = status)
                        call.respond(PairingCompleteResponseDto(ok = true, status = status))
                    }

                    /**
                     * Sends the web server's signed-in session *to* the phone.
                     *
                     * The mirror of /complete, for a phone that has no login yet: rather than the
                     * phone pushing credentials up, it redeems a code to pull them down, so a fresh
                     * install never has to do a Google login of its own.
                     *
                     * This hands out the YouTube session, so unlike every other pairing endpoint it
                     * gives away credentials rather than accepting them. Two things keep that
                     * contained: a code can only be minted by a caller that already holds the API
                     * token, and the code is consumed here -- a credential-dispensing code must not
                     * be replayable.
                     */
                    post("/claim") {
                        pruneExpiredPairings()
                        val request = call.receive<PairingClaimRequestDto>()
                        val code = normalizePairingCode(request.code)
                        val pairing = pendingPairings[code]
                        if (pairing == null || pairing.isExpired) {
                            if (pairing?.isExpired == true) pendingPairings.remove(code)
                            call.respond(HttpStatusCode.NotFound, ApiError("Pairing code expired or not found"))
                            return@post
                        }

                        val session = currentWebAuthSession()
                        if (session == null) {
                            call.respond(
                                HttpStatusCode.Conflict,
                                ApiError("OpenTune Web is not signed in to YouTube Music, so it has no session to send."),
                            )
                            return@post
                        }

                        pendingPairings.remove(code)

                        call.respond(
                            PairingClaimResponseDto(
                                cookie = session.cookie,
                                visitorData = session.visitorData,
                                dataSyncId = session.dataSyncId,
                                poToken = session.poToken,
                                account = webAuthStatus().account,
                            ),
                        )
                    }
                }

                post("/session") {
                    val request = call.receive<AuthSessionRequestDto>()
                    val cookie = request.cookie.normalizedAuthValue().orEmpty()
                    if (cookie.isBlank()) {
                        call.respond(HttpStatusCode.BadRequest, ApiError("Missing YouTube Music cookie"))
                        return@post
                    }
                    if ("SAPISID" !in parseCookieString(cookie)) {
                        call.respond(HttpStatusCode.BadRequest, ApiError("Cookie must include SAPISID"))
                        return@post
                    }

                    val session = AuthSessionRequestDto(
                        cookie = cookie,
                        visitorData = request.visitorData.normalizedAuthValue(),
                        dataSyncId = request.dataSyncId.normalizedAuthValue(),
                        poToken = request.poToken.normalizedAuthValue(),
                    )
                    applyVerifiedWebAuthSession(session).onFailure { error ->
                        call.respond(HttpStatusCode.Unauthorized, ApiError(rejectedSessionMessage(error)))
                        return@post
                    }
                    persistWebAuthSession(session)

                    call.respond(webAuthStatus())
                }

                delete("/session") {
                    clearWebAuthSession()
                    deletePersistedWebAuthSession()
                    call.respond(webAuthStatus())
                }
            }

            get("/home") {
                val params = call.request.queryParameters["params"]
                    ?.trim()
                    ?.takeIf { it.isNotBlank() }
                call.respondApi {
                    cached("home:${params.orEmpty()}", catalogCacheTtl) {
                        YouTube.home(params = params).getOrThrow().toDto()
                    }
                }
            }

            get("/search/suggestions") {
                val query = call.requiredQuery("q") ?: return@get
                call.respondApi {
                    cached("suggestions:$query", searchCacheTtl) {
                        val suggestions = YouTube.searchSuggestions(query).getOrThrow()
                        SearchSuggestionsDto(
                            queries = suggestions.queries,
                            recommendedItems = suggestions.recommendedItems.map(YTItem::toDto),
                        )
                    }
                }
            }

            get("/search/summary") {
                val query = call.requiredQuery("q") ?: return@get
                call.respondApi {
                    cached("summary:$query", searchCacheTtl) {
                        YouTube.searchSummary(query).getOrThrow().toDto()
                    }
                }
            }

            get("/search") {
                val query = call.requiredQuery("q") ?: return@get
                val filter = call.request.queryParameters["filter"]?.let(::searchFilterFromName)
                if (filter == null) {
                    call.respondApi {
                        cached("summary:$query", searchCacheTtl) {
                            YouTube.searchSummary(query).getOrThrow().toDto()
                        }
                    }
                    return@get
                }

                call.respondApi {
                    cached("search:${filter.value}:$query", searchCacheTtl) {
                        YouTube.search(query, filter).getOrThrow().toDto()
                    }
                }
            }

            get("/explore") {
                call.respondApi {
                    cached("explore", catalogCacheTtl) {
                        YouTube.explore().getOrThrow().toDto()
                    }
                }
            }

            get("/browse") {
                val browseId = call.requiredQuery("browseId") ?: return@get
                val params = call.request.queryParameters["params"]
                    ?.trim()
                    ?.takeIf { it.isNotBlank() }
                call.respondApi {
                    cached("browse:$browseId:${params.orEmpty()}", catalogCacheTtl) {
                        YouTube.browse(browseId = browseId, params = params).getOrThrow().toDto()
                    }
                }
            }

            get("/library") {
                val filter = call.request.queryParameters["filter"]?.trim().orEmpty()
                call.respondApi {
                    cached("library:$filter", libraryCacheTtl) {
                        loadLibraryItems(filter).toLibraryResponse(filter)
                    }
                }
            }

            post("/library/like") {
                val request = call.receive<LikeRequestDto>()
                val videoId = request.videoId.trim()
                if (videoId.isBlank()) {
                    call.respond(HttpStatusCode.BadRequest, ApiError("Missing video id"))
                    return@post
                }

                call.respondApi {
                    YouTube.likeVideo(videoId, request.liked).exceptionOrNull()?.let { throw it }
                    // The like just changed the library, so the cached copy is now wrong.
                    invalidateCachePrefix("library:")
                    LikeResponseDto(videoId = videoId, liked = request.liked)
                }
            }

            get("/album/{browseId}") {
                val browseId = call.parameters["browseId"]?.trim().orEmpty()
                if (browseId.isBlank()) {
                    call.respond(HttpStatusCode.BadRequest, ApiError("Missing album id"))
                    return@get
                }

                call.respondApi {
                    cached("album:$browseId", catalogCacheTtl) {
                        val page = YouTube.album(browseId).getOrThrow()
                        DetailResponseDto(
                            kind = "album",
                            item = page.album.toDto(),
                            tracks = page.songs.map(YTItem::toDto),
                        )
                    }
                }
            }

            get("/playlist/{playlistId}") {
                val playlistId = call.parameters["playlistId"]?.trim()?.removePrefix("VL").orEmpty()
                if (playlistId.isBlank()) {
                    call.respond(HttpStatusCode.BadRequest, ApiError("Missing playlist id"))
                    return@get
                }

                call.respondApi {
                    cached("playlist:$playlistId", catalogCacheTtl) {
                        val page = YouTube.playlist(playlistId).getOrThrow()
                        DetailResponseDto(
                            kind = "playlist",
                            item = page.playlist.toDto(),
                            tracks = page.songs.map(YTItem::toDto),
                            continuation = page.songsContinuation ?: page.continuation,
                        )
                    }
                }
            }

            get("/next/{videoId}") {
                val videoId = call.parameters["videoId"]?.trim().orEmpty()
                if (videoId.isBlank()) {
                    call.respond(HttpStatusCode.BadRequest, ApiError("Missing video id"))
                    return@get
                }

                val playlistId = call.request.queryParameters["playlistId"]?.trim()?.takeIf { it.isNotBlank() }
                val setVideoId = call.request.queryParameters["setVideoId"]?.trim()?.takeIf { it.isNotBlank() }

                call.respondApi {
                    cached("next:$videoId:${playlistId.orEmpty()}:${setVideoId.orEmpty()}", catalogCacheTtl) {
                        val next = YouTube.next(
                            WatchEndpoint(
                                videoId = videoId,
                                playlistId = playlistId,
                                playlistSetVideoId = setVideoId,
                            ),
                        ).getOrThrow()
                        NextResponseDto(
                            title = next.title,
                            items = next.items.map(YTItem::toDto),
                            currentIndex = next.currentIndex,
                            continuation = next.continuation,
                            lyricsEndpoint = next.lyricsEndpoint.toDto(),
                            relatedEndpoint = next.relatedEndpoint.toDto(),
                        )
                    }
                }
            }

            get("/lyrics/{videoId}") {
                val videoId = call.parameters["videoId"]?.trim().orEmpty()
                if (videoId.isBlank()) {
                    call.respond(HttpStatusCode.BadRequest, ApiError("Missing video id"))
                    return@get
                }

                call.respondApi {
                    // A track's lyrics do not change, so this is keyed on the video alone and held
                    // for a long TTL. It is by far the slowest endpoint, and the one users hit
                    // repeatedly as they replay a song.
                    cached("lyrics:$videoId", lyricsCacheTtl) {
                        val requestedTitle = call.request.queryParameters["title"]?.trim().orEmpty()
                        val requestedArtist = call.request.queryParameters["artist"]?.trim().orEmpty()
                        val requestedDuration = call.request.queryParameters["duration"]?.toIntOrNull() ?: -1
                        val playerDetails = if (requestedDuration <= 0 || requestedTitle.isBlank() || requestedArtist.isBlank()) {
                            runCatching { resolvePlayer(videoId).response.videoDetails }.getOrNull()
                        } else {
                            null
                        }

                        resolveLyrics(
                            videoId = videoId,
                            title = requestedTitle.ifBlank { playerDetails?.title.orEmpty() },
                            artist = requestedArtist.ifBlank { playerDetails?.author.orEmpty() },
                            album = call.request.queryParameters["album"]?.trim()?.takeIf { it.isNotBlank() },
                            duration = requestedDuration.takeIf { it > 0 }
                                ?: playerDetails?.lengthSeconds?.toIntOrNull()
                                ?: -1,
                        )
                    }
                }
            }

            get("/player/{videoId}") {
                val videoId = call.parameters["videoId"]?.trim().orEmpty()
                if (videoId.isBlank()) {
                    call.respond(HttpStatusCode.BadRequest, ApiError("Missing video id"))
                    return@get
                }

                call.respondApi {
                    cachedPlayerResponse(videoId)
                }
            }
        }

        serveWebPrototype()
    }
}

/**
 * Runs [block], and if YouTube rejects the stored credentials mid-flight, drops them and retries the
 * call anonymously.
 *
 * A session can die at any time. Without this, the first 401 wedges the server: every later browse
 * still attaches `onBehalfOfUser` from the dead session and fails the same way, so the whole app
 * stays broken until it is restarted.
 */
private suspend fun ApplicationCall.respondApi(block: suspend () -> Any) {
    try {
        respond(block())
        return
    } catch (error: Throwable) {
        if (!error.isUnauthorizedResponse() || !YouTube.authState.hasLoginCookie) {
            respondApiError(error)
            return
        }
        dropDeadWebAuthSession("YouTube rejected the session on ${request.local.uri}")
    }

    // Retried once, now signed out. A second failure is a real error, not an expired session.
    try {
        respond(block())
    } catch (retryError: Throwable) {
        respondApiError(retryError)
    }
}

private suspend fun ApplicationCall.respondApiError(error: Throwable) {
    // Falling back to the exception class name leaked internals to the client
    // ("NullPointerException" as user-facing copy). Keep deliberate messages thrown by our
    // own code, log everything, and give the client generic copy for anything unexpected.
    System.err.println("[opentune-web-api] ${request.local.uri} failed: ${error::class.simpleName}: ${error.message}")
    error.printStackTrace()

    respond(
        HttpStatusCode.BadGateway,
        ApiError(error.message?.takeIf { it.isNotBlank() } ?: "Request failed"),
    )
}

/** The session this server is currently signed in with, or null if it has no usable login to hand over. */
private fun currentWebAuthSession(): AuthSessionRequestDto? {
    val state = YouTube.authState
    val cookie = state.cookie.normalizedAuthValue() ?: return null
    if ("SAPISID" !in parseCookieString(cookie)) return null

    return AuthSessionRequestDto(
        cookie = cookie,
        visitorData = state.visitorData.normalizedAuthValue(),
        dataSyncId = state.dataSyncId.normalizedAuthValue(),
        poToken = state.poToken.normalizedAuthValue(),
    )
}

private fun applyWebAuthSession(session: AuthSessionRequestDto) {
    YouTube.authState = PlaybackAuthState(
        cookie = session.cookie.normalizedAuthValue(),
        visitorData = session.visitorData.normalizedAuthValue(),
        dataSyncId = session.dataSyncId.normalizedAuthValue(),
        poToken = session.poToken.normalizedAuthValue(),
        webClientPoTokenEnabled = !session.poToken.normalizedAuthValue().isNullOrBlank(),
    )
    YouTube.useLoginForBrowse = true
    cacheWebAccount(null)
    invalidateResponseCache()
}

private fun clearWebAuthSession() {
    YouTube.authState = PlaybackAuthState.EMPTY
    YouTube.useLoginForBrowse = false
    cacheWebAccount(null)
    invalidateResponseCache()
}

/**
 * Drops the signed-in credentials but keeps [PlaybackAuthState.visitorData], so browse and search
 * keep working as an anonymous session instead of failing outright.
 *
 * A dead cookie must not merely stop authenticating: every browse request carries
 * `context.user.onBehalfOfUser = dataSyncId`, and YouTube answers 401 to an on-behalf-of request
 * from a session it cannot identify. Leaving the credentials in place turns "signed out" into a
 * hard failure on every endpoint.
 */
/**
 * Throws away credentials YouTube has actually rejected, and says so.
 *
 * Losing a login is a big deal -- the user has to obtain a new one, and with pairing the phone may
 * be relying on this server to hold it. It previously happened silently: the session was deleted,
 * the request was retried anonymously, a 200 went back, and nothing anywhere said why the account
 * had vanished. Never drop a session without leaving a reason behind.
 */
private fun dropDeadWebAuthSession(reason: String) {
    System.err.println("[opentune-web-api] Signed out: $reason. The saved session has been deleted.")
    degradeWebAuthSession()
    deletePersistedWebAuthSession()
}

private fun degradeWebAuthSession() {
    YouTube.authState = PlaybackAuthState(visitorData = YouTube.authState.visitorData)
    YouTube.useLoginForBrowse = false
    cacheWebAccount(null)
    invalidateResponseCache()
}

private fun rejectedSessionMessage(error: Throwable): String =
    if (error.isRejectedSession()) {
        "YouTube Music rejected these credentials. Sign in at music.youtube.com and capture the session again."
    } else {
        "Could not verify the YouTube Music session: ${error.message ?: error::class.simpleName}"
    }

/** True when YouTube rejected the request's credentials outright. Safe to conclude from any call. */
private fun Throwable.isUnauthorizedResponse(): Boolean =
    this is ClientRequestException &&
        (response.status == HttpStatusCode.Unauthorized || response.status == HttpStatusCode.Forbidden)

/**
 * True when YouTube answered but refused to identify the session, i.e. the cookie is not usable.
 *
 * Only meaningful for the result of [YouTube.accountInfo], which throws [IllegalStateException] when
 * the response carries no account header. Elsewhere that exception means a parse failure, not a
 * signed-out session, so use [isUnauthorizedResponse] instead.
 */
/**
 * Whether a session offered to us looks unusable.
 *
 * Deliberately broad: this judges a session someone just handed over, so refusing a merely-suspect
 * one costs nothing. Do NOT use it to decide whether to throw away a session we already hold --
 * see [isConfirmedDeadSession].
 */
private fun Throwable.isRejectedSession(): Boolean =
    isUnauthorizedResponse() || this is IllegalStateException

/**
 * Whether YouTube actually rejected the credentials we are holding.
 *
 * Only a real 401/403 counts. [isRejectedSession] is far too broad to delete a stored login by:
 * `accountInfo()` throws IllegalStateException whenever YouTube's reply does not parse into an
 * account block, which happens for reasons that have nothing to do with a dead cookie. Treating
 * that as proof of rejection silently deleted a perfectly good saved session -- the credentials
 * were destroyed on disk, the request retried anonymously and returned 200, and nothing was logged.
 */
private fun Throwable.isConfirmedDeadSession(): Boolean = isUnauthorizedResponse()

/**
 * Applies [session] and confirms YouTube actually accepts it. A cookie can contain SAPISID and
 * still be expired, so a structural check alone would persist credentials that fail on every call.
 *
 * A session that fails verification is rolled back, so submitting bad credentials never disturbs
 * a session that was already working.
 */
private suspend fun applyVerifiedWebAuthSession(session: AuthSessionRequestDto): Result<Unit> {
    val previousAuthState = YouTube.authState
    val previousUseLoginForBrowse = YouTube.useLoginForBrowse
    val previousAccount = cachedWebAccount

    applyWebAuthSession(session)
    return YouTube.accountInfo()
        .onSuccess { cacheWebAccount(it.toWebAccountDto()) }
        .onFailure {
            YouTube.authState = previousAuthState
            YouTube.useLoginForBrowse = previousUseLoginForBrowse
            cacheWebAccount(previousAccount)
        }
        .map { }
}

/**
 * Confirms the credentials restored from disk still work. Network failures leave the session
 * untouched: only an outright rejection from YouTube signs the user out.
 */
private fun verifyRestoredWebAuthSession() {
    if (!YouTube.authState.hasLoginCookie) return
    val result = runBlocking {
        withTimeoutOrNull(authVerifyTimeoutMillis) { YouTube.accountInfo() }
    } ?: return

    result
        .onSuccess { cacheWebAccount(it.toWebAccountDto()) }
        .onFailure { error ->
            if (!error.isConfirmedDeadSession()) {
                System.err.println(
                    "[opentune-web-api] Could not read the account on startup, keeping the saved session: ${error.message}",
                )
                return@onFailure
            }
            dropDeadWebAuthSession("YouTube rejected the saved session on startup")
        }
}

private fun restorePersistedWebAuthSession() {
    val session = runCatching {
        if (!Files.isRegularFile(webAuthSessionPath)) return
        webAuthJson.decodeFromString(
            AuthSessionRequestDto.serializer(),
            Files.readString(webAuthSessionPath, StandardCharsets.UTF_8),
        )
    }.getOrNull() ?: return

    val cookie = session.cookie.normalizedAuthValue().orEmpty()
    if ("SAPISID" !in parseCookieString(cookie)) {
        deletePersistedWebAuthSession()
        return
    }

    applyWebAuthSession(
        session.copy(
            cookie = cookie,
            visitorData = session.visitorData.normalizedAuthValue(),
            dataSyncId = session.dataSyncId.normalizedAuthValue(),
            poToken = session.poToken.normalizedAuthValue(),
        ),
    )
}

private fun persistWebAuthSession(session: AuthSessionRequestDto) {
    runCatching {
        val parent = webAuthSessionPath.parent
        if (parent != null) {
            Files.createDirectories(parent)
            setOwnerOnlyPermissions(parent, directory = true)
        }
        Files.writeString(
            webAuthSessionPath,
            webAuthJson.encodeToString(AuthSessionRequestDto.serializer(), session),
            StandardCharsets.UTF_8,
            StandardOpenOption.CREATE,
            StandardOpenOption.TRUNCATE_EXISTING,
            StandardOpenOption.WRITE,
        )
        setOwnerOnlyPermissions(webAuthSessionPath, directory = false)
    }
}

private fun deletePersistedWebAuthSession() {
    runCatching { Files.deleteIfExists(webAuthSessionPath) }
}

/**
 * Returns whether the caller may use the API.
 *
 * The server binds every interface so a phone can reach it for pairing, which also means anyone else
 * on the network can. Without this, they could read the account and browse with the signed-in
 * YouTube session.
 */
private fun ApplicationCall.isAccessAuthorized(): Boolean {
    if (request.path() in unauthenticatedApiPaths) return true

    val presented = request.headers[ACCESS_TOKEN_HEADER]
        ?: request.queryParameters["token"]
        ?: return false

    // Compared as raw bytes in constant time: a length-sensitive or short-circuiting comparison
    // leaks the token a character at a time to anyone who can measure the response.
    return MessageDigest.isEqual(
        presented.toByteArray(StandardCharsets.UTF_8),
        webAccessToken.toByteArray(StandardCharsets.UTF_8),
    )
}

private fun resolveWebAccessTokenPath(): Path {
    val explicit = System.getProperty("opentune.web.token.file")
        ?: System.getenv("OPENTUNE_WEB_TOKEN_FILE")
    if (!explicit.isNullOrBlank()) return File(explicit).toPath()

    val home = System.getProperty("user.home")?.takeIf { it.isNotBlank() } ?: "."
    return File(home, ".config/opentune-web/access-token").toPath()
}

/**
 * Loads the access token, generating and persisting one on first run.
 *
 * The token is stable across restarts so a bookmarked OpenTune Web URL keeps working; regenerating
 * per boot would invalidate it every time and make the server unusable from a saved link.
 */
private fun resolveWebAccessToken(): String {
    System.getenv("OPENTUNE_WEB_TOKEN")?.trim()?.takeIf { it.isNotBlank() }?.let { return it }

    runCatching { Files.readString(webAccessTokenPath).trim() }
        .getOrNull()
        ?.takeIf { it.isNotBlank() }
        ?.let { return it }

    val token = generateAccessToken()
    runCatching {
        webAccessTokenPath.parent?.let { parent ->
            Files.createDirectories(parent)
            setOwnerOnlyPermissions(parent, directory = true)
        }
        Files.writeString(
            webAccessTokenPath,
            token,
            StandardCharsets.UTF_8,
            StandardOpenOption.CREATE,
            StandardOpenOption.TRUNCATE_EXISTING,
            StandardOpenOption.WRITE,
        )
        setOwnerOnlyPermissions(webAccessTokenPath, directory = false)
    }
    return token
}

/**
 * Prints the URLs that open OpenTune Web with the token already attached.
 *
 * The token is unguessable by design, so it has to be handed to the user somewhere. The LAN URL is
 * the one that matters: it is what a phone can actually reach for pairing.
 */
private fun announceAccessUrl() {
    val port = System.getenv("PORT")?.toIntOrNull() ?: 8080
    val hosts = buildList {
        add("127.0.0.1")
        addAll(localNetworkAddresses())
    }

    println("[opentune-web-api] Open OpenTune Web with one of:")
    hosts.forEach { host ->
        println("[opentune-web-api]   http://$host:$port/?token=$webAccessToken")
    }
    println("[opentune-web-api] Token stored at $webAccessTokenPath")
}

private fun localNetworkAddresses(): List<String> =
    runCatching {
        NetworkInterface.getNetworkInterfaces()
            .asSequence()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.asSequence() }
            .filterIsInstance<Inet4Address>()
            .filter { it.isSiteLocalAddress }
            .map { it.hostAddress }
            .distinct()
            .toList()
    }.getOrDefault(emptyList())

private fun generateAccessToken(): String {
    val bytes = ByteArray(32)
    SecureRandom().nextBytes(bytes)
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
}

private fun resolveWebAuthSessionPath(): Path {
    val explicit = System.getProperty("opentune.web.auth.file")
        ?: System.getenv("OPENTUNE_WEB_AUTH_FILE")
    if (!explicit.isNullOrBlank()) return File(explicit).toPath()

    val home = System.getProperty("user.home")?.takeIf { it.isNotBlank() } ?: "."
    return File(home, ".config/opentune-web/auth-session.json").toPath()
}

private fun setOwnerOnlyPermissions(path: Path, directory: Boolean) {
    runCatching {
        val permissions = if (directory) {
            setOf(
                PosixFilePermission.OWNER_READ,
                PosixFilePermission.OWNER_WRITE,
                PosixFilePermission.OWNER_EXECUTE,
            )
        } else {
            setOf(
                PosixFilePermission.OWNER_READ,
                PosixFilePermission.OWNER_WRITE,
            )
        }
        Files.setPosixFilePermissions(path, permissions)
    }
}

private suspend fun webAuthStatus(refreshAccount: Boolean = false): AuthStatusDto {
    var loggedIn = YouTube.authState.hasLoginCookie
    var accountError: String? = null

    if (!loggedIn) {
        cacheWebAccount(null)
    } else if (refreshAccount || cachedWebAccount == null || isAccountCacheStale()) {
        YouTube.accountInfo()
            .onSuccess { cacheWebAccount(it.toWebAccountDto()) }
            .onFailure { error ->
                accountError = error.message ?: error::class.simpleName
                // Only a real 401/403 means the cookie is dead. Anything else -- most often
                // accountInfo() failing to parse a reply -- leaves the session alone: it stays
                // usable for browse and playback, and survives a restart.
                if (error.isConfirmedDeadSession()) {
                    dropDeadWebAuthSession("YouTube rejected the session while reading the account")
                    loggedIn = false
                }
            }
    }

    val authState = YouTube.authState
    return AuthStatusDto(
        loggedIn = loggedIn,
        hasCookie = !authState.cookie.isNullOrBlank(),
        hasVisitorData = !authState.visitorData.isNullOrBlank(),
        hasDataSyncId = !authState.dataSyncId.isNullOrBlank(),
        hasPoToken = !authState.poToken.isNullOrBlank(),
        useLoginForBrowse = YouTube.useLoginForBrowse,
        account = cachedWebAccount.takeIf { loggedIn },
        error = accountError,
    )
}

/** Re-checks a warm cache periodically, so a session that dies while idle is still noticed. */
private fun isAccountCacheStale(): Boolean =
    System.currentTimeMillis() - cachedWebAccountAtMillis >= accountCacheTtlMillis

private fun cacheWebAccount(account: WebAccountDto?) {
    cachedWebAccount = account
    cachedWebAccountAtMillis = if (account == null) 0L else System.currentTimeMillis()
}

private fun AccountInfo.toWebAccountDto(): WebAccountDto = WebAccountDto(
    name = name,
    email = email,
    channelHandle = channelHandle,
    thumbnailUrl = thumbnailUrl,
)

private fun String?.normalizedAuthValue(): String? =
    this?.trim()?.takeIf { it.isNotEmpty() && !it.equals("null", ignoreCase = true) }

private fun normalizePairingCode(value: String): String =
    value.filter { it.isLetterOrDigit() }.uppercase(Locale.US)

private fun generatePairingCode(): String {
    repeat(12) {
        val code = buildString {
            repeat(8) {
                append(pairingCodeAlphabet[pairingRandom.nextInt(pairingCodeAlphabet.length)])
            }
        }
        if (!pendingPairings.containsKey(code)) return code
    }
    error("Unable to generate pairing code")
}

private fun pruneExpiredPairings() {
    pendingPairings.entries.removeIf { it.value.isExpired }
}

private suspend fun ApplicationCall.requiredQuery(name: String): String? {
    val value = request.queryParameters[name]?.trim().orEmpty()
    if (value.isBlank()) {
        respond(HttpStatusCode.BadRequest, ApiError("Missing query parameter: $name"))
        return null
    }
    return value
}

private fun searchFilterFromName(value: String): YouTube.SearchFilter? =
    when (value.trim().lowercase()) {
        "song", "songs" -> YouTube.SearchFilter.FILTER_SONG
        "video", "videos" -> YouTube.SearchFilter.FILTER_VIDEO
        "album", "albums" -> YouTube.SearchFilter.FILTER_ALBUM
        "artist", "artists" -> YouTube.SearchFilter.FILTER_ARTIST
        "featured_playlist", "featured-playlist", "featured-playlists" -> YouTube.SearchFilter.FILTER_FEATURED_PLAYLIST
        "community_playlist", "community-playlist", "community-playlists", "playlist", "playlists" -> YouTube.SearchFilter.FILTER_COMMUNITY_PLAYLIST
        else -> null
    }

private suspend fun loadLibraryItems(filter: String): List<YTItem> =
    when (filter.trim().lowercase()) {
        "liked", "songs" -> runCatching { YouTube.playlist("LM").completed().getOrThrow().songs }
            .getOrElse { YouTube.library("FEmusic_liked_videos").completed().getOrThrow().items }
        "saved_songs", "saved-songs" -> YouTube.library("FEmusic_liked_videos").completed().getOrThrow().items
        "playlists" -> YouTube.library("FEmusic_liked_playlists").completed().getOrThrow().items
            .filterNot { it is PlaylistItem && (it.id == "LM" || it.id == "SE") }
        "albums" -> YouTube.library("FEmusic_liked_albums").completed().getOrThrow().items
        "artists" -> YouTube.library("FEmusic_library_corpus_artists").completed().getOrThrow().items
        else -> buildList {
            addAll(runCatching { YouTube.playlist("LM").completed().getOrThrow().songs }.getOrDefault(emptyList()))
            addAll(
                runCatching { YouTube.library("FEmusic_liked_playlists").completed().getOrThrow().items }
                    .getOrDefault(emptyList())
                    .filterNot { it is PlaylistItem && (it.id == "LM" || it.id == "SE") },
            )
            addAll(runCatching { YouTube.library("FEmusic_liked_albums").completed().getOrThrow().items }.getOrDefault(emptyList()))
            addAll(runCatching { YouTube.library("FEmusic_library_corpus_artists").completed().getOrThrow().items }.getOrDefault(emptyList()))
        }
    }

private fun List<YTItem>.toLibraryResponse(filter: String) = LibraryResponseDto(
    filter = filter.ifBlank { "library" },
    items = map(YTItem::toDto),
)

private suspend fun resolveLyrics(
    videoId: String,
    title: String,
    artist: String,
    album: String?,
    duration: Int,
): LyricsResponseDto {
    val youtubeLyrics = runCatching {
        val next = YouTube.next(WatchEndpoint(videoId = videoId)).getOrThrow()
        val endpoint = next.lyricsEndpoint ?: error("Lyrics endpoint not found")
        YouTube.lyrics(endpoint).getOrThrow()?.validLyricsOrNull()
            ?: error("Lyrics unavailable")
    }.getOrNull()

    if (title.isNotBlank() && artist.isNotBlank()) {
        LrcLib.getLyrics(
            title = title,
            artist = artist,
            duration = duration,
            album = null,
        ).getOrNull()?.validLyricsOrNull()?.let { lyrics ->
            return lyrics.toLyricsResponse(source = "lrclib", synced = lyrics.hasLrcTimestamps())
        }

        KuGou.getLyrics(
            title = title,
            artist = artist,
            duration = duration,
        ).getOrNull()?.validLyricsOrNull()?.let { lyrics ->
            return lyrics.toLyricsResponse(source = "kugou", synced = lyrics.hasLrcTimestamps())
        }
    }

    youtubeLyrics?.let { lyrics ->
        return lyrics.toLyricsResponse(source = "youtube", synced = false)
    }

    error("Lyrics unavailable")
}

private fun String.toLyricsResponse(source: String, synced: Boolean): LyricsResponseDto {
    val entries = parseLrcEntries()
    return LyricsResponseDto(
        source = source,
        synced = synced && entries.isNotEmpty(),
        text = this,
        lines = lines()
            .map { it.stripLrcTimestamps().trim() }
            .filter { it.isNotBlank() },
        entries = entries,
    )
}

private fun String.validLyricsOrNull(): String? =
    takeIf { it.isNotBlank() && !it.isProviderPlaceholderLyrics() }

private fun String.isProviderPlaceholderLyrics(): Boolean {
    val normalizedLines = lineSequence()
        .map { it.stripLrcTimestamps().trim() }
        .map { it.replace(lrcMetadataTagRegex, "").trim() }
        .filterNot { it.isBlank() }
        .map { it.normalizedLyricsPlaceholderText() }
        .filter { it.isNotBlank() }
        .toList()

    if (normalizedLines.isEmpty()) return true
    val combined = normalizedLines.joinToString(separator = "")
    return combined in lyricsPlaceholderTexts || normalizedLines.all { it in lyricsPlaceholderTexts }
}

private fun String.normalizedLyricsPlaceholderText(): String =
    lowercase(Locale.ROOT).filter { it.isLetterOrDigit() }

private fun String.parseLrcEntries(): List<LyricEntryDto> =
    lines().flatMap { line ->
        val matches = lrcTimestampRegex.findAll(line).toList()
        if (matches.isEmpty()) return@flatMap emptyList()

        val text = line.stripLrcTimestamps().trim()
        if (text.isBlank()) return@flatMap emptyList()

        matches.mapNotNull { match ->
            val minutes = match.groupValues.getOrNull(1)?.toIntOrNull() ?: return@mapNotNull null
            val seconds = match.groupValues.getOrNull(2)?.toIntOrNull() ?: return@mapNotNull null
            val fractionRaw = match.groupValues.getOrNull(3).orEmpty()
            val fraction = fractionRaw.padEnd(3, '0').take(3).toIntOrNull()?.div(1000.0) ?: 0.0
            LyricEntryDto(
                time = minutes * 60.0 + seconds + fraction,
                text = text,
            )
        }
    }.sortedBy { it.time }

private fun String.hasLrcTimestamps(): Boolean =
    lineSequence().any { lrcTimestampRegex.containsMatchIn(it) }

private fun String.stripLrcTimestamps(): String =
    replace(lrcTimestampPrefixRegex, "")

private val lrcTimestampRegex = Regex("\\[(\\d{1,2}):(\\d{2})(?:[.:](\\d{1,3}))?]")
private val lrcTimestampPrefixRegex = Regex("^(?:\\[\\d{1,2}:\\d{2}(?:[.:]\\d{1,3})?])+\\s*")
private val lrcMetadataTagRegex = Regex("\\[[a-zA-Z]+:[^]]*]")
private val lyricsPlaceholderTexts = setOf(
    "纯音乐请欣赏",
    "纯音乐请您欣赏",
    "此歌曲为纯音乐请欣赏",
    "此歌曲为纯音乐请您欣赏",
    "此歌曲为没有填词的纯音乐请欣赏",
    "此歌曲为没有填词的纯音乐请您欣赏",
    "该歌曲为纯音乐请欣赏",
    "该歌曲为纯音乐请您欣赏",
    "该歌曲为没有填词的纯音乐请欣赏",
    "该歌曲为没有填词的纯音乐请您欣赏",
    "暂无歌词",
    "暂无歌词请欣赏",
    "暂无歌词敬请欣赏",
    "nolyrics",
    "instrumental",
)

private val playbackClients = listOf(
    YouTubeClient.WEB_REMIX,
    YouTubeClient.IOS,
    YouTubeClient.MOBILE,
    YouTubeClient.ANDROID_MUSIC,
    YouTubeClient.IOS_MUSIC,
    YouTubeClient.ANDROID_VR_NO_AUTH,
    YouTubeClient.ANDROID_VR_1_61_48,
    YouTubeClient.ANDROID_VR_1_43_32,
    YouTubeClient.ANDROID_CREATOR,
    YouTubeClient.ANDROID_TESTSUITE,
    YouTubeClient.ANDROID_UNPLUGGED,
    YouTubeClient.IPADOS,
    YouTubeClient.VISIONOS,
    YouTubeClient.WEB,
    YouTubeClient.MWEB,
    YouTubeClient.WEB_SAFARI,
    YouTubeClient.WEB_EMBEDDED,
).filterNot { it.loginRequired }

private data class ResolvedPlayer(
    val client: YouTubeClient,
    val response: PlayerResponse,
    val formats: List<PlayerFormatDto>,
)

/**
 * Resolves playback for [videoId], caching only what is safe to reuse.
 *
 * Stream URLs are signed and time-limited, so this cannot use a fixed TTL like the other endpoints:
 * serving one past its expiry would hand the client a URL that plays nothing. The TTL is taken from
 * the stream's own advertised lifetime, minus a margin, and capped.
 *
 * Unplayable results are deliberately not cached. A video can be blocked for transient reasons, and
 * pinning that failure for half an hour would make a recoverable hiccup look permanent.
 */
private suspend fun cachedPlayerResponse(videoId: String): PlayerResponseDto {
    val key = "player:$videoId"
    responseCache[key]?.takeIf { !it.isExpired }?.let { return it.value as PlayerResponseDto }

    val resolved = resolvePlayer(videoId)
    val response = resolved.response
    val dto = PlayerResponseDto(
        videoId = response.videoDetails?.videoId ?: videoId,
        title = response.videoDetails?.title,
        author = response.videoDetails?.author,
        durationSeconds = response.videoDetails?.lengthSeconds?.toIntOrNull(),
        thumbnail = response.videoDetails?.thumbnail?.thumbnails?.lastOrNull()?.normalizedUrl,
        playabilityStatus = response.playabilityStatus.status,
        playabilityReason = response.playabilityStatus.reason,
        expiresInSeconds = response.streamingData?.expiresInSeconds,
        formats = resolved.formats,
    )

    if (dto.playabilityStatus == "OK" && dto.formats.isNotEmpty()) {
        val streamLifetime = dto.expiresInSeconds
            ?.let { TimeUnit.SECONDS.toMillis(it.toLong()) }
            ?: 0L
        cacheResponse(key, dto, minOf(streamLifetime - playerCacheSafetyMargin, playerCacheMaxTtl))
    }

    return dto
}

private suspend fun resolvePlayer(videoId: String): ResolvedPlayer {
    val signatureTimestamp = NewPipeUtils.getSignatureTimestamp(videoId).getOrNull()
    val authState = YouTube.authState
    val setLogin = authState.hasLoginCookie
    var firstResponse: ResolvedPlayer? = null
    var firstPlayableResponse: ResolvedPlayer? = null

    for (client in playbackClients) {
        val response = YouTube.player(
            videoId = videoId,
            client = client,
            signatureTimestamp = signatureTimestamp.takeIf { client.useSignatureTimestamp },
            setLogin = setLogin,
            authState = authState,
        ).getOrNull() ?: continue

        val formats = response.streamingData
            ?.adaptiveFormats
            .orEmpty()
            .filter { it.isAudio }
            .sortedByDescending { it.averageBitrate ?: it.bitrate }

        val unresolved = formats.map { it.toDto(url = null) }
        if (firstResponse == null) {
            firstResponse = ResolvedPlayer(client, response, unresolved)
        }

        if (response.playabilityStatus.status != "OK" || formats.isEmpty()) continue

        val resolvedFormats = formats.map { format ->
            val streamUrl = NewPipeUtils.getStreamUrl(
                format = format,
                videoId = videoId,
                client = client,
            ).getOrNull()

            format.toDto(streamUrl)
        }

        val resolved = ResolvedPlayer(client, response, resolvedFormats)
        if (firstPlayableResponse == null) firstPlayableResponse = resolved
        if (resolvedFormats.any { it.url != null }) return resolved
    }

    val fallback = firstPlayableResponse ?: firstResponse
    val ytDlpUrl = resolveWithYtDlp(videoId)
    if (fallback != null && ytDlpUrl != null) {
        return fallback.copy(
            formats = listOf(
                PlayerFormatDto(
                    itag = 0,
                    mimeType = mimeTypeFromUrl(ytDlpUrl),
                    bitrate = 0,
                    url = ytDlpUrl,
                ),
            ),
        )
    }

    return firstPlayableResponse ?: firstResponse ?: error("No player response returned")
}

private suspend fun resolveWithYtDlp(videoId: String): String? = withContext(Dispatchers.IO) {
    val binary = System.getenv("OPENTUNE_YTDLP_PATH")?.takeIf { it.isNotBlank() } ?: "yt-dlp"
    val process = runCatching {
        ProcessBuilder(
            binary,
            "-g",
            "-f",
            "bestaudio[ext=m4a]/bestaudio",
            "--no-playlist",
            "https://music.youtube.com/watch?v=$videoId",
        )
            .redirectErrorStream(true)
            .start()
    }.getOrNull() ?: return@withContext null

    if (!process.waitFor(45, TimeUnit.SECONDS)) {
        process.destroyForcibly()
        return@withContext null
    }

    if (process.exitValue() != 0) return@withContext null

    process.inputStream
        .bufferedReader()
        .readLines()
        .firstOrNull { it.startsWith("http://") || it.startsWith("https://") }
}

private fun mimeTypeFromUrl(url: String): String =
    when {
        url.contains("mime=audio%2Fmp4", ignoreCase = true) -> "audio/mp4"
        url.contains("mime=audio%2Fwebm", ignoreCase = true) -> "audio/webm"
        else -> "audio/mp4"
    }

private fun PlayerResponse.StreamingData.Format.toDto(url: String?) = PlayerFormatDto(
    itag = itag,
    mimeType = mimeType,
    bitrate = bitrate,
    averageBitrate = averageBitrate,
    audioQuality = audioQuality,
    audioSampleRate = audioSampleRate,
    audioChannels = audioChannels,
    contentLength = contentLength,
    url = url,
)

private fun io.ktor.server.routing.Route.serveWebPrototype() {
    val webRoot = resolveWebRoot()
    val index = webRoot.safeResolve("index.html")

    get("/") {
        if (index?.isFile == true) {
            call.respondFile(index)
        } else {
            call.respond(HttpStatusCode.NotFound, ApiError("Web prototype not found"))
        }
    }

    get("/{path...}") {
        val path = call.parameters.getAll("path").orEmpty().joinToString("/")
        val target = webRoot.safeResolve(path)
        when {
            target?.isFile == true -> call.respondFile(target)
            index?.isFile == true -> call.respondFile(index)
            else -> call.respond(HttpStatusCode.NotFound, ApiError("Not found"))
        }
    }
}

private fun resolveWebRoot(): File {
    val explicit = System.getProperty("opentune.web.root") ?: System.getenv("OPENTUNE_WEB_ROOT")
    val candidates = listOfNotNull(
        explicit,
        "web-app/dist",
        "../web-app/dist",
        "web",
        "../web",
    )

    return candidates
        .map { File(it).canonicalFile }
        .firstOrNull { it.isDirectory }
        ?: File("web").canonicalFile
}

private fun File.safeResolve(path: String): File? {
    val target = File(this, path).canonicalFile
    val rootPath = canonicalPath
    return target.takeIf {
        it.canonicalPath == rootPath || it.canonicalPath.startsWith(rootPath + File.separator)
    }
}

private fun HomePage.toDto() = HomeResponseDto(
    chips = chips?.map { chip ->
        HomeChipDto(
            title = chip.title,
            endpoint = chip.endpoint.toDto(),
            deselectEndpoint = chip.deselectEndPoint.toDto(),
        )
    },
    sections = sections.map { section ->
        HomeSectionDto(
            title = section.title,
            label = section.label,
            thumbnail = section.thumbnail,
            endpoint = section.endpoint.toDto(),
            items = section.items.map(YTItem::toDto),
        )
    },
    continuation = continuation,
)

private fun ExplorePage.toDto() = ExploreResponseDto(
    newReleaseAlbums = newReleaseAlbums.map(YTItem::toDto),
    moods = moodAndGenres.map(MoodAndGenres.Item::toDto),
)

private fun MoodAndGenres.Item.toDto() = ExploreMoodDto(
    title = title,
    color = stripeColor.toCssColor(),
    endpoint = endpoint.toDto(),
)

private fun BrowseResult.toDto() = BrowseResponseDto(
    title = title,
    thumbnail = thumbnail,
    sections = items.map { section ->
        BrowseSectionDto(
            title = section.title,
            items = section.items.map(YTItem::toDto),
        )
    },
)

private fun Long.toCssColor(): String = "#%06x".format(this and 0xffffff)

private fun SearchSummaryPage.toDto() = SearchSummaryResponseDto(
    summaries = summaries.map(SearchSummary::toDto),
)

private fun SearchSummary.toDto() = SearchSummaryDto(
    title = title,
    items = items.map(YTItem::toDto),
)

private fun SearchResult.toDto() = SearchResultsDto(
    items = items.map(YTItem::toDto),
    continuation = continuation,
)

private fun YTItem.toDto(): WebItemDto =
    when (this) {
        is SongItem -> WebItemDto(
            type = "song",
            id = id,
            title = title,
            thumbnail = thumbnail,
            explicit = explicit,
            shareLink = shareLink,
            artists = artists.map(Artist::toDto),
            album = album?.let { WebAlbumDto(id = it.id, title = it.name) },
            duration = duration,
        )
        is AlbumItem -> WebItemDto(
            type = "album",
            id = id,
            title = title,
            thumbnail = thumbnail,
            explicit = explicit,
            shareLink = shareLink,
            artists = artists.orEmpty().map(Artist::toDto),
            browseId = browseId,
            playlistId = playlistId,
            year = year,
        )
        is PlaylistItem -> WebItemDto(
            type = "playlist",
            id = id,
            title = title,
            thumbnail = thumbnail,
            explicit = explicit,
            shareLink = shareLink,
            author = author?.toDto(),
            songCountText = songCountText,
        )
        is ArtistItem -> WebItemDto(
            type = "artist",
            id = id,
            title = title,
            thumbnail = thumbnail,
            explicit = explicit,
            shareLink = shareLink,
            channelId = channelId,
            subscriberCountText = subscriberCountText,
            monthlyListenerCountText = monthlyListenerCountText,
        )
    }

private fun Artist.toDto() = WebArtistDto(
    id = id,
    name = name,
)

private fun BrowseEndpoint?.toDto() = this?.let {
    BrowseEndpointDto(
        browseId = browseId,
        params = params,
    )
}

@Serializable
private data class ApiError(
    val error: String,
)

@Serializable
private data class HealthResponse(
    val service: String,
    val status: String,
)

@Serializable
private data class AuthSessionRequestDto(
    val cookie: String = "",
    val visitorData: String? = null,
    val dataSyncId: String? = null,
    val poToken: String? = null,
)

@Serializable
private data class AuthStatusDto(
    val loggedIn: Boolean,
    val hasCookie: Boolean,
    val hasVisitorData: Boolean,
    val hasDataSyncId: Boolean,
    val hasPoToken: Boolean,
    val useLoginForBrowse: Boolean,
    val account: WebAccountDto? = null,
    val error: String? = null,
)

private data class PairingSession(
    val expiresAt: Long,
    val authStatus: AuthStatusDto? = null,
) {
    val isExpired: Boolean
        get() = System.currentTimeMillis() > expiresAt
}

@Serializable
private data class PairingStartResponseDto(
    val code: String,
    val expiresAt: Long,
)

@Serializable
private data class PairingStatusResponseDto(
    val state: String,
    val expiresAt: Long? = null,
    val auth: AuthStatusDto? = null,
)

@Serializable
private data class PairingCompleteRequestDto(
    val code: String,
    val cookie: String = "",
    val visitorData: String? = null,
    val dataSyncId: String? = null,
    val poToken: String? = null,
) {
    fun session(): AuthSessionRequestDto = AuthSessionRequestDto(
        cookie = cookie,
        visitorData = visitorData,
        dataSyncId = dataSyncId,
        poToken = poToken,
    )
}

@Serializable
private data class PairingCompleteResponseDto(
    val ok: Boolean,
    val status: AuthStatusDto,
)

@Serializable
private data class PairingClaimRequestDto(
    val code: String,
)

@Serializable
private data class PairingClaimResponseDto(
    val cookie: String,
    val visitorData: String? = null,
    val dataSyncId: String? = null,
    val poToken: String? = null,
    val account: WebAccountDto? = null,
)

@Serializable
private data class WebAccountDto(
    val name: String,
    val email: String? = null,
    val channelHandle: String? = null,
    val thumbnailUrl: String? = null,
)

@Serializable
private data class LikeRequestDto(
    val videoId: String,
    val liked: Boolean,
)

@Serializable
private data class LikeResponseDto(
    val videoId: String,
    val liked: Boolean,
)

@Serializable
private data class BrowseEndpointDto(
    val browseId: String,
    val params: String? = null,
)

@Serializable
private data class WebArtistDto(
    val id: String? = null,
    val name: String,
)

@Serializable
private data class WebAlbumDto(
    val id: String,
    val title: String,
)

@Serializable
private data class WebItemDto(
    val type: String,
    val id: String,
    val title: String,
    val thumbnail: String? = null,
    val explicit: Boolean = false,
    val shareLink: String,
    val artists: List<WebArtistDto> = emptyList(),
    val album: WebAlbumDto? = null,
    val duration: Int? = null,
    val browseId: String? = null,
    val playlistId: String? = null,
    val author: WebArtistDto? = null,
    val songCountText: String? = null,
    val channelId: String? = null,
    val subscriberCountText: String? = null,
    val monthlyListenerCountText: String? = null,
    val year: Int? = null,
)

@Serializable
private data class HomeResponseDto(
    val chips: List<HomeChipDto>? = null,
    val sections: List<HomeSectionDto>,
    val continuation: String? = null,
)

@Serializable
private data class HomeChipDto(
    val title: String,
    val endpoint: BrowseEndpointDto? = null,
    val deselectEndpoint: BrowseEndpointDto? = null,
)

@Serializable
private data class HomeSectionDto(
    val title: String,
    val label: String? = null,
    val thumbnail: String? = null,
    val endpoint: BrowseEndpointDto? = null,
    val items: List<WebItemDto>,
)

@Serializable
private data class ExploreResponseDto(
    val newReleaseAlbums: List<WebItemDto>,
    val moods: List<ExploreMoodDto>,
)

@Serializable
private data class ExploreMoodDto(
    val title: String,
    val color: String,
    val endpoint: BrowseEndpointDto? = null,
)

@Serializable
private data class BrowseResponseDto(
    val title: String? = null,
    val thumbnail: String? = null,
    val sections: List<BrowseSectionDto>,
)

@Serializable
private data class BrowseSectionDto(
    val title: String? = null,
    val items: List<WebItemDto>,
)

@Serializable
private data class LibraryResponseDto(
    val filter: String,
    val items: List<WebItemDto>,
)

@Serializable
private data class SearchSuggestionsDto(
    val queries: List<String>,
    val recommendedItems: List<WebItemDto>,
)

@Serializable
private data class SearchSummaryResponseDto(
    val summaries: List<SearchSummaryDto>,
)

@Serializable
private data class SearchSummaryDto(
    val title: String,
    val items: List<WebItemDto>,
)

@Serializable
private data class SearchResultsDto(
    val items: List<WebItemDto>,
    val continuation: String? = null,
)

@Serializable
private data class DetailResponseDto(
    val kind: String,
    val item: WebItemDto,
    val tracks: List<WebItemDto>,
    val continuation: String? = null,
)

@Serializable
private data class NextResponseDto(
    val title: String? = null,
    val items: List<WebItemDto>,
    val currentIndex: Int? = null,
    val continuation: String? = null,
    val lyricsEndpoint: BrowseEndpointDto? = null,
    val relatedEndpoint: BrowseEndpointDto? = null,
)

@Serializable
private data class LyricsResponseDto(
    val source: String,
    val synced: Boolean,
    val text: String,
    val lines: List<String>,
    val entries: List<LyricEntryDto> = emptyList(),
)

@Serializable
private data class LyricEntryDto(
    val time: Double,
    val text: String,
)

@Serializable
private data class PlayerResponseDto(
    val videoId: String,
    val title: String? = null,
    val author: String? = null,
    val durationSeconds: Int? = null,
    val thumbnail: String? = null,
    val playabilityStatus: String,
    val playabilityReason: String? = null,
    val expiresInSeconds: Int? = null,
    val formats: List<PlayerFormatDto>,
)

@Serializable
private data class PlayerFormatDto(
    val itag: Int,
    val mimeType: String,
    val bitrate: Int,
    val averageBitrate: Int? = null,
    val audioQuality: String? = null,
    val audioSampleRate: Int? = null,
    val audioChannels: Int? = null,
    val contentLength: Long? = null,
    val url: String? = null,
)
