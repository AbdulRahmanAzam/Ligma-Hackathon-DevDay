# Quick Reference Card 📋

## 🚀 Deploy to Digital Ocean (2 Methods)

### Method 1: App Platform (Easiest)
```bash
# 1. Push to GitHub
git add . && git commit -m "Deploy" && git push

# 2. Go to: https://cloud.digitalocean.com/apps
# 3. Create App → GitHub → Select repo
# 4. Add environment variables (see below)
# 5. Deploy!
```

### Method 2: Droplet
```bash
# 1. Create Ubuntu droplet
# 2. SSH in
ssh root@your-ip

# 3. Install Docker
curl -fsSL https://get.docker.com | sh
apt install docker-compose -y

# 4. Clone and deploy
git clone your-repo
cd your-repo
cp .env.example .env
nano .env  # Edit values
docker-compose up -d --build
```

## 🔑 Environment Variables

```env
NODE_ENV=production
PORT=10000
HOST=0.0.0.0
JWT_SECRET=<generate-random-32-chars>
DO_AI_API_KEY=<your-do-api-key>
DO_AI_MODEL=llama3-8b-instruct
DO_AI_ENDPOINT=https://api.digitalocean.com/v2/ai/chat/completions
```

### Generate JWT Secret
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 🧪 Test Deployment

```bash
# Health check
curl https://your-url.com/health

# Expected response
{"ok":true,"rooms":0,"uptime_s":123}
```

## 📝 Update Frontend

Edit `apps/web/.env`:
```env
VITE_API_URL=https://your-backend-url.com
VITE_LIGMA_SYNC_URL=wss://your-backend-url.com/ligma-sync
```

Then:
```bash
cd apps/web
npm run build
git push  # Vercel auto-deploys
```

## 🐳 Docker Commands

```bash
# Start
docker-compose up -d

# Stop
docker-compose down

# Restart
docker-compose restart

# View logs
docker-compose logs -f

# Rebuild
docker-compose up -d --build

# Check status
docker-compose ps
```

## 🔍 Troubleshooting

### Check Logs
```bash
docker-compose logs -f
```

### Check Health
```bash
curl http://localhost:10000/health
```

### Restart Everything
```bash
docker-compose down
docker-compose up -d --build
```

### Check WebSocket
Open browser console:
```javascript
const ws = new WebSocket('wss://your-url.com/ligma-sync');
ws.onopen = () => console.log('✅ Connected');
```

## 📊 Monitoring

### View Logs (App Platform)
Dashboard → Your App → Runtime Logs

### View Logs (Droplet)
```bash
docker-compose logs -f
```

### Check Resource Usage
```bash
docker stats
```

## 🔒 Security

- ✅ Use strong JWT_SECRET (32+ chars)
- ✅ Enable HTTPS/WSS
- ✅ Don't commit .env files
- ✅ Enable firewall
- ✅ Regular backups

## 💰 Pricing

| Platform | Plan | Price | RAM | CPU |
|----------|------|-------|-----|-----|
| App Platform | Basic | $5/mo | 512MB | 1 |
| App Platform | Pro | $12/mo | 1GB | 1 |
| Droplet | Basic | $6/mo | 1GB | 1 |

## 📚 Documentation

- **Full Guide**: `DIGITALOCEAN_DEPLOYMENT.md`
- **Checklist**: `DEPLOYMENT_CHECKLIST.md`
- **Ready Guide**: `READY_FOR_DIGITALOCEAN.md`

## 🆘 Common Issues

| Issue | Solution |
|-------|----------|
| Build fails | Check Docker is running |
| WebSocket fails | Check firewall, SSL cert |
| Database errors | Check volume permissions |
| High memory | Upgrade plan |
| Can't connect | Check environment variables |

## ✅ Deployment Checklist

- [ ] Push code to GitHub
- [ ] Create Digital Ocean app/droplet
- [ ] Add environment variables
- [ ] Deploy backend
- [ ] Get backend URL
- [ ] Update frontend .env
- [ ] Redeploy frontend
- [ ] Test health endpoint
- [ ] Test WebSocket
- [ ] Test real-time features
- [ ] Set up monitoring
- [ ] Configure backups

## 🎯 Quick Test

1. Open app in 2 browser windows
2. Draw in one window
3. Should appear in other window
4. Should see each other's cursors

✅ = Working!
❌ = Check logs and troubleshoot

---

**Need detailed help?** See `DIGITALOCEAN_DEPLOYMENT.md`

**Everything ready?** See `READY_FOR_DIGITALOCEAN.md`
