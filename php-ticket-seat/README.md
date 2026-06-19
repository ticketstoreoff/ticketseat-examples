# Ticket Seat - Exemple partenaire PHP

Exemple sans framework pour rendre l'intégration lisible. Il couvre événements standard, séances
cinéma, plan intégré, panier partenaire, réservation, achat et notifications signées.

## Installation

Prérequis : PHP 8.1+ avec l'extension cURL.

```bash
cd ticketseat-examples/php-ticket-seat
cp .env.example .env
php -S localhost:5003 -t public public/index.php
```

Ouvre `http://localhost:5003` et ajoute cette origine aux domaines autorisés du plan dans Ticket
Seat. Le token reste dans `.env` et ne doit jamais être envoyé au navigateur.
