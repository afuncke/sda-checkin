# Quantified SD&A

A tiny live "wisdom of the crowd" ritual. Everyone anonymously drops one number about themselves into the box, optionally says what it is, and guesses the group average. The presenter then reveals the real distribution next to the guesses, the outlier, and a word cloud of what people described.

## Run

Requires Node ≥ 22.13 (uses the built-in `node:sqlite`; no npm dependencies).

```sh
npm start          # http://localhost:3000
npm test
```

- **Vote view** (phones, laptops): `http://<host>:3000/`
- **Presenter view** (semi-secret): `http://<host>:3000/#backstage-7k2`

## Configuration

| Env var | Default | |
|---|---|---|
| `PORT` | `3000` | |
| `PRESENTER_KEY` | `backstage-7k2` | The presenter URL is `/#<key>`. Change it before running this anywhere public. |
| `DB_FILE` | `data/wotc.db` | SQLite file. `:memory:` for throwaway runs. |
| `SEED_DEMO` | unset | `1` fills the very first round with the 20-person demo crowd. |

The number of histogram bars is `BINS` at the top of `public/app.js` (default 8).

## How it works

- `server.js` is a plain `node:http` server with SQLite storage. Clients get live updates over Server-Sent Events (`/api/events`).
- Numbers stay sealed until the reveal: before then the API only exposes the count, so nobody can peek at the average before guessing.
- Presenter actions (edit question, reveal, new round, demo crowd) require the `X-Presenter-Key` header, which the page takes from the URL hash.
- Each voter remembers their own submission in `localStorage` to show the "Tack!" receipt. Starting a new round resets every voter to step 1.
- Behind a reverse proxy, make sure response buffering is off for `/api/events` (the server already sends `X-Accel-Buffering: no` for nginx).

## Design source

`project/Wisdom of the Crowd.dc.html` and `chats/` are the original Claude Design handoff this was built from.
