# Ticket Seat - Exemple partenaire Python Flask

Ce projet montre les deux parcours recommandes pour un partenaire Ticket Seat :

- evenement standard,
- evenement cinema avec seances.

Ticket Seat affiche uniquement le plan de salle. Le site partenaire garde son propre checkout :

1. recuperer les evenements autorises,
2. si l'evenement est standard, demander directement l'iframe du plan,
3. si l'evenement est cinema, choisir une seance puis demander l'iframe du plan,
4. recevoir les sieges selectionnes avec `window.postMessage`,
5. poser un hold avec `POST /holds`,
6. confirmer l'achat avec `POST /purchases`,
7. recevoir les notifications sur `/webhooks/ticket-seat`.

## Installation

```bash
cd ticketseat-examples/python-flask-ticket-seat
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Remplis ensuite `.env` :

```env
TICKET_SEAT_API_BASE_URL=https://perceptive-heart-production.up.railway.app/api/v1
TICKET_SEAT_PARTNER_TOKEN=tsk_xxx
TICKET_SEAT_WEBHOOK_SECRET=ton_secret
```

## Lancer le projet

```bash
python app.py
```

Ouvre ensuite :

```txt
http://localhost:5001
```

## Autoriser l'affichage du plan

Dans Ticket Seat > Espace partenaire > Espace de test partenaire :

```txt
http://localhost:5001
```

doit etre ajoute dans `Domaines autorises pour afficher le widget`.

Si tu utilises ngrok :

```bash
ngrok http 5001
```

ajoute aussi le domaine ngrok, par exemple :

```txt
https://xxxx.ngrok-free.app
```

## Tester les webhooks

Avec ngrok :

```txt
https://xxxx.ngrok-free.app/webhooks/ticket-seat
```

Dans Ticket Seat, mets cette URL dans la configuration webhook partenaire.

Tu peux verifier les notifications recues ici :

```txt
http://localhost:5001/admin/webhooks
```

## Fichiers importants

- `app.py` : backend Flask et appels API Ticket Seat.
- `templates/index.html` : page demo standard + cinema avec iframe Ticket Seat et panier partenaire.
- `static/app.js` : ecoute `ticket-seat:selection-changed`.
- `templates/webhooks.html` : historique local des notifications recues.

## Mode developpeur interactif

La page affiche aussi :

- le code de l'appel API courant,
- le retour JSON de l'API,
- un bouton pour afficher le HTML, le JavaScript et le CSS complets de la page.

L'objectif est que le partenaire puisse modifier le projet, recharger la page et voir tout de suite
le resultat.

## Parcours standard

Le standard utilise l'evenement directement :

```txt
GET /partner/events
GET /partner/events/<eventId>/embed
POST /holds avec eventId
POST /purchases avec eventId
```

## Parcours cinema

Le cinema utilise une seance precise :

```txt
GET /partner/events
GET /partner/events/<eventId>/showtimes
GET /partner/showtimes/<showtimeId>/embed
POST /holds avec showtimeId
POST /purchases avec showtimeId
```

## Notes importantes

- Ce projet est volontairement simple pour apprendre et tester.
- En production, remplace le stockage en memoire par ta base de donnees.
- Le token partenaire ne doit jamais etre expose dans le navigateur.
- Les appels `POST /holds` et `POST /purchases` doivent toujours passer par ton backend.
