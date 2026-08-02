# Triangle Liquidators Live Auction Tracker & Out-of-Pocket Calculator
### GitHub Repository: `techguyowen/TL-Dashboard`

A real-time auction tracking dashboard built with Node.js, Express, and Puppeteer. Features live countdown timers, financial fee calculations (15% Buyer Premium + 7.25% Tax + 3% Credit Card fee), custom keyword watchlists, exclude keyword filters, and headless auction account synchronization.

---

## ⚡ Option 1: Deploy with Docker Compose (Prebuilt GitHub Image)

GitHub Actions automatically builds and publishes the container image to GitHub Container Registry (`ghcr.io/techguyowen/tl-dashboard:latest`). Anyone with Docker installed can launch the dashboard in seconds without needing to clone or compile code.

### Step 1: Save `docker-compose.yml` on your server

```yaml
version: '3.8'

services:
  tl-auction-dashboard:
    image: ghcr.io/techguyowen/tl-dashboard:latest
    container_name: tl-auction-dashboard
    restart: unless-stopped
    ports:
      - "8419:8419"
    environment:
      - PORT=8419
      - NODE_ENV=production
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8419/api/progress"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
```

### Step 2: Start the server

```bash
docker compose up -d
```

Access the dashboard at `http://localhost:8419`.

---

## 📦 Option 2: Run directly with `docker run` (Prebuilt Image)

```bash
docker run -d \
  --name tl-auction-dashboard \
  -p 8419:8419 \
  --restart unless-stopped \
  ghcr.io/techguyowen/tl-dashboard:latest
```

---

## 🛠️ Option 3: Build from Source with Docker Compose

If you want Docker to build the image locally from GitHub source code instead of pulling the prebuilt image:

```yaml
version: '3.8'

services:
  tl-auction-dashboard:
    build:
      context: https://github.com/techguyowen/TL-Dashboard.git#main
      dockerfile: Dockerfile
    container_name: tl-auction-dashboard
    restart: unless-stopped
    ports:
      - "8419:8419"
    environment:
      - PORT=8419
      - NODE_ENV=production
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8419/api/progress"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
```

```bash
docker compose up -d --build
```

---

## 💻 Running Locally / Development

```bash
# Clone repository
git clone https://github.com/techguyowen/TL-Dashboard.git
cd TL-Dashboard

# Install & Run
npm install
npm start
```

Access the dashboard at `http://localhost:8419`.
