import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Health check endpoint
  if (req.url === '/health' || req.url === '/healthz' || req.url === '/api/health' || req.url === '/api/healthz') {
    return res.status(200).json({
      ok: true,
      rooms: 0,
      uptime_s: Math.floor(process.uptime()),
      note: 'Vercel serverless - WebSockets not supported. Deploy backend to Railway/Render/Fly.io for full functionality.'
    });
  }

  if (req.url === '/readyz' || req.url === '/api/readyz') {
    return res.status(200).json({ ok: true });
  }

  // For other API endpoints, try to load the server
  try {
    const { default: serverHandler } = await import('../apps/server/dist/index.vercel.js');
    return serverHandler(req, res);
  } catch (error: any) {
    console.error('Error loading server:', error);
    return res.status(500).json({ 
      error: 'Server not available',
      message: 'The backend server needs to be built and deployed. Please run: cd apps/server && npm run build:vercel',
      details: error.message,
      note: 'For full functionality with WebSockets, deploy to Railway, Render, or Fly.io'
    });
  }
}
