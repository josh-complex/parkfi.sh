package sh.parkfi.riderecorder

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/**
 * Plain-JVM tests for the durable event queue — the file format is hand-framed
 * so nothing here needs `org.json` or an Android runtime.
 */
class NativeEventQueueTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private fun queue(): Pair<NativeEventQueue, File> {
        val f = File(File(tmp.root, "ride-recorder"), "events.jsonl")
        return NativeEventQueue(f) to f
    }

    @Test
    fun enqueueDrainRoundTrip() {
        val (q, _) = queue()
        q.enqueue(NativeEventQueue.KIND_TRANSITION, 1_700_000_000_000L, """{"regionId":"12","transition":"enter"}""")
        q.enqueue(NativeEventQueue.KIND_RIDE, 1_700_000_060_000L, """{"metrics":{"maxG":3.1},"samples":[]}""")

        val events = q.drain()
        assertEquals(2, events.size)
        assertEquals(NativeEventQueue.KIND_TRANSITION, events[0].kind)
        assertEquals(1_700_000_000_000L, events[0].at)
        assertEquals("""{"regionId":"12","transition":"enter"}""", events[0].payloadJson)
        assertEquals(NativeEventQueue.KIND_RIDE, events[1].kind)
        assertEquals("""{"metrics":{"maxG":3.1},"samples":[]}""", events[1].payloadJson)
    }

    @Test
    fun drainTruncates() {
        val (q, f) = queue()
        q.enqueue(NativeEventQueue.KIND_TRANSITION, 1L, """{"a":1}""")
        assertEquals(1, q.size())
        q.drain()
        assertEquals(0, q.size())
        assertTrue(!f.exists() || f.length() == 0L)
        assertTrue(q.drain().isEmpty())
    }

    @Test
    fun corruptLinesAreSkipped() {
        val (q, f) = queue()
        q.enqueue(NativeEventQueue.KIND_RIDE, 5L, """{"ok":true}""")
        // Simulate a torn write / garbage between two good lines.
        f.appendText("{\"kind\":\"ride\",\"at\":notanumber,\"payload\":{}}\n")
        f.appendText("garbage\n")
        f.appendText("\n")
        q.enqueue(NativeEventQueue.KIND_TRANSITION, 6L, """{"ok":2}""")

        val events = q.drain()
        assertEquals(listOf(5L, 6L), events.map { it.at })
    }

    @Test
    fun lineCapEvictsOldest() {
        val (q, _) = queue()
        for (i in 0 until NativeEventQueue.MAX_LINES + 25) {
            q.enqueue(NativeEventQueue.KIND_TRANSITION, i.toLong(), """{"i":$i}""")
        }
        val events = q.drain()
        assertEquals(NativeEventQueue.MAX_LINES, events.size)
        assertEquals(25L, events.first().at)
        assertEquals((NativeEventQueue.MAX_LINES + 24).toLong(), events.last().at)
    }

    @Test
    fun byteCapEvictsOldest() {
        val (q, _) = queue()
        // ~1 MB payloads: six of them exceed the 5 MB cap, so the first goes.
        val big = "x".repeat(1_000_000)
        for (i in 0 until 6) {
            q.enqueue(NativeEventQueue.KIND_RIDE, i.toLong(), """{"blob":"$big"}""")
        }
        val events = q.drain()
        assertEquals(5, events.size)
        assertEquals(1L, events.first().at)
    }

    @Test
    fun rejectsBadKindAndEmptyPayload() {
        val (q, _) = queue()
        q.enqueue("Not-A-Kind", 1L, """{"a":1}""")
        q.enqueue(NativeEventQueue.KIND_RIDE, 2L, "")
        assertEquals(0, q.size())
    }

    @Test
    fun stripsRawNewlinesFromPayload() {
        val (q, _) = queue()
        q.enqueue(NativeEventQueue.KIND_RIDE, 1L, "{\"a\":\n1}")
        val events = q.drain()
        assertEquals(1, events.size)
        assertEquals("""{"a":1}""", events[0].payloadJson)
    }

    @Test
    fun parseIsStrictInverseOfToLine() {
        val e = NativeEventQueue.Event("ride", 123L, """{"nested":{"x":[1,2,{"y":"}"}]}}""")
        assertEquals(e, NativeEventQueue.Event.parse(e.toLine()))
        assertNull(NativeEventQueue.Event.parse("""{"kind":"ride","at":1,"payload":[]}"""))
        assertNull(NativeEventQueue.Event.parse("""{"kind":"ride","at":1}"""))
        assertNull(NativeEventQueue.Event.parse("""{"kind":"ride","at":-,"payload":{}}"""))
        assertNull(NativeEventQueue.Event.parse(""))
    }
}
