# Ticket Seat - Exemple partenaire Node.js Express

Projet officiel couvrant les événements standard et le cinéma. Ticket Seat fournit le plan de
salle; Express conserve le token côté serveur et le partenaire gère son panier, sa réservation et
son achat.

## Installation

```bash
cd ticketseat-examples/node-express-ticket-seat
cp .env.example .env
npm install
npm run dev
```

Ouvre `http://localhost:5002`, puis ajoute cette origine dans les domaines autorisés du plan depuis
l'espace partenaire Ticket Seat.

## Parcours couverts

- `GET /partner/events`
- `GET /partner/events/:eventId/showtimes`
- `GET /partner/events/:eventId/embed`
- `GET /partner/showtimes/:showtimeId/embed`
- réception de `ticket-seat:selection-changed`
- `POST /holds` et `POST /purchases`
- notifications signées sur `POST /webhooks/ticket-seat`

Ne place jamais `TICKET_SEAT_PARTNER_TOKEN` dans le JavaScript envoyé au navigateur.
