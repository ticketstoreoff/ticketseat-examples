# Ticket Seat - Projets d'exemple officiels

Ce dépôt accompagne la documentation d'intégration Ticket Seat. Chaque projet réalise le même
parcours métier avec un langage serveur différent.

| Projet | Port local | Standard | Cinéma | Plan intégré | Notifications |
| --- | ---: | :---: | :---: | :---: | :---: |
| [Python Flask](python-flask-ticket-seat) | 5001 | Oui | Oui | Oui | Oui |
| [Node.js Express](node-express-ticket-seat) | 5002 | Oui | Oui | Oui | Oui |
| [PHP](php-ticket-seat) | 5003 | Oui | Oui | Oui | Oui |
| [Go](go-ticket-seat) | 5004 | Oui | Oui | Oui | Oui |

## Principe commun

1. Le serveur partenaire conserve son token Ticket Seat dans `.env`.
2. Le navigateur demande les événements au serveur partenaire.
3. Ticket Seat fournit un plan prêt à afficher dans une iframe.
4. Le plan transmet la sélection avec `ticket-seat:selection-changed`.
5. Le serveur partenaire appelle `POST /holds`, puis `POST /purchases`.
6. Ticket Seat notifie le serveur partenaire des ventes et des scans.

## Sécurité

- Ne jamais placer le token partenaire dans le navigateur ou dans Git.
- Copier `.env.example` vers `.env` localement.
- Vérifier la signature HMAC des notifications en production.
- Autoriser explicitement le domaine qui affiche le plan.

Le dépôt est actuellement privé. Ticket Seat doit inviter le compte GitHub de chaque partenaire
autorisé.
