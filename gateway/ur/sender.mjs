// Ships events to Botlien's POST /api/v1/events in batches, and holds them
// while the internet is down. A shop floor's uplink drops; the arms keep
// running. Everything is kept in order and sent when the link returns, up to
// a cap, past which the oldest go first (and the log says how many).
//
// A 400 or a per-event rejection is Botlien saying an event is wrong, and
// resending it would fail forever, so those are logged and dropped. A 401 is
// a bad key: nothing is dropped, sending pauses and the log says so, because
// every event would be refused until someone fixes the key. Anything else
// (5xx, timeouts, no network) is retried with backoff.

export const BATCH = 1000; // the server's limit per request

export function createSender({ url, key, post = defaultPost, log = console.log, maxQueue = 200_000, flushMs = 5_000, retryMs = [2_000, 5_000, 15_000, 60_000] }) {
  if (!key || !/^blk_/.test(key)) throw new Error("BOTLIEN_API_KEY must be set to a blk_ key from Settings > Data sources.");
  const endpoint = new URL("/api/v1/events", url).toString();
  let queue = [];
  let dropped = 0;
  let busy = false;
  let failures = 0;
  let pausedForKey = false;
  let timer = null;
  const stats = { sent: 0, rejected: 0, dropped: 0 };

  function enqueue(events) {
    if (!events.length) return;
    queue.push(...events);
    if (queue.length > maxQueue) {
      const over = queue.length - maxQueue;
      queue = queue.slice(over);
      dropped += over;
      stats.dropped += over;
    }
    if (queue.length >= BATCH) flush();
  }

  async function flush() {
    if (busy || !queue.length || pausedForKey) return;
    busy = true;
    const batch = queue.slice(0, BATCH);
    try {
      const res = await post(endpoint, key, { events: batch });
      if (res.status === 401) {
        pausedForKey = true;
        log(`Botlien refused the API key (401). Sending is paused with ${queue.length} events held. Make a new key under Settings > Data sources and restart.`);
      } else if (res.status >= 200 && res.status < 300) {
        queue = queue.slice(batch.length);
        if (failures) log(`reached Botlien again; sending the ${batch.length + queue.length} events held`);
        failures = 0;
        const rejected = res.body?.rejected ?? [];
        stats.sent += batch.length - rejected.length;
        stats.rejected += rejected.length;
        for (const r of rejected.slice(0, 5)) log(`event rejected: ${JSON.stringify(batch[r.index]?.robot_id)} ${r.problems.join("; ")}`);
      } else if (res.status === 400) {
        queue = queue.slice(batch.length);
        stats.rejected += batch.length;
        log(`Botlien refused a batch of ${batch.length}: ${res.body?.error ?? "bad request"}`);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
      if (dropped) {
        log(`the queue was full while offline, so the oldest ${dropped} events were dropped`);
        dropped = 0;
      }
    } catch (err) {
      failures += 1;
      const wait = retryMs[Math.min(failures - 1, retryMs.length - 1)];
      log(`could not reach Botlien (${err.message ?? err}); ${queue.length} events held, retrying in ${wait / 1000} s`);
      busy = false;
      clearTimeout(timer);
      timer = setTimeout(flush, wait);
      return;
    }
    busy = false;
    // Catching up after an outage: keep going until the backlog is sent.
    if (queue.length) return flush();
  }

  const interval = setInterval(flush, flushMs);
  return {
    enqueue,
    flush,
    stats,
    get queued() {
      return queue.length;
    },
    stop() {
      clearInterval(interval);
      clearTimeout(timer);
    },
  };
}

async function defaultPost(endpoint, key, body) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: json };
}
