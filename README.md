# MediaGrab Backend API

Node.js + Express backend for MediaGrab video downloading.

## Quick Start (Local)

```bash
# Install dependencies
npm install

# Install yt-dlp (requires Python)
pip install yt-dlp

# Copy env file and edit it
cp .env.example .env

# Start server
npm start
```

## Deploy to Render.com (Free)

1. Push this `backend/` folder to a GitHub repo
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Set:
   - **Root Directory**: `backend` (if in a subfolder)
   - **Build Command**: `npm install && pip install yt-dlp`
   - **Start Command**: `node server.js`
5. Add environment variable: `FRONTEND_URL` = your Netlify URL
6. Deploy!

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/info?url=...` | Get video metadata |
| GET | `/api/formats?url=...` | List available formats |
| GET | `/api/download?url=...&format=mp4-1080` | Download video |
| GET | `/api/download-audio?url=...&format=mp3` | Download audio |
