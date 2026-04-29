# Ligma Deployment Guide

## Important Note About WebSockets

**Vercel Limitation**: Vercel's serverless functions do not support WebSocket connections, which are essential for real-time collaboration in Ligma. The WebSocket sync feature (`/ligma-sync`) will not work on Vercel.

## Recommended Deployment Options

### Option 1: Split Deployment (Recommended for Vercel)

1. **Frontend on Vercel** (already working)
   - Deploy `apps/web` to Vercel
   - Set environment variable: `VITE_LIGMA_SYNC_URL=<your-backend-url>`

2. **Backend on Railway/Render/Fly.io** (supports WebSockets)
   - Deploy `apps/server` to Railway, Render, or Fly.io
   - These platforms support long-running processes and WebSockets
   - Set environment variables as needed

### Option 2: Full Stack on Railway/Render/Fly.io

Deploy the entire monorepo to a platform that supports WebSockets:

#### Railway Deployment
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Deploy
railway up
```

#### Render Deployment
1. Connect your GitHub repository
2. Create a new Web Service
3. Build command: `npm install && cd apps/server && npm install && npm run build`
4. Start command: `cd apps/server && npm start`
5. Add environment variables

#### Fly.io Deployment
```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Launch app
fly launch

# Deploy
fly deploy
```

## Current Vercel Setup (HTTP API Only)

The current `vercel.json` configuration deploys the HTTP API endpoints only:
- ✅ `/api/*` - Authentication, rooms, AI summary
- ✅ `/health`, `/healthz`, `/readyz` - Health checks
- ❌ `/ligma-sync` - WebSocket endpoint (NOT SUPPORTED)

### To Deploy Backend to Vercel (Limited Functionality)

1. Build the server:
```bash
cd apps/server
npm install
npm run build:vercel
```

2. Deploy to Vercel:
```bash
vercel --prod
```

3. Note: Real-time collaboration will not work without WebSockets

## Environment Variables

### Frontend (.env in apps/web)
```env
VITE_LIGMA_SYNC_URL=wss://your-backend-url.com/ligma-sync
VITE_API_URL=https://your-backend-url.com
```

### Backend (.env in apps/server)
```env
PORT=10000
HOST=0.0.0.0
LOG_LEVEL=info
LIGMA_SYNC_PATH=/ligma-sync
JWT_SECRET=your-secret-key-here
DATABASE_PATH=./data/ligma.db
```

## Testing Deployment

After deployment, test these endpoints:

1. Health check: `https://your-backend-url.com/health`
2. API endpoint: `https://your-backend-url.com/api/rooms`
3. WebSocket (if supported): Connect to `wss://your-backend-url.com/ligma-sync`

## Troubleshooting

### "Cannot GET /" or showing source code
- Make sure the build completed successfully
- Check that `dist/` directory exists in `apps/server`
- Verify `vercel.json` configuration

### WebSocket connection fails
- Vercel does not support WebSockets
- Deploy backend to Railway, Render, or Fly.io instead

### Database errors
- Ensure SQLite database is properly initialized
- Check file permissions for `data/ligma.db`
- For serverless, consider using a hosted database (PostgreSQL, MySQL)
