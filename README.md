# Loopwise

Loopwise är en liten PWA för kontinuerlig förbättring: ett fokus, korta påminnelser och snabba reflektioner som blir nästa justering.

## Syfte

De flesta feedbacksystem gör återkoppling till ett stort event. Loopwise gör motsatsen: små reflektioner som användaren kommer ihåg i nästa försök.

## Status

Första MVP under aktiv utveckling.

## Funktioner

Fungerar:
- Starta och avsluta en session.
- Spara fokus, kategori, påminnelseschema och reflektionsschema lokalt.
- Svara på korta reflektioner.
- Göra senaste "nästa gång"-svaret till nästa justering.
- Visa lärdomsarkiv.
- Registrera PWA och service worker.
- Förbereda Web Push-prenumeration mot enkel Node-server.

Saknas:
- Produktionskonfiguration för HTTPS-domän.
- Testad deploy på garageserver.
- Finjustering efter användning på riktig mobil.

## Teknik

- HTML
- CSS
- JavaScript
- IndexedDB
- Service worker
- Web Push via minimal Node-server

## Struktur

- `index.html` - appens skal.
- `styles.css` - mobilförst-gränssnitt.
- `app.js` - sessioner, IndexedDB och klientlogik.
- `sw.js` - cache och push-hantering.
- `manifest.webmanifest` - PWA-manifest.
- `server.js` - enkel Web Push-server.
- `assets/` - ikoner och statiska resurser.

## Köra lokalt

Starta en statisk server i projektroten:

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

Starta den kombinerade webb- och pushservern separat:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe server.py --host 127.0.0.1 --port 8004
```

För riktig mobilpush krävs HTTPS och att appen når pushservern via samma dator eller publik domän.

## Aktuell prioritet

Se `JOURNAL.md`.

## Framtida idéer

Se `IDEAS.md`.
