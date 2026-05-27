# Keves Hakvasim — Polymarket Clone

App on `10.100.102.26`:
- Frontend (nginx): http://10.100.102.26:8090
- Backend API:     http://10.100.102.26:4100
- MongoDB:         internal only

## Rules
- Each public IP gets **100 points/day** (auto-refilled on first request each UTC day).
- Creating a poll costs **20 points**.
- Voting costs **1 point per vote**. A user may vote any number of times on the same poll.
- Poll titles: **max 40 characters**.
- Frontend is Hebrew (RTL). Poll creators can choose `he` or `en` per poll.

## Run
```bash
cd /home/ta9/new_apps/poly
docker compose up -d --build
```

## Live-edit the frontend
The folder `frontend/html/` is mounted into nginx as a volume. Edit any of:
- `index.html`
- `styles.css`
- `app.js`
- `sheep.svg`  (replace with your own image if desired — keep the filename, or use `sheep.png` and update references)

Changes are reflected immediately on refresh — no rebuild needed.

## Container layout
- `poly_mongo`      — MongoDB 7
- `poly_backend`    — Node 20 + Express + Mongoose (port 4000)
- `poly_frontend`   — nginx:alpine (port 8080) with API proxy to backend

## API
- `GET  /api/me`                — current IP, points, costs
- `GET  /api/polls?category=&sort=new|hot|rich&q=`
- `GET  /api/polls/:id`
- `POST /api/polls`             — `{title, description, category, type:'binary'|'multi', options?, closesAt?, language}`
- `POST /api/polls/:id/vote`    — `{optionIndex, amount}`
- `GET  /api/categories`
- `GET  /api/stats`
