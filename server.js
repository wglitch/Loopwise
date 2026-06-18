const http = require("http");
const fs = require("fs");
const path = require("path");
const webpush = require("web-push");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const DATA_DIR = path.join(__dirname, "data");
const STORE_PATH = path.join(DATA_DIR, "push-store.json");
const VAPID_PATH = path.join(DATA_DIR, "vapid.json");
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "mailto:loopwise@example.com";
const STATIC_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

ensureDataDir();
const vapidKeys = loadVapidKeys();
webpush.setVapidDetails(CONTACT_EMAIL, vapidKeys.publicKey, vapidKeys.privateKey);

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/vapid-public-key") {
      sendJson(res, 200, { publicKey: vapidKeys.publicKey });
      return;
    }

    if (req.method === "POST" && url.pathname === "/subscribe") {
      const body = await readJson(req);
      upsertSubscription(body.subscription, body.schedule);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/schedule") {
      const body = await readJson(req);
      upsertSubscription(body.subscription, body.schedule);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/push/test") {
      const body = await readJson(req);
      const result = await sendToAll(buildReminderPayload(body));
      sendJson(res, 200, { ok: true, sent: result.sent, failed: result.failed });
      return;
    }

    if (req.method === "GET") {
      serveStatic(url.pathname, res);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Loopwise server lyssnar på http://${HOST}:${PORT}`);
});

setInterval(runSchedule, 20 * 1000);

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadVapidKeys() {
  if (fs.existsSync(VAPID_PATH)) {
    return JSON.parse(fs.readFileSync(VAPID_PATH, "utf8"));
  }
  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_PATH, JSON.stringify(keys, null, 2));
  return keys;
}

function loadStore() {
  if (!fs.existsSync(STORE_PATH)) return { subscriptions: [] };
  return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
}

function saveStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function upsertSubscription(subscription, schedule) {
  if (!subscription?.endpoint) {
    throw new Error("Missing subscription endpoint.");
  }
  const store = loadStore();
  const index = store.subscriptions.findIndex((item) => item.subscription.endpoint === subscription.endpoint);
  const record = {
    subscription,
    schedule: schedule || { active: false },
    lastReminderKey: "",
    lastReflectionKey: "",
    updatedAt: new Date().toISOString()
  };

  if (index >= 0) {
    record.lastReminderKey = store.subscriptions[index].lastReminderKey || "";
    record.lastReflectionKey = store.subscriptions[index].lastReflectionKey || "";
    store.subscriptions[index] = record;
  } else {
    store.subscriptions.push(record);
  }

  saveStore(store);
}

async function runSchedule() {
  const store = loadStore();
  if (!store.subscriptions.length) return;

  const now = new Date();
  const minute = now.getMinutes();
  const hourKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`;
  let changed = false;

  for (const record of store.subscriptions) {
    if (!record.schedule?.active) continue;

    if (minute === Number(record.schedule.reminderMinute) && record.lastReminderKey !== hourKey) {
      await sendPush(record, buildReminderPayload(record.schedule));
      record.lastReminderKey = hourKey;
      changed = true;
    }

    if (minute === Number(record.schedule.reflectionMinute) && record.lastReflectionKey !== hourKey) {
      await sendPush(record, buildReflectionPayload());
      record.lastReflectionKey = hourKey;
      changed = true;
    }
  }

  if (changed) saveStore(store);
}

async function sendToAll(payload) {
  const store = loadStore();
  let sent = 0;
  let failed = 0;

  for (const record of store.subscriptions) {
    try {
      await sendPush(record, payload);
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error("Push failed", error.statusCode || error.message);
    }
  }

  return { sent, failed };
}

function sendPush(record, payload) {
  return webpush.sendNotification(record.subscription, JSON.stringify(payload));
}

function buildReminderPayload(schedule) {
  return {
    title: "Dagens fokus",
    body: `${schedule.focus || "Kom ihåg dagens fokus."}\n\nSenaste justering: ${schedule.lastAdjustment || "Ingen justering än."}`,
    tag: "loopwise-reminder",
    data: { type: "reminder" }
  };
}

function buildReflectionPayload() {
  return {
    title: "Snabb reflektion",
    body: "Vad fungerade bra? Vad kan du göra annorlunda nästa gång?",
    tag: "loopwise-reflection",
    data: { type: "reflection" }
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large."));
      }
    });
    req.on("end", () => resolve(body ? JSON.parse(body) : {}));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function serveStatic(requestPath, res) {
  const cleanPath = decodeURIComponent(requestPath.split("?")[0]);
  const relativePath = cleanPath === "/" ? "index.html" : cleanPath.replace(/^\/+/, "");
  const filePath = path.resolve(__dirname, relativePath);

  if (!filePath.startsWith(__dirname)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      if (path.extname(filePath)) {
        sendJson(res, 404, { error: "Not found" });
        return;
      }
      fs.readFile(path.join(__dirname, "index.html"), (fallbackError, fallbackData) => {
        if (fallbackError) {
          sendJson(res, 404, { error: "Not found" });
          return;
        }
        res.writeHead(200, { "Content-Type": STATIC_TYPES[".html"] });
        res.end(fallbackData);
      });
      return;
    }

    const contentType = STATIC_TYPES[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
