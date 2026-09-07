package sh.parkfi.riderecorder

import android.content.Context
import java.io.File

/**
 * Durable on-device event queue (park-tracking fixes 2, Workstream A).
 *
 * Play Services geofence transitions and ride detections can land in a process
 * the OS revived with **no Capacitor bridge** — the plugin's static callbacks
 * are wired in `Plugin.load()`, which needs `MainActivity`, so in that process
 * they are null and `?.invoke` dropped every event on the floor (R1). Every
 * event is now appended here first, at receipt, with the time it actually
 * happened (R6); the bridge drains the file on `load()`, on resume, and on the
 * JS `drainPending()` call, replaying each line to the listeners with
 * retain-until-consumed semantics.
 *
 * Format: one JSON object per line, `{"kind":"<kind>","at":<epochMs>,"payload":{…}}`,
 * written by [Event.toLine] and read back by [Event.parse]. The envelope is
 * produced and parsed by hand (a fixed prefix, not a JSON library) so the queue
 * has no `org.json` dependency and is unit-testable on a plain JVM; the payload
 * is opaque single-line JSON produced by the caller. A corrupt line fails the
 * parse and is skipped, never thrown.
 *
 * Bounded: at most [MAX_LINES] events / [MAX_BYTES] on disk, oldest evicted
 * first (a ride payload with samples is ~20–40 KB). SharedPreferences was
 * rejected for the same reason — it's a single XML blob rewritten per put.
 * All file access serializes on one process-wide lock, since a receiver, the
 * recorder's sensor thread, and the plugin's main thread can all touch it.
 */
class NativeEventQueue(private val file: File) {

    /** One queued event. `payloadJson` is a single-line JSON object. */
    data class Event(val kind: String, val at: Long, val payloadJson: String) {
        fun toLine(): String = "$P_KIND$kind$P_AT$at$P_PAYLOAD$payloadJson}"

        companion object {
            private const val P_KIND = "{\"kind\":\""
            private const val P_AT = "\",\"at\":"
            private const val P_PAYLOAD = ",\"payload\":"

            /** Strict inverse of [toLine]; null for anything malformed. */
            fun parse(line: String): Event? {
                if (!line.startsWith(P_KIND) || !line.endsWith("}")) return null
                val kindEnd = line.indexOf('"', P_KIND.length)
                if (kindEnd < 0) return null
                val kind = line.substring(P_KIND.length, kindEnd)
                if (!KIND_RE.matches(kind)) return null
                if (!line.startsWith(P_AT, kindEnd)) return null
                val atStart = kindEnd + P_AT.length
                val atEnd = line.indexOf(',', atStart)
                if (atEnd < 0) return null
                val at = line.substring(atStart, atEnd).toLongOrNull() ?: return null
                if (!line.startsWith(P_PAYLOAD, atEnd)) return null
                val payload = line.substring(atEnd + P_PAYLOAD.length, line.length - 1)
                if (payload.isEmpty() || payload.first() != '{' || payload.last() != '}') return null
                return Event(kind, at, payload)
            }
        }
    }

    /**
     * Append one event. Never throws (a receiver must not crash on a full disk);
     * on failure the event is simply lost, which is no worse than before.
     * `payloadJson` must be a single-line JSON object — raw newlines are
     * stripped defensively, since a line break would corrupt the file framing.
     */
    fun enqueue(kind: String, at: Long, payloadJson: String) {
        if (!KIND_RE.matches(kind)) return
        val payload = payloadJson.replace("\n", "").replace("\r", "")
        if (payload.isEmpty()) return
        val line = Event(kind, at, payload).toLine()
        synchronized(LOCK) {
            try {
                val lines = readLinesUnlocked().toMutableList()
                lines.add(line)
                evictUnlocked(lines)
                writeLinesUnlocked(lines)
            } catch (_: Exception) {
                // Disk full / permission hiccup — drop this event, keep running.
            }
        }
    }

    /** Read every parseable event (oldest first), truncate the file, return them. */
    fun drain(): List<Event> = synchronized(LOCK) {
        try {
            val events = readLinesUnlocked().mapNotNull { Event.parse(it) }
            if (file.exists()) file.delete()
            events
        } catch (_: Exception) {
            emptyList()
        }
    }

    /** Number of lines currently queued (parseable or not) — for tests/diagnostics. */
    fun size(): Int = synchronized(LOCK) {
        try {
            readLinesUnlocked().size
        } catch (_: Exception) {
            0
        }
    }

    private fun readLinesUnlocked(): List<String> {
        if (!file.exists()) return emptyList()
        return file.readLines().filter { it.isNotEmpty() }
    }

    /** Oldest-first eviction to the line and byte caps. */
    private fun evictUnlocked(lines: MutableList<String>) {
        while (lines.size > MAX_LINES) lines.removeAt(0)
        var bytes = lines.sumOf { it.length.toLong() + 1 }
        while (lines.size > 1 && bytes > MAX_BYTES) {
            bytes -= lines.first().length + 1
            lines.removeAt(0)
        }
    }

    /** Atomic rewrite: temp file + rename, so a crash mid-write can't leave a
     *  half-line that would corrupt every later parse. */
    private fun writeLinesUnlocked(lines: List<String>) {
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(if (lines.isEmpty()) "" else lines.joinToString("\n", postfix = "\n"))
        if (!tmp.renameTo(file)) {
            // Some filesystems refuse rename-over-existing; fall back to replace.
            file.delete()
            tmp.renameTo(file)
        }
    }

    companion object {
        const val KIND_TRANSITION = "transition"
        const val KIND_RIDE = "ride"
        /** Reserved for the native presence beacon (Workstream B). */
        const val KIND_PING = "ping"

        const val MAX_LINES = 200
        const val MAX_BYTES = 5L * 1024 * 1024

        private val KIND_RE = Regex("[a-z]+")
        private val LOCK = Any()

        private const val DIR = "ride-recorder"
        private const val FILE = "events.jsonl"

        /** The app's queue: `<filesDir>/ride-recorder/events.jsonl`. */
        fun forContext(context: Context): NativeEventQueue =
            NativeEventQueue(File(File(context.filesDir, DIR), FILE))
    }
}
