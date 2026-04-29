# Fix Vercel Backend Deployment

## The Problem
Your backend at `https://ligma-backend.vercel.app/` is showing source code instead of running because:
1. Vercel doesn't support long-running Node.js servers
2. Vercel doesn't support WebSockets (needed for real-time collaboration)
3. The deployment needs to be configured as serverless functions

## Solution: Use a Different Platform for Backend

**Vercel is NOT suitable for this backend** because it requires WebSockets for real-time collaboration.

### Recommended: Deploy Backend to Railway (Free & Easy)

#### Step 1: Install Railway CLI
```bash
npm install -g @railway/cli
```

#### Step 2: Login to Railway
```bash
railway login
```

#### Step 3: Deploy
```bash
# From the root of your project
cd apps/server
railway init
railway up
```

#### Step 4: Set Environment Variables in Railway Dashboard
- `PORT` = 10000
- `HOST` = 0.0.0.0
- `JWT_SECRET` = your-secret-key
- `NODE_ENV` = production

#### Step 5: Get Your Railway URL
Railway will give you a URL like: `https://your-app.railway.app`

### Alternative: Deploy to Render.com

1. Go to https://render.com
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Configure:
   - **Root Directory**: `apps/server`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Environment**: Node
5. Add environment variables (same as above)
6. Click "Create Web Service"

### Alternative: Deploy to Fly.io

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# From apps/server directory
cd apps/server
fly launch

# Follow prompts, then deploy
fly deploy
```

## Update Frontend to Use New Backend

Once your backend is deployed to Railway/Render/Fly.io:

1. Get your backend URL (e.g., `https://your-app.railway.app`)

2. Update `apps/web/.env`:
```env
VITE_API_URL=https://your-app.railway.app
VITE_LIGMA_SYNC_URL=wss://your-app.railway.app/ligma-sync
```

3. Rebuild and redeploy frontend to Vercel:
```bash
cd apps/web
npm run build
vercel --prod
```

## Testing Your Deployment

### Test Backend Health
```bash
curl https://your-backend-url.com/health
```

Should return:
```json
{
  "ok": true,
  "rooms": 0,
  "uptime_s": 123
}
```

### Test WebSocket Connection
Open browser console on your frontend and check for:
- ✅ "WebSocket connection established"
- ❌ "WebSocket connection failed" (means backend not accessible)

## Why Not Vercel for Backend?

| Feature | Vercel | Railway/Render/Fly.io |
|---------|--------|----------------------|
| HTTP API | ✅ Yes | ✅ Yes |
| WebSockets | ❌ No | ✅ Yes |
| Long-running processes | ❌ No | ✅ Yes |
| SQLite database | ⚠️ Ephemeral | ✅ Persistent |
| Real-time collaboration | ❌ No | ✅ Yes |

## Quick Start: Railway Deployment (Recommended)

```bash
# 1. Install Railway CLI
npm install -g @railway/cli

# 2. Login
railway login

# 3. Go to server directory
cd apps/server

# 4. Initialize and deploy
railway init
railway up

# 5. Add environment variables in Railway dashboard
# Visit: https://railway.app/dashboard

# 6. Get your URL from Railway dashboard
# It will look like: https://ligma-backend-production-xxxx.up.railway.app

# 7. Update frontend .env with this URL
# Then redeploy frontend to Vercel
```

## Cost Comparison

- **Railway**: $5/month (includes 500 hours, more than enough)
- **Render**: Free tier available (spins down after inactivity)
- **Fly.io**: Free tier available (3 shared VMs)
- **Vercel**: Not suitable for this backend

## Need Help?

If you still want to try Vercel (limited functionality, no WebSockets):
1. The current setup will work for HTTP API only
2. Real-time collaboration will NOT work
3. Users won't see each other's cursors or live updates
4. It's only useful for testing API endpoints

For production with full features, use Railway/Render/Fly.io.
