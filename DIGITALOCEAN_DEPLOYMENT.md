# Digital Ocean Deployment Guide

## ✅ Pre-Deployment Checklist

Your app is ready for Digital Ocean! Here's what's been prepared:

- ✅ Dockerfile (multi-stage build for optimization)
- ✅ docker-compose.yml (for easy local testing)
- ✅ .dockerignore (optimized build)
- ✅ .env.example (environment variables template)
- ✅ Health checks configured
- ✅ WebSocket support ready
- ✅ SQLite database with persistent volume
- ✅ Production-ready server configuration

## Deployment Options

### Option 1: Digital Ocean App Platform (Recommended - Easiest)

#### Step 1: Prepare Your Repository

1. **Commit all changes**:
```bash
git add .
git commit -m "Prepare for Digital Ocean deployment"
git push origin main
```

2. **Create `.env` file** (don't commit this):
```bash
cp .env.example apps/server/.env
# Edit apps/server/.env with your actual values
```

#### Step 2: Deploy to App Platform

1. Go to https://cloud.digitalocean.com/apps
2. Click **"Create App"**
3. Choose **"GitHub"** as source
4. Select your repository and branch (main)
5. Configure the app:

**Build Settings:**
- **Type**: Web Service
- **Dockerfile Path**: `Dockerfile`
- **HTTP Port**: 10000
- **HTTP Request Routes**: `/`

**Environment Variables** (click "Edit" → "Add Variable"):
```
NODE_ENV=production
PORT=10000
HOST=0.0.0.0
LOG_LEVEL=info
LIGMA_SYNC_PATH=/ligma-sync
JWT_SECRET=your-super-secret-jwt-key-change-this
DO_AI_API_KEY=your-digitalocean-api-key
DO_AI_MODEL=llama3-8b-instruct
DO_AI_ENDPOINT=https://api.digitalocean.com/v2/ai/chat/completions
```

**Resources:**
- **Plan**: Basic ($5/month) or Professional ($12/month)
- **Instance Size**: Basic (512MB RAM) is enough to start

6. Click **"Next"** → **"Create Resources"**
7. Wait for deployment (5-10 minutes)
8. Get your app URL: `https://your-app-name.ondigitalocean.app`

#### Step 3: Update Frontend

Update `apps/web/.env`:
```env
VITE_API_URL=https://your-app-name.ondigitalocean.app
VITE_LIGMA_SYNC_URL=wss://your-app-name.ondigitalocean.app/ligma-sync
```

Redeploy frontend to Vercel:
```bash
cd apps/web
npm run build
git add .
git commit -m "Update API URLs"
git push
```

---

### Option 2: Digital Ocean Droplet (More Control)

#### Step 1: Create Droplet

1. Go to https://cloud.digitalocean.com/droplets
2. Click **"Create Droplet"**
3. Choose:
   - **Image**: Ubuntu 22.04 LTS
   - **Plan**: Basic ($6/month - 1GB RAM)
   - **Datacenter**: Choose closest to your users
   - **Authentication**: SSH Key (recommended) or Password
4. Click **"Create Droplet"**
5. Note your droplet's IP address

#### Step 2: Setup Droplet

SSH into your droplet:
```bash
ssh root@your-droplet-ip
```

Install Docker and Docker Compose:
```bash
# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
apt install docker-compose -y

# Verify installation
docker --version
docker-compose --version
```

#### Step 3: Deploy Application

Clone your repository:
```bash
cd /opt
git clone https://github.com/your-username/your-repo.git ligma
cd ligma
```

Create environment file:
```bash
cp .env.example .env
nano .env
# Edit with your actual values, then save (Ctrl+X, Y, Enter)
```

Build and start:
```bash
docker-compose up -d --build
```

Check logs:
```bash
docker-compose logs -f
```

#### Step 4: Setup Nginx Reverse Proxy (Optional but Recommended)

Install Nginx:
```bash
apt install nginx -y
```

Create Nginx configuration:
```bash
nano /etc/nginx/sites-available/ligma
```

Add this configuration:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:10000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket support
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

Enable the site:
```bash
ln -s /etc/nginx/sites-available/ligma /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

#### Step 5: Setup SSL with Let's Encrypt (Recommended)

```bash
apt install certbot python3-certbot-nginx -y
certbot --nginx -d your-domain.com
```

Follow the prompts. Certbot will automatically configure SSL.

#### Step 6: Setup Firewall

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

---

## Testing Your Deployment

### 1. Test Health Endpoint
```bash
curl https://your-app-url.com/health
```

Expected response:
```json
{
  "ok": true,
  "rooms": 0,
  "uptime_s": 123
}
```

### 2. Test WebSocket Connection

Open browser console on your frontend:
```javascript
const ws = new WebSocket('wss://your-app-url.com/ligma-sync');
ws.onopen = () => console.log('✅ WebSocket connected');
ws.onerror = (e) => console.error('❌ WebSocket error:', e);
```

### 3. Test Real-time Collaboration

1. Open your app in two browser windows
2. Draw something in one window
3. Should appear in the other window immediately
4. Should see each other's cursors

---

## Monitoring & Maintenance

### View Logs (App Platform)
1. Go to your app in Digital Ocean dashboard
2. Click on your component
3. Click "Runtime Logs"

### View Logs (Droplet)
```bash
docker-compose logs -f
```

### Restart Application (Droplet)
```bash
docker-compose restart
```

### Update Application (Droplet)
```bash
cd /opt/ligma
git pull
docker-compose down
docker-compose up -d --build
```

### Backup Database (Droplet)
```bash
docker-compose exec ligma cp /app/apps/server/data/ligma.db /app/apps/server/data/ligma-backup-$(date +%Y%m%d).db
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `production` | Node environment |
| `PORT` | No | `10000` | Server port |
| `HOST` | No | `0.0.0.0` | Server host |
| `LOG_LEVEL` | No | `info` | Log level (debug, info, warn, error) |
| `LIGMA_SYNC_PATH` | No | `/ligma-sync` | WebSocket endpoint path |
| `JWT_SECRET` | **Yes** | - | Secret key for JWT tokens |
| `DO_AI_API_KEY` | **Yes** | - | DigitalOcean AI API key |
| `DO_AI_MODEL` | No | `llama3-8b-instruct` | AI model name |
| `DO_AI_ENDPOINT` | No | `https://api.digitalocean.com/v2/ai/chat/completions` | AI endpoint URL |

---

## Troubleshooting

### Build Fails
```bash
# Check Docker logs
docker-compose logs

# Rebuild from scratch
docker-compose down -v
docker-compose up -d --build
```

### WebSocket Connection Fails
- Check firewall allows port 10000
- Verify `LIGMA_SYNC_PATH` environment variable
- Check Nginx WebSocket configuration (if using)
- Ensure SSL certificate is valid (for wss://)

### Database Errors
```bash
# Check database file permissions
docker-compose exec ligma ls -la /app/apps/server/data/

# Reset database (WARNING: deletes all data)
docker-compose down -v
docker-compose up -d
```

### High Memory Usage
- Upgrade to larger droplet/plan
- Check for memory leaks in logs
- Restart application: `docker-compose restart`

---

## Cost Estimate

### App Platform
- **Basic**: $5/month (512MB RAM, 1 vCPU)
- **Professional**: $12/month (1GB RAM, 1 vCPU)

### Droplet + Nginx
- **Droplet**: $6/month (1GB RAM, 1 vCPU, 25GB SSD)
- **Bandwidth**: 1TB included
- **Total**: ~$6/month

---

## Security Best Practices

1. ✅ Use strong `JWT_SECRET` (32+ random characters)
2. ✅ Enable SSL/TLS (HTTPS/WSS)
3. ✅ Keep dependencies updated
4. ✅ Use environment variables for secrets
5. ✅ Enable firewall (UFW)
6. ✅ Regular backups of database
7. ✅ Monitor logs for suspicious activity

---

## Next Steps

1. ✅ Deploy backend to Digital Ocean
2. ✅ Get your app URL
3. ✅ Update frontend environment variables
4. ✅ Redeploy frontend to Vercel
5. ✅ Test everything works
6. ✅ Set up monitoring
7. ✅ Configure backups

---

## Support

If you encounter issues:
1. Check logs: `docker-compose logs -f`
2. Verify environment variables
3. Test health endpoint
4. Check firewall settings
5. Review Nginx configuration (if using)

Your app is production-ready! 🚀
