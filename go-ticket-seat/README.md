# Ticket Seat - Exemple partenaire Go

Serveur Go sans dépendance externe couvrant standard, cinéma, plan intégré, panier partenaire,
réservation, achat et réception des notifications signées.

```bash
cd ticketseat-examples/go-ticket-seat
cp .env.example .env
go run .
```

Ouvre `http://localhost:5004` puis autorise cette origine dans la configuration du plan Ticket Seat.
Le token partenaire reste exclusivement dans `.env` côté serveur.
