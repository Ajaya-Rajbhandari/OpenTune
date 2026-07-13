package com.arturo254.opentune.webapi

import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
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
 * Covers the pinned Speed dial list.
 *
 * The pins are the one piece of the user's own arrangement the web stack stores: everything else it
 * shows can be fetched again from YouTube, and a lost pin cannot. So the rules Android enforces --
 * pinned once, at most twenty-four, kept in the order they were pinned -- are enforced on the way in
 * and again on the way out, and both directions are pinned here.
 */
class WebApiSpeedDialTest {

    private companion object {
        const val TOKEN = "test-token-not-a-real-secret"

        lateinit var pinsFile: Path

        init {
            val dir = Files.createTempDirectory("opentune-webapi-speed-dial-test")

            val tokenFile = dir.resolve("access-token")
            Files.writeString(tokenFile, TOKEN)
            System.setProperty("opentune.web.token.file", tokenFile.toString())
            System.setProperty("opentune.web.auth.file", dir.resolve("no-session.json").toString())

            pinsFile = dir.resolve("speed-dial.json")
            System.setProperty("opentune.web.speeddial.file", pinsFile.toString())
        }
    }

    @BeforeTest
    fun resetLimiter() {
        // Shared with the other test classes in this JVM; start each test with a clean allowance.
        resetAuthRateLimiterForTest()
    }

    @AfterTest
    fun clearPins() {
        Files.deleteIfExists(pinsFile)
    }

    private fun withServer(block: suspend ApplicationTestBuilder.() -> Unit) = testApplication {
        application { module() }
        block()
    }

    private suspend fun ApplicationTestBuilder.readPins(): String =
        client.get("/api/speed-dial") { header("X-OpenTune-Token", TOKEN) }.bodyAsText()

    private suspend fun ApplicationTestBuilder.writePins(body: String) =
        client.put("/api/speed-dial") {
            header("X-OpenTune-Token", TOKEN)
            contentType(ContentType.Application.Json)
            setBody(body)
        }

    private fun pin(id: String, title: String = "Song $id") =
        """{"id":"$id","title":"$title","artist":"1974 AD","thumbnail":"https://example.test/$id.jpg","duration":214}"""

    @Test
    fun `pins are refused without a token`() = withServer {
        // The pins are the user's own, on a server that answers to the whole network.
        assertEquals(HttpStatusCode.Unauthorized, client.get("/api/speed-dial").status)
        assertEquals(
            HttpStatusCode.Unauthorized,
            client.put("/api/speed-dial") {
                contentType(ContentType.Application.Json)
                setBody("""{"items":[${pin("hijack")}]}""")
            }.status,
        )
    }

    @Test
    fun `a fresh server has no pins`() = withServer {
        // Not an error and not a 404: an empty Speed dial is the normal state on day one.
        assertEquals("""{"items":[]}""", readPins())
    }

    @Test
    fun `pins survive the request that set them`() = withServer {
        assertEquals(HttpStatusCode.OK, writePins("""{"items":[${pin("aaa")},${pin("bbb")}]}""").status)

        val stored = readPins()
        assertTrue(stored.contains(""""id":"aaa""""), stored)
        assertTrue(stored.contains(""""artist":"1974 AD""""), stored)
        assertTrue(stored.indexOf(""""aaa"""") < stored.indexOf(""""bbb""""), "pins must keep the order they were pinned in: $stored")
    }

    @Test
    fun `a pin is stored once`() = withServer {
        writePins("""{"items":[${pin("aaa")},${pin("bbb")},${pin("aaa")}]}""")

        val stored = readPins()
        assertEquals(2, Regex(""""id":"""").findAll(stored).count(), stored)
        assertTrue(stored.indexOf(""""aaa"""") < stored.indexOf(""""bbb""""), "the first pin of a song is the one that counts: $stored")
    }

    @Test
    fun `the list stops at twenty-four`() = withServer {
        val items = (1..30).joinToString(",") { pin("song$it") }
        writePins("""{"items":[$items]}""")

        val stored = readPins()
        assertEquals(24, Regex(""""id":"""").findAll(stored).count(), stored)
        assertTrue(stored.contains(""""id":"song24""""), stored)
        assertFalse(stored.contains(""""id":"song25""""), stored)
    }

    @Test
    fun `a pin with nothing to show is dropped`() = withServer {
        // A tile needs an id to play and a title to read. Anything else would render as a blank
        // square that does nothing when tapped.
        writePins("""{"items":[${pin("aaa")},{"id":"","title":"No id"},{"id":"ccc","title":""}]}""")

        val stored = readPins()
        assertEquals("""{"items":[{"id":"aaa","title":"Song aaa","artist":"1974 AD","thumbnail":"https://example.test/aaa.jpg","duration":214}]}""", stored)
    }

    @Test
    fun `writing the list is how a song is unpinned`() = withServer {
        writePins("""{"items":[${pin("aaa")},${pin("bbb")}]}""")
        writePins("""{"items":[${pin("bbb")}]}""")

        val stored = readPins()
        assertFalse(stored.contains(""""id":"aaa""""), "an unpinned song must not come back: $stored")
        assertTrue(stored.contains(""""id":"bbb""""), stored)
    }

    @Test
    fun `the last write is what the next reader sees`() = withServer {
        // Two browsers, one server: the pins live on disk, not in the memory of whichever page
        // happened to write them, so the phone sees what the laptop pinned.
        writePins("""{"items":[${pin("aaa")}]}""")
        assertTrue(Files.isRegularFile(pinsFile))

        writePins("""{"items":[]}""")
        assertEquals("""{"items":[]}""", readPins())
    }
}
