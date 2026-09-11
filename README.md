# Brick Builder

Browser game di building voxel: scolpisci a mano libera (attach / erase / paint / fill / box select),
importa un'immagine e convertila automaticamente in voxel, esporta in `.vox`, `.obj`, `.glb` o come
progetto `.json`, pubblica le tue creazioni in una gallery pubblica reale.

Stack: Next.js 16 (App Router, Turbopack) + React Three Fiber / drei / Three.js, Postgres (Neon) per
la persistenza, Solana (Phantom) per l'identità dei publisher e per lo sblocco Pro a pagamento.

## Funzionalità attuali

- Editor voxel completo: strumenti attach/erase/paint/fill/eyedrop/select/box, mirror su 3 assi,
  clip plane, undo/redo, palette a 256 colori, dimensioni griglia 32/64/128/256
- Import immagine → voxel (con limite di utilizzi gratuiti, sbloccabile con un abbonamento mensile
  pagato in SOL via Phantom)
- Export `.vox`, `.obj` (zip con materiali), `.glb`, progetto `.json`
- Bozza salvata in locale (localStorage) mentre lavori
- **Pubblicazione reale in gallery**: il pulsante PUBLISH nel builder salva la creazione su Postgres
  (Neon), collegata al wallet Solana usato per pubblicare
- Gallery pubblica con ordinamento per data/like e ricerca, dati reali dal database — nessun numero
  o utente inventato
- Home page con statistiche aggregate reali (creazioni, creator, like, view); la sezione "esempi"
  è dichiaratamente tale e separata dai contenuti della community

## Setup

\```
npm install
\```

Copia `env.example` in `.env.local` e imposta almeno `POSTGRES_URL` (una connection string Neon)
per abilitare pubblicazione, gallery e like. Senza `POSTGRES_URL` l'app resta utilizzabile ma la
gallery/community restano vuote e il pulsante PUBLISH fallisce in modo esplicito.

\```
npm run dev
\```

Apri `http://localhost:3000/build` per l'editor, `http://localhost:3000/gallery` per la gallery.

Prima del primo utilizzo con un database vuoto, applica lo schema in `db/schema.sql` al tuo
progetto Neon (tabelle `users`, `creations`, `likes`, `entitlements`).

## Prossimi passi

- Upload di una thumbnail statica opzionale (oggi la gallery renderizza ogni creazione live in 3D
  dai dati voxel salvati, il che funziona ma pesa di più lato client su creazioni molto grandi)
- Paginazione/infinite scroll sulla gallery oltre l'attuale limite fisso
- Moderazione dei contenuti pubblicati prima che compaiano in home
- Collegamento del wallet come login persistente in tutta l'app (oggi viene richiesto solo al
  momento di pubblicare o mettere like)
