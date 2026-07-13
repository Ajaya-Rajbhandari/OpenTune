package com.arturo254.opentune.webapi

import com.arturo254.opentune.innertube.PlaybackAuthState
import com.arturo254.opentune.innertube.YouTube
import com.arturo254.opentune.innertube.models.AccountInfo
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Covers what happens to a stored login when YouTube does not answer cleanly.
 *
 * This is the code that silently deleted a working session: it treated any unrecognised failure as
 * proof the credentials had been rejected, wiped them from disk, retried anonymously, returned 200,
 * and logged nothing. The login simply vanished, and the phone that later tried to pair was told the
 * server had nothing to send.
 *
 * The distinction it has to get right is narrow and easy to lose again in a refactor: a 401 means
 * the cookie is dead, and anything else means we failed to understand the answer -- which is not the
 * same thing, and must never cost the user their session.
 */
class WebApiSessionTest {

    private companion object {
        const val TOKEN = "test-token-not-a-real-secret"

        /** A cookie that passes the SAPISID check, so the server treats it as a real login. */
        const val COOKIE = "SAPISID=fake-sapisid-value; __Secure-3PAPISID=fake"

        val ACCOUNT = AccountInfo(
            name = "Test Account",
            email = "test@example.com",
            channelHandle = "@test",
            thumbnailUrl = null,
        )

        lateinit var sessionFile: Path

        init {
            val dir = Files.createTempDirectory("opentune-webapi-session-test")

            val tokenFile = dir.resolve("access-token")
            Files.writeString(tokenFile, TOKEN)
            System.setProperty("opentune.web.token.file", tokenFile.toString())

            sessionFile = dir.resolve("auth-session.json")
            System.setProperty("opentune.web.auth.file", sessionFile.toString())

            // See WebApiAuthTest: paths resolve once per JVM, so every test class must claim this one
            // or the real ~/.config/opentune-web/speed-dial.json is what the suite ends up writing.
            System.setProperty("opentune.web.speeddial.file", dir.resolve("speed-dial.json").toString())
        }
    }

    private val realAccountInfoSource = accountInfoSource

    @BeforeTest
    fun signIn() {
        // The failed-attempt limiter is shared across test classes in this JVM; clear it so a flood
        // test elsewhere cannot leave the localhost bucket blocked when these tests run.
        resetAuthRateLimiterForTest()
        // A saved session on disk, exactly as a previous login would have left it.
        Files.writeString(sessionFile, """{"cookie":"$COOKIE"}""")
        YouTube.authState = PlaybackAuthState.EMPTY
        YouTube.useLoginForBrowse = false
    }

    @AfterTest
    fun reset() {
        accountInfoSource = realAccountInfoSource
        YouTube.authState = PlaybackAuthState.EMPTY
        YouTube.useLoginForBrowse = false
        Files.deleteIfExists(sessionFile)
    }

    @Test
    fun `a transient failure does not destroy the saved login`() = withServer(
        // What accountInfo() actually throws when YouTube's reply does not parse into an account
        // block -- which happens for reasons that have nothing to do with a dead cookie.
        accountInfo = { Result.failure(IllegalStateException("Failed to get account info - user may not be logged in")) },
    ) {
        val status = authStatus()

        assertTrue(
            status.contains("\"loggedIn\":true"),
            "a session we merely failed to read must stay signed in, got: $status",
        )
        assertTrue(
            Files.exists(sessionFile),
            "the saved session must survive a failure we do not understand",
        )
        assertTrue(YouTube.authState.hasLoginCookie, "the cookie must still be in play")
    }

    @Test
    fun `a rejected session is dropped`() = withServer(
        accountInfo = { Result.failure(unauthorized()) },
    ) {
        val status = authStatus()

        assertTrue(
            status.contains("\"loggedIn\":false"),
            "a 401 means the cookie is dead and must sign us out, got: $status",
        )
        assertFalse(
            Files.exists(sessionFile),
            "a session YouTube has actually rejected must not be left on disk",
        )
    }

    @Test
    fun `a healthy session reports the account`() = withServer(
        accountInfo = { Result.success(ACCOUNT) },
    ) {
        val status = authStatus()

        assertTrue(status.contains("\"loggedIn\":true"), status)
        assertTrue(status.contains("Test Account"), "the account should be exposed, got: $status")
        assertTrue(Files.exists(sessionFile), "a working session must be kept")
    }

    private fun withServer(
        accountInfo: suspend () -> Result<AccountInfo>,
        block: suspend ApplicationTestBuilder.() -> Unit,
    ) = testApplication {
        accountInfoSource = accountInfo
        application { module() }
        block()
    }

    private suspend fun ApplicationTestBuilder.authStatus(): String {
        val response = client.get("/api/auth/status") { header("X-OpenTune-Token", TOKEN) }
        assertEquals(HttpStatusCode.OK, response.status)
        return response.bodyAsText()
    }

    /** A genuine ClientRequestException, since that is what the "is this session dead" check inspects. */
    private suspend fun unauthorized(): Throwable {
        val client = HttpClient(MockEngine { respond("", HttpStatusCode.Unauthorized) }) {
            expectSuccess = true
        }
        return runCatching { client.get("https://youtube.invalid/account") }
            .exceptionOrNull()
            ?: error("expected the mock 401 to throw")
    }
}
