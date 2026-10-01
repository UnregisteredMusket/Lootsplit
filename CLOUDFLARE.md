# Cloudflare Workers

Lootsplit's development server is unchanged (`npm run dev` on port 8080). It keeps shared rooms in `data/cloud-rooms.json` only when no D1 binding is present.

Production shared rooms use Cloudflare D1. The Worker reads `env.DB`. Optimistic updates still require the stored revision to match (`UPDATE`/`DELETE ... AND revision = ?`). If D1 is missing on Cloudflare, room calls fail instead of writing a local file. Device backups stay in the browser and in downloaded files.

No account id, database id, or token is committed. After you create the database, add this line under `[[d1_databases]]` in `wrangler.toml`:

```toml
database_id = "<id from the D1 page>"
```

The binding name must stay `DB`.

## Before Deploy

1. In the Cloudflare dashboard, open **Storage & databases → D1 → Create**. Name it `lootsplit`.
2. Add `database_id = "<that id>"` under `[[d1_databases]]` in `wrangler.toml`.
3. Commit and push that line, or put it on the branch Cloudflare builds. Do not invent an id.
4. The deploy command applies `cloudflare/migrations/0001_campaign_rooms.sql` to the remote database.

Local check, after the id is real and `wrangler login` has been done:

```bash
npx wrangler d1 migrations apply DB --remote
```

`DB` is the binding name, not a second database name.

## Scripts

- `npm run build:cloudflare` builds the interface and the Worker bundle into `dist/`.
- `npm run deploy:cloudflare` applies the remote D1 migration, then runs `wrangler deploy`.

This repository does not claim that two live clients have been tested against a deployed Worker.
