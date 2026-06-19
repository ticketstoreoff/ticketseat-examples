package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var (
	apiBaseURL   string
	partnerToken string
	webhookSecret string
	publicDir    = "public"
	webhookMu    sync.Mutex
	webhookEvents []map[string]any
)

func loadDotEnv(filename string) {
	data, err := os.ReadFile(filename)
	if err != nil { return }
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || !strings.Contains(line, "=") { continue }
		parts := strings.SplitN(line, "=", 2)
		if _, exists := os.LookupEnv(strings.TrimSpace(parts[0])); !exists {
			os.Setenv(strings.TrimSpace(parts[0]), strings.Trim(strings.TrimSpace(parts[1]), "\"'"))
		}
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}

func ticketSeatRequest(method, path string, body any, extraHeaders map[string]string) (any, int, error) {
	if partnerToken == "" { return nil, 500, fmt.Errorf("TICKET_SEAT_PARTNER_TOKEN manquant dans .env") }
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil { return nil, 500, err }
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequest(method, apiBaseURL+path, reader)
	if err != nil { return nil, 500, err }
	req.Header.Set("Authorization", "Bearer "+partnerToken)
	req.Header.Set("Accept", "application/json")
	if body != nil { req.Header.Set("Content-Type", "application/json") }
	for key, value := range extraHeaders { req.Header.Set(key, value) }
	client := &http.Client{Timeout: 20 * time.Second}
	response, err := client.Do(req)
	if err != nil { return nil, 502, err }
	defer response.Body.Close()
	var payload any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil { payload = map[string]any{"error": err.Error()} }
	if response.StatusCode >= 400 { return payload, response.StatusCode, fmt.Errorf("Ticket Seat HTTP %d", response.StatusCode) }
	return payload, response.StatusCode, nil
}

func proxyGET(w http.ResponseWriter, path string) {
	payload, status, err := ticketSeatRequest(http.MethodGet, path, nil, nil)
	if err != nil { writeJSON(w, status, payloadOrError(payload, err)); return }
	writeJSON(w, http.StatusOK, payload)
}

func payloadOrError(payload any, err error) any {
	if payload != nil { return payload }
	return map[string]any{"error": err.Error()}
}

func readMap(r *http.Request) (map[string]any, error) {
	var data map[string]any
	err := json.NewDecoder(r.Body).Decode(&data)
	return data, err
}

func normalizeSelection(value any) []map[string]any {
	items, _ := value.([]any)
	result := make([]map[string]any, 0, len(items))
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		id := item["id"]
		if id == nil { id = item["seatId"] }
		if id == nil { continue }
		label := item["label"]
		if label == nil { label = item["seatLabel"] }
		if label == nil { label = fmt.Sprint(id) }
		seatType := "SEAT"
		if item["type"] == "ZONE" { seatType = "ZONE" }
		price, _ := item["price"].(float64)
		currency, _ := item["currency"].(string)
		if currency == "" { currency = "XOF" }
		result = append(result, map[string]any{"type": seatType, "id": fmt.Sprint(id), "label": label, "price": price, "currency": currency})
	}
	return result
}

func apiHandler(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api")
	if r.Method == http.MethodGet && path == "/events" { proxyGET(w, "/partner/events"); return }
	if r.Method == http.MethodGet && strings.HasPrefix(path, "/events/") {
		rest := strings.TrimPrefix(path, "/events/")
		if strings.HasSuffix(rest, "/showtimes") { proxyGET(w, "/partner/events/"+rest); return }
		if strings.HasSuffix(rest, "/embed") { proxyGET(w, "/partner/events/"+rest); return }
	}
	if r.Method == http.MethodGet && strings.HasPrefix(path, "/showtimes/") && strings.HasSuffix(path, "/embed") {
		proxyGET(w, "/partner"+path); return
	}
	if r.Method == http.MethodGet && path == "/source-bundle" {
		result := map[string]string{}
		for key, name := range map[string]string{"html": "demo.html", "js": "app.js", "css": "app.css"} {
			content, _ := os.ReadFile(filepath.Join(publicDir, name)); result[key] = string(content)
		}
		writeJSON(w, http.StatusOK, result); return
	}
	if r.Method == http.MethodPost && (path == "/holds" || path == "/purchases") {
		data, err := readMap(r)
		if err != nil { writeJSON(w, 400, map[string]any{"error": "JSON invalide"}); return }
		selection := normalizeSelection(data["selection"])
		seatIDs := make([]string, 0, len(selection))
		total := float64(0)
		for _, seat := range selection { seatIDs = append(seatIDs, seat["id"].(string)); total += seat["price"].(float64) }
		context := map[string]any{}
		if value, ok := data["showtimeId"].(string); ok && value != "" { context["showtimeId"] = value } else { context["eventId"] = data["eventId"] }
		payload := map[string]any{}
		if path == "/holds" {
			payload = map[string]any{"layoutId": data["layoutId"], "seatIds": seatIDs, "durationMinutes": 5}
		} else {
			customer := map[string]any{"name": data["customerName"]}
			if data["customerEmail"] != "" { customer["email"] = data["customerEmail"] }
			payload = map[string]any{"layoutId": data["layoutId"], "holdId": data["holdId"], "selection": selection, "total": total, "currency": "XOF", "customer": customer, "metadata": map[string]any{"source": "go-ticket-seat-example", "partnerReference": fmt.Sprintf("demo-%d", time.Now().UnixNano())}}
		}
		for key, value := range context { payload[key] = value }
		extra := map[string]string{}
		if path == "/purchases" { extra["X-Idempotency-Key"] = fmt.Sprintf("demo-%d", time.Now().UnixNano()) }
		result, status, requestErr := ticketSeatRequest(http.MethodPost, path, payload, extra)
		if requestErr != nil { writeJSON(w, status, payloadOrError(result, requestErr)); return }
		writeJSON(w, http.StatusCreated, result); return
	}
	writeJSON(w, http.StatusNotFound, map[string]any{"error": "Route API introuvable"})
}

func webhookHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { writeJSON(w, 405, map[string]any{"error": "Méthode refusée"}); return }
	raw, _ := io.ReadAll(r.Body)
	if webhookSecret != "" {
		mac := hmac.New(sha256.New, []byte(webhookSecret))
		mac.Write([]byte(r.Header.Get("x-ticket-store-timestamp")+".")); mac.Write(raw)
		expected := hex.EncodeToString(mac.Sum(nil)); signature := r.Header.Get("x-ticket-store-signature")
		if len(signature) != len(expected) || subtle.ConstantTimeCompare([]byte(signature), []byte(expected)) != 1 {
			writeJSON(w, 401, map[string]any{"error": "Signature invalide"}); return
		}
	}
	var payload map[string]any; json.Unmarshal(raw, &payload)
	entry := map[string]any{"receivedAt": time.Now().UTC().Format(time.RFC3339), "event": r.Header.Get("x-ticket-store-event"), "deliveryId": r.Header.Get("x-ticket-store-delivery-id"), "payload": payload}
	webhookMu.Lock(); webhookEvents = append([]map[string]any{entry}, webhookEvents...); if len(webhookEvents) > 50 { webhookEvents = webhookEvents[:50] }; webhookMu.Unlock()
	writeJSON(w, 200, map[string]any{"received": true})
}

func main() {
	loadDotEnv(".env")
	apiBaseURL = strings.TrimRight(os.Getenv("TICKET_SEAT_API_BASE_URL"), "/")
	if apiBaseURL == "" { apiBaseURL = "https://perceptive-heart-production.up.railway.app/api/v1" }
	partnerToken = os.Getenv("TICKET_SEAT_PARTNER_TOKEN"); webhookSecret = os.Getenv("TICKET_SEAT_WEBHOOK_SECRET")
	mux := http.NewServeMux()
	mux.HandleFunc("/api/", apiHandler); mux.HandleFunc("/webhooks/ticket-seat", webhookHandler)
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, map[string]any{"status": "ok"}) })
	mux.HandleFunc("/admin/webhooks.json", func(w http.ResponseWriter, _ *http.Request) { webhookMu.Lock(); defer webhookMu.Unlock(); writeJSON(w, 200, webhookEvents) })
	mux.HandleFunc("/admin/webhooks", func(w http.ResponseWriter, _ *http.Request) { webhookMu.Lock(); data, _ := json.MarshalIndent(webhookEvents, "", "  "); webhookMu.Unlock(); w.Header().Set("Content-Type", "text/html; charset=utf-8"); fmt.Fprintf(w, `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Notifications Ticket Seat</title><link rel="stylesheet" href="/app.css"><main class="page"><section class="card"><h1>Notifications reçues</h1><p><a href="/">Retour à la démo</a></p><pre class="status">%s</pre></section></main>`, data) })
	files := http.FileServer(http.Dir(publicDir)); mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { if r.URL.Path == "/" { http.ServeFile(w, r, filepath.Join(publicDir, "demo.html")); return }; files.ServeHTTP(w, r) })
	port := os.Getenv("PORT"); if port == "" { port = "5004" }
	log.Printf("Exemple Ticket Seat Go : http://localhost:%s", port); log.Fatal(http.ListenAndServe("0.0.0.0:"+port, mux))
}
