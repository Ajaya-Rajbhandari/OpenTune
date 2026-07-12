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
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
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
        }
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
