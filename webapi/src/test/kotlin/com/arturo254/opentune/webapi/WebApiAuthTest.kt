package com.arturo254.opentune.webapi

import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Covers the access gate and the pairing handshake.
 *
 * Every case here is a bug that actually shipped and had to be found by hand on real hardware. They
 * are cheap to re-break and expensive to notice, which is exactly what makes them worth pinning.
 *
 * Deliberately hermetic: the server is pointed at an auth file that does not exist, so it starts
 * signed out, never calls YouTube, and cannot touch the real saved session.
 */
class WebApiAuthTest {

    private companion object {
        const val TOKEN = "test-token-not-a-real-secret"

        init {
            val dir = Files.createTempDirectory("opentune-webapi-test")

            val tokenFile = dir.resolve("access-token")
            Files.writeString(tokenFile, TOKEN)
            System.setProperty("opentune.web.token.file", tokenFile.toString())

            System.setProperty("opentune.web.auth.file", dir.resolve("no-session.json").toString())

            // The server resolves its file paths once, on first load, and every test class shares a
            // JVM -- so a class that leaves this unset can be the one that pins the path to the real
            // ~/.config/opentune-web, and a later test would write the user's own pins.
            System.setProperty("opentune.web.speeddial.file", dir.resolve("speed-dial.json").toString())
        }
    }

    @BeforeTest
    @AfterTest
    fun resetSecurityState() {
        // The token and the failed-attempt limiter are process-global; a rotation or a rate-limit
        // test would otherwise leak into the next one. Reset on both sides so order never matters.
        resetAuthRateLimiterForTest()
        setAccessTokenForTest(TOKEN)
    }

    private fun withServer(block: suspend ApplicationTestBuilder.() -> Unit) = testApplication {
        application { module() }
        block()
    }

    // --- the gate -----------------------------------------------------------------------------

    @Test
    fun `api is refused without a token`() = withServer {
        assertEquals(HttpStatusCode.Unauthorized, client.get("/api/auth/status").status)
    }

    @Test
    fun `api is refused with the wrong token`() = withServer {
        val response = client.get("/api/auth/status") {
            header("X-OpenTune-Token", "wrong")
        }
        assertEquals(HttpStatusCode.Unauthorized, response.status)
    }

    @Test
    fun `api accepts the token as a header`() = withServer {
        val response = client.get("/api/auth/status") {
            header("X-OpenTune-Token", TOKEN)
        }
        assertEquals(HttpStatusCode.OK, response.status)
    }

    @Test
    fun `api accepts the token as a query parameter`() = withServer {
        // The startup link carries the token this way; the client then stores it and strips it.
        assertEquals(HttpStatusCode.OK, client.get("/api/auth/status?token=$TOKEN").status)
    }

    @Test
    fun `health needs no token`() = withServer {
        assertEquals(HttpStatusCode.OK, client.get("/api/health").status)
    }

    @Test
    fun `the app shell is not behind the token`() = withServer {
        // Regression: gating the shell broke reload. The client strips the token from the URL once
        // stored, so a refresh arrives without one -- and used to be met with a 401 page.
        assertNotEquals(HttpStatusCode.Unauthorized, client.get("/").status)
    }

    @Test
    fun `the audio proxy is behind the token`() = withServer {
        // The stream proxy fetches YouTube audio using the signed-in session and relays it. Left
        // open, anyone on the network could pull audio through the account; the <audio> element
        // passes the token as a query param, so both ways in must be gated.
        assertEquals(HttpStatusCode.Unauthorized, client.get("/api/stream/dQw4w9WgXcQ?itag=140").status)
        assertEquals(HttpStatusCode.Unauthorized, client.get("/api/stream/dQw4w9WgXcQ?itag=140&token=wrong").status)
    }

    // --- rate limiting --------------------------------------------------------------------------

    @Test
    fun `a flood of wrong tokens is blocked`() = withServer {
        // A unique caller address, so this test's failures land in their own bucket and do not spend
        // the allowance of the localhost bucket every other test shares.
        val ip = "203.0.113.7"
        repeat(15) {
            client.get("/api/auth/status") {
                header("X-OpenTune-Token", "wrong")
                header("CF-Connecting-IP", ip)
            }
        }

        val blocked = client.get("/api/auth/status") {
            header("X-OpenTune-Token", "wrong")
            header("CF-Connecting-IP", ip)
        }
        assertEquals(HttpStatusCode.TooManyRequests, blocked.status)

        // The block comes before the token check, so even the right token is refused while it holds --
        // otherwise a brute-force run that happens to include the real token would still get in.
        val evenWithTheRealToken = client.get("/api/auth/status") {
            header("X-OpenTune-Token", TOKEN)
            header("CF-Connecting-IP", ip)
        }
        assertEquals(HttpStatusCode.TooManyRequests, evenWithTheRealToken.status)
    }

    @Test
    fun `one caller's flood does not lock out another`() = withServer {
        val abuser = "203.0.113.8"
        repeat(20) {
            client.get("/api/auth/status") {
                header("X-OpenTune-Token", "wrong")
                header("CF-Connecting-IP", abuser)
            }
        }

        // A different address, holding the token, is untouched -- the whole point of keying the limit
        // on the caller rather than counting globally.
        val bystander = client.get("/api/auth/status") {
            header("X-OpenTune-Token", TOKEN)
            header("CF-Connecting-IP", "203.0.113.9")
        }
        assertEquals(HttpStatusCode.OK, bystander.status)
    }

    // --- token rotation -------------------------------------------------------------------------

    @Test
    fun `rotating the token retires the old one`() = withServer {
        val rotate = client.post("/api/auth/token/rotate") {
            header("X-OpenTune-Token", TOKEN)
        }
        assertEquals(HttpStatusCode.OK, rotate.status)

        val newToken = Regex("\"token\":\"([^\"]+)\"").find(rotate.bodyAsText())?.groupValues?.get(1)
        assertNotNull(newToken)
        assertNotEquals(TOKEN, newToken)

        // The leaked link is dead the instant rotation returns.
        assertEquals(
            HttpStatusCode.Unauthorized,
            client.get("/api/auth/status") { header("X-OpenTune-Token", TOKEN) }.status,
        )
        assertEquals(
            HttpStatusCode.OK,
            client.get("/api/auth/status") { header("X-OpenTune-Token", newToken) }.status,
        )
    }

    @Test
    fun `rotation cannot be triggered without the current token`() = withServer {
        assertEquals(HttpStatusCode.Unauthorized, client.post("/api/auth/token/rotate").status)
        // and the token is unchanged: the real one still works
        assertEquals(
            HttpStatusCode.OK,
            client.get("/api/auth/status") { header("X-OpenTune-Token", TOKEN) }.status,
        )
    }

    // --- pairing ------------------------------------------------------------------------------

    @Test
    fun `a pairing code cannot be minted without a token`() = withServer {
        // This is what stops someone else on the network from minting a code and redeeming it for
        // the YouTube session. The whole safety of the open /claim endpoint rests on it.
        assertEquals(HttpStatusCode.Unauthorized, client.post("/api/auth/pairing/start").status)
    }

    @Test
    fun `a pairing code is minted for a caller holding the token`() = withServer {
        val response = client.post("/api/auth/pairing/start") {
            header("X-OpenTune-Token", TOKEN)
        }

        assertEquals(HttpStatusCode.OK, response.status)
        val code = Regex("\"code\":\"([^\"]+)\"").find(response.bodyAsText())?.groupValues?.get(1)
        assertEquals(8, code?.length, "expected an 8 character pairing code, got: $code")
    }

    @Test
    fun `claim is reachable without a token`() = withServer {
        // The phone has no way to know the token, so the code is the credential here. It must get a
        // verdict on the code rather than be turned away at the gate.
        val response = client.post("/api/auth/pairing/claim") {
            contentType(ContentType.Application.Json)
            setBody("""{"code":"ZZZZZZZZ"}""")
        }

        assertNotEquals(HttpStatusCode.Unauthorized, response.status)
        assertEquals(HttpStatusCode.NotFound, response.status)
    }

    @Test
    fun `claim refuses to hand over a session when the server has none`() = withServer {
        val code = mintCode()

        val response = client.post("/api/auth/pairing/claim") {
            contentType(ContentType.Application.Json)
            setBody("""{"code":"$code"}""")
        }

        assertEquals(HttpStatusCode.Conflict, response.status)
        assertTrue(
            "cookie" !in response.bodyAsText(),
            "a signed-out server must not leak anything session-shaped",
        )
    }

    @Test
    fun `complete is reachable without a token but rejects a cookie with no SAPISID`() = withServer {
        val code = mintCode()

        val response = client.post("/api/auth/pairing/complete") {
            contentType(ContentType.Application.Json)
            setBody("""{"code":"$code","cookie":"NOT_A_REAL_COOKIE=1"}""")
        }

        assertNotEquals(HttpStatusCode.Unauthorized, response.status)
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `an unknown pairing code is refused`() = withServer {
        val response = client.post("/api/auth/pairing/complete") {
            contentType(ContentType.Application.Json)
            setBody("""{"code":"ZZZZZZZZ","cookie":"SAPISID=x"}""")
        }

        assertEquals(HttpStatusCode.NotFound, response.status)
    }

    private suspend fun ApplicationTestBuilder.mintCode(): String {
        val body = client.post("/api/auth/pairing/start") {
            header("X-OpenTune-Token", TOKEN)
        }.bodyAsText()

        return Regex("\"code\":\"([^\"]+)\"").find(body)?.groupValues?.get(1)
            ?: error("no pairing code in: $body")
    }
}
