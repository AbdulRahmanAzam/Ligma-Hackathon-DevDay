# Digital Ocean Deployment Guide

## Recommendation

Deploy the backend on a DigitalOcean Droplet.

That is the best fit for this repository because the server uses:

- a long-running Fastify process
- WebSockets for real-time sync
- SQLite on local disk for persistence

Your frontend is already on Vercel at `https://ligma26.vercel.app`, so the clean setup is:

- Droplet for the backend
- Vercel for the frontend

This repo includes two Docker options:

- `Dockerfile-server` for backend-only Droplet deployment, which is what you want here
- `Dockerfile` for a full-stack container that also builds and serves the web app

## Pre-Deployment Checklist

Make sure these are present:

- Dockerfile-server for backend-only production builds
- Dockerfile for full-stack builds
- docker-compose.yml for local testing
- .env.example with backend environment variables
- SQLite persistence configured
- WebSocket support enabled

## Droplet Deployment

### 1. Create the Droplet

1. Go to https://cloud.digitalocean.com/droplets
2. Click Create Droplet
3. Choose Ubuntu 22.04 or 24.04
4. Pick at least 1 GB RAM, 2 GB is safer
5. Add your SSH key
6. Create the Droplet and note the IP address

### 2. Install Docker on the Droplet

SSH in:

```bash
ssh root@your-droplet-ip
```

Install Docker:

```bash
apt update && apt upgrade -y
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
apt install docker-compose -y
docker --version
docker-compose --version
```

### 3. Clone the Repository

```bash
cd /opt
git clone https://github.com/your-username/your-repo.git ligma
cd ligma
```

### 4. Create the Production .env

Copy the template and fill in real values:

```bash
cp .env.example .env
nano .env
```

Use these values at minimum:

```env
NODE_ENV=production
PORT=10000
HOST=0.0.0.0
LOG_LEVEL=info
LIGMA_SYNC_PATH=/ligma-sync
JWT_SECRET=your-strong-random-secret
DO_AI_API_KEY=your-digitalocean-api-key
DO_AI_MODEL=llama3-8b-instruct
DO_AI_ENDPOINT=https://api.digitalocean.com/v2/ai/chat/completions
```

If you want the backend to accept requests from your Vercel frontend, also set:

```env
FRONTEND_URL=https://ligma26.vercel.app
```

### 5. Build and Run the Backend Container

Use the backend-only Dockerfile:

```bash
docker build -f Dockerfile-server -t ligma-server .
docker volume create ligma-data
docker run -d \
  --name ligma-server \
  --restart unless-stopped \
  -p 10000:10000 \
  --env-file .env \
  -v ligma-data:/app/apps/server/data \
  ligma-server
```

Check logs:

```bash
docker logs -f ligma-server
```

### 6. Add Nginx and HTTPS

Install Nginx:

```bash
apt install nginx -y
```

Create a site config:

```bash
nano /etc/nginx/sites-available/ligma
```

Use this config, replacing `api.your-domain.com` with your real domain:

```nginx
server {
    listen 80;
    server_name api.your-domain.com;

    location / {
        proxy_pass http://localhost:10000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /ligma-sync {
        proxy_pass http://localhost:10000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

Enable the site and get SSL:

```bash
ln -s /etc/nginx/sites-available/ligma /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
apt install certbot python3-certbot-nginx -y
certbot --nginx -d api.your-domain.com
```

### 7. Open the Firewall

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

## Connect Vercel Frontend to the Droplet Backend

Your frontend code reads these exact variables:

- `VITE_API_BASE`
- `VITE_LIGMA_SYNC_URL`

Set them in the Vercel project settings for `ligma26.vercel.app`:

```env
VITE_API_BASE=https://api.your-domain.com
VITE_LIGMA_SYNC_URL=wss://api.your-domain.com/ligma-sync
```

Then redeploy the Vercel frontend.

## Verify the Deployment

Test the backend:

```bash
curl https://api.your-domain.com/health
```

Expected response:

```json
{
  "ok": true,
  "rooms": 0,
  "uptime_s": 123
}
```

Test WebSockets from the browser console:

```javascript
const ws = new WebSocket('wss://api.your-domain.com/ligma-sync');
ws.onopen = () => console.log('connected');
ws.onerror = (e) => console.error(e);
```

## Maintenance

Restart the backend:

```bash
docker restart ligma-server
```

Update the backend:

```bash
cd /opt/ligma
git pull
docker stop ligma-server
docker rm ligma-server
docker build -f Dockerfile-server -t ligma-server .
docker run -d \
  --name ligma-server \
  --restart unless-stopped \
  -p 10000:10000 \
  --env-file .env \
  -v ligma-data:/app/apps/server/data \
  ligma-server
```

Back up the SQLite database:

```bash
docker exec ligma-server cp /app/apps/server/data/ligma.db /app/apps/server/data/ligma-backup-$(date +%Y%m%d).db
```

## Notes

- The root `Dockerfile` is still available if you want a single container that serves both frontend and backend.
- For your current setup, `Dockerfile-server` is the right choice because Vercel is already handling the frontend.