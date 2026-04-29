# Backend Deployment Solution

## Current Issue
Your backend at `https://ligma-backend.vercel.app/` shows source code because **Vercel cannot run this backend properly**.

## Why Vercel Doesn't Work

Your backend needs:
1. ✅ HTTP API endpoints (Vercel supports this)
2. ❌ **WebSocket connections** (Vercel does NOT support this)
3. ❌ **Long-running server process** (Vercel does NOT support this)
4. ❌ **Persistent SQLite database** (Vercel does NOT support this)

**Result**: Real-time collaboration features will NOT work on Vercel.

## ✅ SOLUTION: Use Railway (Easiest & Free)

### Step-by-Step Railway Deployment

#### 1. Create Railway Account
- Go to https://railway.app
- Sign up with GitHub

#### 2. Deploy from GitHub (Easiest Method)

1. Click "New Project" in Railway dashboard
2. Select "Deploy from GitHub repo"
3. Choose your `Ligma-Hackathon-DevDay` repository
4. Railway will auto-detect it's a Node.js app

#### 3. Configure Build Settings

In Railway dashboard, set:
- **Root Directory**: `apps/server`
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`
- **Watch Paths**: `apps/server/**`

#### 4. Add Environment Variables

In Railway dashboard → Variables tab, add:
```
PORT=10000
HOST=0.0.0.0
JWT_SECRET=your-super-secret-key-change-this
NODE_ENV=production
LOG_LEVEL=info
```

#### 5. Deploy

Railway will automatically deploy. You'll get a URL like:
```
https://ligma-backend-production-xxxx.up.railway.app
```

#### 6. Update Frontend

Update `apps/web/.env`:
```env
VITE_API_URL=https://your-railway-url.railway.app
VITE_LIGMA_SYNC_URL=wss://your-railway-url.railway.app/ligma-sync
```

Then redeploy frontend to Vercel:
```bash
cd apps/web
npm run build
# Push to GitHub, Vercel will auto-deploy
```

### Alternative: Railway CLI Method

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Go to server directory
cd apps/server

# Initialize project
railway init

# Deploy
railway up

# Add environment variables via dashboard
# Get your URL from dashboard
```

## Alternative Platforms

### Render.com (Also Free)

1. Go to https://render.com
2. New → Web Service
3. Connect GitHub repo
4. Settings:
   - Root Directory: `apps/server`
   - Build: `npm install && npm run build`
   - Start: `npm start`
5. Add environment variables
6. Deploy

### Fly.io (Also Free)

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Deploy
cd apps/server
fly launch
fly deploy
```

## Files I Created for You

1. **`vercel.json`** - Vercel config (limited functionality)
2. **`api/index.ts`** - Serverless function for Vercel (HTTP only)
3. **`apps/server/src/index.vercel.ts`** - Vercel-compatible entry point
4. **`DEPLOYMENT.md`** - Full deployment guide
5. **`VERCEL_BACKEND_FIX.md`** - Detailed Vercel issues explanation

## What to Do Next

### Option A: Railway (Recommended - 5 minutes)
1. Go to https://railway.app
2. Sign up with GitHub
3. New Project → Deploy from GitHub
4. Select your repo
5. Configure as shown above
6. Done! ✅

### Option B: Keep Vercel (Limited - Not Recommended)
- Only HTTP API will work
- No real-time collaboration
- No WebSockets
- No live cursors
- No live updates
- Users work in isolation

## Testing Your Deployment

After deploying to Railway/Render/Fly.io:

### 1. Test Health Endpoint
```bash
curl https://your-backend-url.com/health
```

Expected response:
```json
{
  "ok": true,
  "rooms": 0,
  "uptime_s": 123
}
```

### 2. Test WebSocket
Open your frontend in browser, open DevTools Console, look for:
```
✅ WebSocket connection established
✅ Connected to room: ligma-devday-main
```

### 3. Test Real-time Collaboration
1. Open your app in two browser windows
2. Draw something in one window
3. You should see it appear in the other window immediately
4. You should see each other's cursors

## Cost

- **Railway**: Free tier (500 hours/month) - More than enough!
- **Render**: Free tier (spins down after 15 min inactivity)
- **Fly.io**: Free tier (3 shared VMs)

All are FREE for your use case! 🎉

## Summary

❌ **Don't use Vercel for backend** - It won't work properly
✅ **Use Railway** - Takes 5 minutes, works perfectly
✅ **Keep Vercel for frontend** - It's perfect for that

## Need Help?

The files I created will help Vercel work partially, but for full functionality:
**Deploy backend to Railway, Render, or Fly.io**

That's it! Your app will work perfectly with real-time collaboration. 🚀
