# Digital Ocean Deployment Checklist ✅

## Pre-Deployment (Complete ✅)

- [x] Dockerfile created
- [x] docker-compose.yml configured
- [x] .dockerignore optimized
- [x] .env.example template ready
- [x] Health checks configured
- [x] WebSocket support enabled
- [x] Database persistence configured
- [x] Deployment scripts created (deploy.sh & deploy.bat)
- [x] Comprehensive deployment guide written

## Your Deployment Steps

### Option A: Digital Ocean App Platform (Easiest)

- [ ] 1. Commit and push all changes to GitHub
- [ ] 2. Go to https://cloud.digitalocean.com/apps
- [ ] 3. Click "Create App" → Choose GitHub
- [ ] 4. Select your repository
- [ ] 5. Configure build settings:
  - Type: Web Service
  - Dockerfile Path: `Dockerfile`
  - HTTP Port: 10000
- [ ] 6. Add environment variables (see below)
- [ ] 7. Choose plan (Basic $5/month recommended)
- [ ] 8. Deploy and wait 5-10 minutes
- [ ] 9. Get your app URL
- [ ] 10. Update frontend .env with new URL
- [ ] 11. Redeploy frontend to Vercel
- [ ] 12. Test everything works!

### Option B: Digital Ocean Droplet (More Control)

- [ ] 1. Create Ubuntu 22.04 droplet ($6/month)
- [ ] 2. SSH into droplet
- [ ] 3. Install Docker and Docker Compose
- [ ] 4. Clone your repository
- [ ] 5. Create .env file with your values
- [ ] 6. Run: `docker-compose up -d --build`
- [ ] 7. (Optional) Setup Nginx reverse proxy
- [ ] 8. (Optional) Setup SSL with Let's Encrypt
- [ ] 9. Configure firewall
- [ ] 10. Update frontend .env with droplet IP/domain
- [ ] 11. Redeploy frontend to Vercel
- [ ] 12. Test everything works!

## Environment Variables to Set

```env
NODE_ENV=production
PORT=10000
HOST=0.0.0.0
LOG_LEVEL=info
LIGMA_SYNC_PATH=/ligma-sync
JWT_SECRET=<generate-a-strong-secret-key>
DO_AI_API_KEY=<your-digitalocean-api-key>
DO_AI_MODEL=llama3-8b-instruct
DO_AI_ENDPOINT=https://api.digitalocean.com/v2/ai/chat/completions
```

### Generate JWT Secret

Run this in terminal:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Or use this online: https://www.uuidgenerator.net/

## Testing Checklist

After deployment:

- [ ] Health endpoint works: `curl https://your-url.com/health`
- [ ] Returns: `{"ok":true,"rooms":0,"uptime_s":...}`
- [ ] Frontend loads without errors
- [ ] Can create/join rooms
- [ ] WebSocket connects (check browser console)
- [ ] Real-time collaboration works (test with 2 windows)
- [ ] Can see other users' cursors
- [ ] Drawing syncs in real-time
- [ ] Task board updates live
- [ ] Event log updates live

## Frontend Update

After backend is deployed, update `apps/web/.env`:

```env
VITE_API_URL=https://your-digitalocean-url.com
VITE_LIGMA_SYNC_URL=wss://your-digitalocean-url.com/ligma-sync
```

Then:
```bash
cd apps/web
npm run build
git add .
git commit -m "Update API URLs for production"
git push
```

Vercel will auto-deploy.

## Monitoring

- [ ] Set up uptime monitoring (UptimeRobot, Pingdom, etc.)
- [ ] Configure log aggregation
- [ ] Set up alerts for errors
- [ ] Schedule database backups

## Documentation

All guides available:
- `DIGITALOCEAN_DEPLOYMENT.md` - Complete deployment guide
- `DEPLOYMENT.md` - General deployment info
- `README.md` - Project overview

## Quick Commands

### Local Testing
```bash
# Windows
deploy.bat

# Linux/Mac
./deploy.sh
```

### View Logs
```bash
docker-compose logs -f
```

### Restart
```bash
docker-compose restart
```

### Stop
```bash
docker-compose down
```

### Rebuild
```bash
docker-compose up -d --build
```

## Troubleshooting

If something doesn't work:

1. Check logs: `docker-compose logs -f`
2. Verify .env file has all required variables
3. Test health endpoint
4. Check firewall settings
5. Verify WebSocket connection in browser console
6. Review `DIGITALOCEAN_DEPLOYMENT.md` troubleshooting section

## Support Resources

- Digital Ocean Docs: https://docs.digitalocean.com/
- Docker Docs: https://docs.docker.com/
- Your deployment guide: `DIGITALOCEAN_DEPLOYMENT.md`

---

## Summary

✅ **Everything is ready for Digital Ocean deployment!**

Your app includes:
- Production-ready Dockerfile
- Docker Compose configuration
- Environment variable templates
- Deployment scripts
- Comprehensive documentation
- Health checks
- WebSocket support
- Database persistence

Just follow the checklist above and you'll be deployed in minutes! 🚀
