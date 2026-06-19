<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$public = __DIR__;
$runtime = $root . '/runtime';
$webhookFile = $runtime . '/webhooks.json';

function loadEnv(string $file): array
{
    if (!is_file($file)) return [];
    $result = [];
    foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) continue;
        [$key, $value] = explode('=', $line, 2);
        $result[trim($key)] = trim($value, " \t\n\r\0\x0B\"'");
    }
    return $result;
}

$env = array_merge(loadEnv($root . '/.env'), $_ENV);
$apiBaseUrl = rtrim($env['TICKET_SEAT_API_BASE_URL'] ?? 'https://perceptive-heart-production.up.railway.app/api/v1', '/');
$partnerToken = $env['TICKET_SEAT_PARTNER_TOKEN'] ?? '';
$webhookSecret = $env['TICKET_SEAT_WEBHOOK_SECRET'] ?? '';

function jsonResponse(mixed $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function inputJson(): array
{
    return json_decode(file_get_contents('php://input') ?: '{}', true) ?: [];
}

function ticketSeatRequest(string $method, string $path, ?array $body = null): array
{
    global $apiBaseUrl, $partnerToken;
    if ($partnerToken === '') {
        throw new RuntimeException('TICKET_SEAT_PARTNER_TOKEN manquant dans .env', 500);
    }
    $headers = ['Accept: application/json', 'Authorization: Bearer ' . $partnerToken];
    if ($body !== null) $headers[] = 'Content-Type: application/json';
    $curl = curl_init($apiBaseUrl . $path);
    curl_setopt_array($curl, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_POSTFIELDS => $body === null ? null : json_encode($body),
    ]);
    $raw = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    if ($raw === false) throw new RuntimeException(curl_error($curl), 502);
    $payload = json_decode($raw, true) ?? ['raw' => $raw];
    if ($status >= 400) {
        throw new RuntimeException(json_encode($payload, JSON_UNESCAPED_UNICODE), $status);
    }
    return $payload;
}

function normalizeSelection(array $selection): array
{
    $result = [];
    foreach ($selection as $item) {
        $id = $item['id'] ?? $item['seatId'] ?? null;
        if (!$id) continue;
        $result[] = [
            'type' => ($item['type'] ?? '') === 'ZONE' ? 'ZONE' : 'SEAT',
            'id' => (string) $id,
            'label' => $item['label'] ?? $item['seatLabel'] ?? (string) $id,
            'price' => (int) ($item['price'] ?? 0),
            'currency' => $item['currency'] ?? 'XOF',
        ];
    }
    return $result;
}

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$requestedFile = realpath($public . $uri);
if ($uri !== '/' && $requestedFile && str_starts_with($requestedFile, realpath($public)) && is_file($requestedFile)) {
    return false;
}

try {
    if ($method === 'GET' && $uri === '/') {
        header('Content-Type: text/html; charset=utf-8');
        readfile($public . '/demo.html');
        exit;
    }
    if ($method === 'GET' && $uri === '/health') jsonResponse(['status' => 'ok']);
    if ($method === 'GET' && $uri === '/api/events') {
        jsonResponse(ticketSeatRequest('GET', '/partner/events'));
    }
    if ($method === 'GET' && preg_match('#^/api/events/([^/]+)/showtimes$#', $uri, $match)) {
        jsonResponse(ticketSeatRequest('GET', '/partner/events/' . rawurlencode($match[1]) . '/showtimes'));
    }
    if ($method === 'GET' && preg_match('#^/api/events/([^/]+)/embed$#', $uri, $match)) {
        jsonResponse(ticketSeatRequest('GET', '/partner/events/' . rawurlencode($match[1]) . '/embed'));
    }
    if ($method === 'GET' && preg_match('#^/api/showtimes/([^/]+)/embed$#', $uri, $match)) {
        jsonResponse(ticketSeatRequest('GET', '/partner/showtimes/' . rawurlencode($match[1]) . '/embed'));
    }
    if ($method === 'POST' && $uri === '/api/holds') {
        $data = inputJson();
        $selection = normalizeSelection($data['selection'] ?? []);
        $payload = [
            'layoutId' => $data['layoutId'] ?? '',
            'seatIds' => array_column($selection, 'id'),
            'durationMinutes' => (int) ($data['durationMinutes'] ?? 5),
        ];
        $contextKey = !empty($data['showtimeId']) ? 'showtimeId' : 'eventId';
        $payload[$contextKey] = $data['showtimeId'] ?? $data['eventId'] ?? '';
        jsonResponse(ticketSeatRequest('POST', '/holds', $payload), 201);
    }
    if ($method === 'POST' && $uri === '/api/purchases') {
        $data = inputJson();
        $selection = normalizeSelection($data['selection'] ?? []);
        $payload = [
            'layoutId' => $data['layoutId'] ?? '',
            'holdId' => $data['holdId'] ?? '',
            'selection' => $selection,
            'total' => array_sum(array_column($selection, 'price')),
            'currency' => $data['currency'] ?? 'XOF',
            'customer' => array_filter([
                'name' => $data['customerName'] ?? 'Client demo',
                'email' => $data['customerEmail'] ?? null,
            ]),
            'metadata' => ['source' => 'php-ticket-seat-example', 'partnerReference' => uniqid('demo-', true)],
        ];
        $contextKey = !empty($data['showtimeId']) ? 'showtimeId' : 'eventId';
        $payload[$contextKey] = $data['showtimeId'] ?? $data['eventId'] ?? '';
        jsonResponse(ticketSeatRequest('POST', '/purchases', $payload), 201);
    }
    if ($method === 'GET' && $uri === '/api/source-bundle') {
        jsonResponse([
            'html' => file_get_contents($public . '/demo.html'),
            'js' => file_get_contents($public . '/app.js'),
            'css' => file_get_contents($public . '/app.css'),
        ]);
    }
    if ($method === 'POST' && $uri === '/webhooks/ticket-seat') {
        $raw = file_get_contents('php://input') ?: '';
        $timestamp = $_SERVER['HTTP_X_TICKET_STORE_TIMESTAMP'] ?? '';
        $signature = $_SERVER['HTTP_X_TICKET_STORE_SIGNATURE'] ?? '';
        if ($webhookSecret !== '') {
            $expected = hash_hmac('sha256', $timestamp . '.' . $raw, $webhookSecret);
            if (!hash_equals($expected, $signature)) jsonResponse(['error' => 'Signature invalide'], 401);
        }
        $payload = json_decode($raw, true) ?? ['raw' => $raw];
        if (!is_dir($runtime)) mkdir($runtime, 0775, true);
        $events = is_file($webhookFile) ? (json_decode(file_get_contents($webhookFile), true) ?: []) : [];
        array_unshift($events, [
            'receivedAt' => gmdate(DATE_ATOM),
            'event' => $_SERVER['HTTP_X_TICKET_STORE_EVENT'] ?? $payload['event'] ?? null,
            'deliveryId' => $_SERVER['HTTP_X_TICKET_STORE_DELIVERY_ID'] ?? $payload['deliveryId'] ?? null,
            'payload' => $payload,
        ]);
        file_put_contents($webhookFile, json_encode(array_slice($events, 0, 50), JSON_PRETTY_PRINT));
        jsonResponse(['received' => true]);
    }
    if ($method === 'GET' && ($uri === '/admin/webhooks' || $uri === '/admin/webhooks.json')) {
        $events = is_file($webhookFile) ? (json_decode(file_get_contents($webhookFile), true) ?: []) : [];
        if ($uri === '/admin/webhooks.json') jsonResponse($events);
        header('Content-Type: text/html; charset=utf-8');
        echo '<!doctype html><html lang="fr"><meta charset="utf-8"><title>Notifications Ticket Seat</title><link rel="stylesheet" href="/app.css"><main class="page"><section class="card"><h1>Notifications reçues</h1><p><a href="/">Retour à la démo</a></p><pre class="status">' . htmlspecialchars(json_encode($events, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)) . '</pre></section></main>';
        exit;
    }
    jsonResponse(['error' => 'Route introuvable'], 404);
} catch (Throwable $error) {
    $status = $error->getCode() >= 400 && $error->getCode() <= 599 ? $error->getCode() : 500;
    $decoded = json_decode($error->getMessage(), true);
    jsonResponse($decoded ?: ['error' => $error->getMessage()], $status);
}
