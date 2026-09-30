// A stand-in for Gausium's open API, for end-to-end checks on a laptop.
// Accepts one set of keys (client_secret "good-secret"), lists three
// scrubbers, answers live status, and serves 30 days of past cleaning jobs.
//
//   node scripts/dev-fake-gausium.mjs            # listens on 3297
//   BOTLIEN_GAUSIUM_BASE=http://127.0.0.1:3297 node src/index.mjs
//
// Never point a real account at it: every figure it returns is made up.
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 3297);
const ROBOTS = ["GS-101", "GS-102", "GS-103"];
let polls = 0;

createServer((req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url.endsWith("/oauth/token")) {
      let secret = null;
      try {
        secret = JSON.parse(body || "{}").client_secret;
      } catch {
        /* bad JSON is rejected below */
      }
      return secret === "good-secret" ? send(200, { access_token: "tok", expires_in: 3600 }) : send(401, {});
    }
    if (req.url.startsWith("/v1alpha1/robots?")) {
      return send(200, { robots: ROBOTS.map((sn) => ({ serialNumber: sn, displayName: "Scrubber " + sn.slice(3), modelTypeCode: "S50" })), total: ROBOTS.length });
    }
    const history = req.url.match(/robots\/([^/]+)\/taskReports\?/);
    if (history) {
      const page = Number(new URL(req.url, "http://x").searchParams.get("page") ?? 1);
      const jobs = [];
      for (let d = 1; d <= 30; d++) {
        const day = new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
        jobs.push({ id: `${history[1]}-${d}`, startTime: `${day}T16:00:00Z`, durationSeconds: 2 * 3600, actualCleaningAreaSquareMeter: 900 });
      }
      return send(200, { robotTaskReports: jobs.slice((page - 1) * 100, page * 100), total: jobs.length });
    }
    const status = req.url.match(/robots\/([^/]+)\/status/);
    if (status) {
      polls += 1;
      return send(200, {
        online: true,
        battery: { powerPercentage: 70, charging: false },
        taskState: "RUNNING",
        currentTask: { taskInstanceId: `task-${status[1]}-${Math.floor(polls / 6)}` },
        navStatus: status[1] === "GS-102" && polls % 5 === 0 ? "STUCK" : "NORMAL",
        speedKilometerPerHour: 2,
        localizationInfo: { worldX: 12, worldY: 6 },
      });
    }
    send(404, {});
  });
}).listen(PORT, "127.0.0.1", () => console.log(`fake gausium on ${PORT}`));
