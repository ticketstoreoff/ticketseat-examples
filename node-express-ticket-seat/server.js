import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import express from "express";

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "public");
const apiBaseUrl = (
  process.env.TICKET_SEAT_API_BASE_URL ||
  "https://perceptive-heart-production.up.railway.app/api/v1"
).replace(/\/$/, "");
const partnerToken = process.env.TICKET_SEAT_PARTNER_TOKEN || "";
const webhookSecret = process.env.TICKET_SEAT_WEBHOOK_SECRET || "";
const webhookEvents = [];

function partnerHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${partnerToken}`,
    Accept: "application/json",
    ...extra,
  };
}

async function ticketSeatRequest(method, apiPath, body) {
  if (!partnerToken) {
    const error = new Error("TICKET_SEAT_PARTNER_TOKEN manquant dans .env");
    error.status = 500;
    throw error;
  }
  const response = await fetch(`${apiBaseUrl}${apiPath}`, {
    method,
    headers: partnerHeaders(body ? { "Content-Type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(async () => ({ raw: await response.text() }));
  if (!response.ok) {
    const error = new Error(payload.error || `Ticket Seat HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function normalizeSelection(selection = []) {
  return selection.flatMap((item) => {
    const id = item.id || item.seatId;
    if (!id) return [];
    return [{
      type: item.type === "ZONE" ? "ZONE" : "SEAT",
      id: String(id),
      label: item.label || item.seatLabel || String(id),
      price: Number(item.price || 0),
      currency: item.currency || "XOF",
    }];
  });
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

app.post(
  "/webhooks/ticket-seat",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const rawBody = req.body;
    const timestamp = req.header("x-ticket-store-timestamp") || "";
    const signature = req.header("x-ticket-store-signature") || "";
    if (webhookSecret) {
      const expected = crypto
        .createHmac("sha256", webhookSecret)
        .update(Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]))
        .digest("hex");
      const valid =
        signature.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      if (!valid) return res.status(401).json({ error: "Signature invalide" });
    }
    const payload = JSON.parse(rawBody.toString("utf8"));
    webhookEvents.unshift({
      receivedAt: new Date().toISOString(),
      event: req.header("x-ticket-store-event") || payload.event,
      deliveryId: req.header("x-ticket-store-delivery-id") || payload.deliveryId,
      payload,
    });
    webhookEvents.splice(50);
    return res.json({ received: true });
  },
);

app.use(express.json());
app.use(express.static(publicDir));

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/api/events", asyncRoute(async (_req, res) => {
  res.json(await ticketSeatRequest("GET", "/partner/events"));
}));
app.get("/api/events/:eventId/showtimes", asyncRoute(async (req, res) => {
  res.json(await ticketSeatRequest("GET", `/partner/events/${req.params.eventId}/showtimes`));
}));
app.get("/api/events/:eventId/embed", asyncRoute(async (req, res) => {
  res.json(await ticketSeatRequest("GET", `/partner/events/${req.params.eventId}/embed`));
}));
app.get("/api/showtimes/:showtimeId/embed", asyncRoute(async (req, res) => {
  res.json(await ticketSeatRequest("GET", `/partner/showtimes/${req.params.showtimeId}/embed`));
}));
app.post("/api/holds", asyncRoute(async (req, res) => {
  const selection = normalizeSelection(req.body.selection);
  const payload = {
    layoutId: req.body.layoutId,
    seatIds: selection.map((item) => item.id),
    durationMinutes: Number(req.body.durationMinutes || 5),
    ...(req.body.showtimeId
      ? { showtimeId: req.body.showtimeId }
      : { eventId: req.body.eventId }),
  };
  res.status(201).json(await ticketSeatRequest("POST", "/holds", payload));
}));
app.post("/api/purchases", asyncRoute(async (req, res) => {
  const selection = normalizeSelection(req.body.selection);
  const payload = {
    layoutId: req.body.layoutId,
    holdId: req.body.holdId,
    selection,
    total: selection.reduce((sum, item) => sum + item.price, 0),
    currency: req.body.currency || "XOF",
    customer: {
      name: req.body.customerName || "Client demo",
      ...(req.body.customerEmail ? { email: req.body.customerEmail } : {}),
    },
    metadata: {
      source: "node-express-ticket-seat-example",
      partnerReference: crypto.randomUUID(),
    },
    ...(req.body.showtimeId
      ? { showtimeId: req.body.showtimeId }
      : { eventId: req.body.eventId }),
  };
  const result = await fetch(`${apiBaseUrl}/purchases`, {
    method: "POST",
    headers: partnerHeaders({
      "Content-Type": "application/json",
      "X-Idempotency-Key": `demo-${crypto.randomUUID()}`,
    }),
    body: JSON.stringify(payload),
  });
  const data = await result.json();
  if (!result.ok) {
    const error = new Error(data.error || "Achat refusé");
    error.status = result.status;
    error.payload = data;
    throw error;
  }
  res.status(201).json(data);
}));
app.get("/api/source-bundle", asyncRoute(async (_req, res) => {
  const [html, js, css] = await Promise.all([
    fs.readFile(path.join(publicDir, "index.html"), "utf8"),
    fs.readFile(path.join(publicDir, "app.js"), "utf8"),
    fs.readFile(path.join(publicDir, "app.css"), "utf8"),
  ]);
  res.json({ html, js, css });
}));
app.get("/admin/webhooks.json", (_req, res) => res.json(webhookEvents));
app.get("/admin/webhooks", (_req, res) => {
  res.type("html").send(`<!doctype html><html lang="fr"><meta charset="utf-8"><title>Notifications Ticket Seat</title><link rel="stylesheet" href="/app.css"><main class="page"><section class="card"><h1>Notifications reçues</h1><p><a href="/">Retour à la démo</a></p><pre class="status">${JSON.stringify(webhookEvents, null, 2)}</pre></section></main></html>`);
});

app.use((error, _req, res, _next) => {
  res.status(error.status || 500).json(error.payload || { error: error.message });
});

app.listen(Number(process.env.PORT || 5002), "0.0.0.0", () => {
  console.log(`Exemple Ticket Seat Node.js : http://localhost:${process.env.PORT || 5002}`);
});
