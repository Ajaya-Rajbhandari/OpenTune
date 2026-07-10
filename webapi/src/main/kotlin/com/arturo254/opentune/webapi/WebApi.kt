package com.arturo254.opentune.webapi

import com.arturo254.opentune.innertube.NewPipeUtils
import com.arturo254.opentune.innertube.PlaybackAuthState
import com.arturo254.opentune.innertube.YouTube
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
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.call
import io.ktor.server.application.install
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
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.nio.file.attribute.PosixFilePermission
import java.util.concurrent.TimeUnit

fun main(args: Array<String>) = EngineMain.main(args)

@Volatile
private var cachedWebAccount: WebAccountDto? = null

private val webAuthJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
}
private val webAuthSessionPath: Path = resolveWebAuthSessionPath()

fun Application.module() {
    restorePersistedWebAuthSession()

    install(ContentNegotiation) {
        json(
            Json {
                ignoreUnknownKeys = true
                explicitNulls = false
                encodeDefaults = true
            },
        )
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
                    applyWebAuthSession(session)
                    persistWebAuthSession(session)

                    call.respond(webAuthStatus(refreshAccount = true))
                }

                delete("/session") {
                    clearWebAuthSession()
                    deletePersistedWebAuthSession()
                    call.respond(webAuthStatus())
                }
            }

            get("/home") {
                call.respondApi {
                    YouTube.home(
                        params = call.request.queryParameters["params"]
                            ?.trim()
                            ?.takeIf { it.isNotBlank() },
                    ).getOrThrow().toDto()
                }
            }

            get("/search/suggestions") {
                val query = call.requiredQuery("q") ?: return@get
                call.respondApi {
                    val suggestions = YouTube.searchSuggestions(query).getOrThrow()
                    SearchSuggestionsDto(
                        queries = suggestions.queries,
                        recommendedItems = suggestions.recommendedItems.map(YTItem::toDto),
                    )
                }
            }

            get("/search/summary") {
                val query = call.requiredQuery("q") ?: return@get
                call.respondApi {
                    YouTube.searchSummary(query).getOrThrow().toDto()
                }
            }

            get("/search") {
                val query = call.requiredQuery("q") ?: return@get
                val filter = call.request.queryParameters["filter"]?.let(::searchFilterFromName)
                if (filter == null) {
                    call.respondApi {
                        YouTube.searchSummary(query).getOrThrow().toDto()
                    }
                    return@get
                }

                call.respondApi {
                    YouTube.search(query, filter).getOrThrow().toDto()
                }
            }

            get("/explore") {
                call.respondApi {
                    YouTube.explore().getOrThrow().toDto()
                }
            }

            get("/browse") {
                val browseId = call.requiredQuery("browseId") ?: return@get
                call.respondApi {
                    YouTube.browse(
                        browseId = browseId,
                        params = call.request.queryParameters["params"]
                            ?.trim()
                            ?.takeIf { it.isNotBlank() },
                    ).getOrThrow().toDto()
                }
            }

            get("/library") {
                val filter = call.request.queryParameters["filter"]?.trim().orEmpty()
                call.respondApi {
                    loadLibraryItems(filter).toLibraryResponse(filter)
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
                    val page = YouTube.album(browseId).getOrThrow()
                    DetailResponseDto(
                        kind = "album",
                        item = page.album.toDto(),
                        tracks = page.songs.map(YTItem::toDto),
                    )
                }
            }

            get("/playlist/{playlistId}") {
                val playlistId = call.parameters["playlistId"]?.trim()?.removePrefix("VL").orEmpty()
                if (playlistId.isBlank()) {
                    call.respond(HttpStatusCode.BadRequest, ApiError("Missing playlist id"))
                    return@get
                }

                call.respondApi {
                    val page = YouTube.playlist(playlistId).getOrThrow()
                    DetailResponseDto(
                        kind = "playlist",
                        item = page.playlist.toDto(),
                        tracks = page.songs.map(YTItem::toDto),
                        continuation = page.songsContinuation ?: page.continuation,
                    )
                }
            }

            get("/next/{videoId}") {
                val videoId = call.parameters["videoId"]?.trim().orEmpty()
                if (videoId.isBlank()) {
                    call.respond(HttpStatusCode.BadRequest, ApiError("Missing video id"))
                    return@get
                }

                call.respondApi {
                    val next = YouTube.next(
                        WatchEndpoint(
                            videoId = videoId,
                            playlistId = call.request.queryParameters["playlistId"]?.trim()?.takeIf { it.isNotBlank() },
                            playlistSetVideoId = call.request.queryParameters["setVideoId"]?.trim()?.takeIf { it.isNotBlank() },
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

            get("/lyrics/{videoId}") {
                val videoId = call.parameters["videoId"]?.trim().orEmpty()
                if (videoId.isBlank()) {
                    call.respond(HttpStatusCode.BadRequest, ApiError("Missing video id"))
                    return@get
                }

                call.respondApi {
                    resolveLyrics(
                        videoId = videoId,
                        title = call.request.queryParameters["title"]?.trim().orEmpty(),
                        artist = call.request.queryParameters["artist"]?.trim().orEmpty(),
                        album = call.request.queryParameters["album"]?.trim()?.takeIf { it.isNotBlank() },
                        duration = call.request.queryParameters["duration"]?.toIntOrNull() ?: -1,
                    )
                }
            }

            get("/player/{videoId}") {
                val videoId = call.parameters["videoId"]?.trim().orEmpty()
                if (videoId.isBlank()) {
                    call.respond(HttpStatusCode.BadRequest, ApiError("Missing video id"))
                    return@get
                }

                call.respondApi {
                    val resolved = resolvePlayer(videoId)
                    val response = resolved.response

                    PlayerResponseDto(
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
                }
            }
        }

        serveWebPrototype()
    }
}

private suspend fun ApplicationCall.respondApi(block: suspend () -> Any) {
    try {
        respond(block())
    } catch (error: Throwable) {
        respond(
            HttpStatusCode.BadGateway,
            ApiError(error.message ?: error::class.simpleName ?: "Request failed"),
        )
    }
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
    cachedWebAccount = null
}

private fun clearWebAuthSession() {
    YouTube.authState = PlaybackAuthState.EMPTY
    YouTube.useLoginForBrowse = false
    cachedWebAccount = null
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
    val authState = YouTube.authState
    val loggedIn = authState.hasLoginCookie
    var accountError: String? = null

    if (!loggedIn) {
        cachedWebAccount = null
    } else if (refreshAccount || cachedWebAccount == null) {
        YouTube.accountInfo()
            .onSuccess { account ->
                cachedWebAccount = WebAccountDto(
                    name = account.name,
                    email = account.email,
                    channelHandle = account.channelHandle,
                    thumbnailUrl = account.thumbnailUrl,
                )
            }
            .onFailure { error ->
                accountError = error.message ?: error::class.simpleName
            }
    }

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

private fun String?.normalizedAuthValue(): String? =
    this?.trim()?.takeIf { it.isNotEmpty() && !it.equals("null", ignoreCase = true) }

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
        YouTube.lyrics(endpoint).getOrThrow()?.takeIf { it.isNotBlank() }
            ?: error("Lyrics unavailable")
    }.getOrNull()

    if (title.isNotBlank() && artist.isNotBlank()) {
        LrcLib.getLyrics(
            title = title,
            artist = artist,
            duration = duration,
            album = album,
        ).getOrNull()?.let { lyrics ->
            return lyrics.toLyricsResponse(source = "lrclib", synced = lyrics.hasLrcTimestamps())
        }

        KuGou.getLyrics(
            title = title,
            artist = artist,
            duration = duration,
        ).getOrNull()?.let { lyrics ->
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
