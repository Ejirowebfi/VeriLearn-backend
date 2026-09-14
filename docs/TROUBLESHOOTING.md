# Troubleshooting

## Common Issues

### Startup

**`Cannot connect to database`**
- Ensure PostgreSQL is running: `docker-compose up postgres -d`
- Verify `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` in `.env`

**`Port 3000 already in use`**
- Change `PORT` in `.env` or kill the process: `lsof -ti:3000 | xargs kill`

**`JWT_SECRET must be set in production` / `JWT_REFRESH_SECRET must be set in production` / `VIDEO_TOKEN_SECRET must be set in production`**
- These secrets have insecure placeholder fallbacks in development, but the app refuses to boot with `NODE_ENV=production` unless they're explicitly set in `.env` — generate a real random value for each (e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)

### Database

**`relation "users" does not exist`**
- Run migrations: `npm run migration:run`
- Or in development with `synchronize: true`, restart the app

**`Too many connections`**
- Reduce `DB_POOL_MAX` in `.env`
- Check for connection leaks in custom queries

### Authentication

**`401 Unauthorized` on protected routes**
- Include `Authorization: Bearer <token>` header
- Check token expiry — refresh using `POST /api/v1/auth/refresh`

**MFA token invalid**
- Ensure device clock is synced (TOTP is time-based)
- Re-generate MFA secret if needed

### CORS

**`CORS policy blocked`**
- Set `CORS_ORIGIN` in `.env` to your frontend URL
- For multiple origins use a comma-separated list, e.g. `CORS_ORIGIN=https://app.example.com,https://admin.example.com`
- If `CORS_ORIGIN` is unset, all cross-origin requests are blocked (there is no wildcard fallback) — this is deliberate, since `credentials: true` combined with a wildcard origin is invalid/unsafe

### Stellar / Blockchain

**`Stellar secret key not configured`**
- Set `STELLAR_SECRET_KEY` in `.env`
- For testnet, create a funded account at https://laboratory.stellar.org

**`Transaction submission failed`**
- Check account has sufficient XLM for fees
- Verify `STELLAR_NETWORK` matches your key's network

### Elasticsearch

**`Elasticsearch not available`**
- The app degrades gracefully — search returns empty results
- Start ES: `docker-compose up elasticsearch -d`
- Verify `ELASTICSEARCH_URL` in `.env`

### Video Streaming

**`HLS manifest not found`**
- Ensure video files are in `VIDEO_STORAGE_PATH/<lessonId>/index.m3u8`
- Check `VIDEO_STORAGE_PATH` in `.env`

**`Stream token expired`**
- Request a new token via `POST /api/v1/video/token/:lessonId`

### Docker

**`docker-compose up` fails**
- Ensure Docker Desktop is running
- Run `docker-compose down -v` then `docker-compose up --build`

### Deployment

**Environment variables not loaded in production**
- Set all variables from `.env.example` in your deployment platform
- Never commit `.env` to version control
