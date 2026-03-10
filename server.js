// ============================================
// MediaGrab Backend — Main Server
// ============================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const downloadRoutes = require('./routes/download');

const app = express();
const PORT = process.env.PORT || 3001;

// ===== CORS (must be BEFORE helmet and other middleware) =====
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Handle preflight requests explicitly
app.options('*', cors());

// ===== Security =====
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: false,
}));

// ===== Rate Limiting =====
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute per IP
    message: { error: 'Too many requests. Please wait a minute and try again.' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(limiter);

// ===== Body Parser =====
app.use(express.json());

// ===== Health Check =====
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'MediaGrab API',
        timestamp: new Date().toISOString(),
    });
});

// ===== Download Routes =====
app.use('/api', downloadRoutes);

// ===== 404 Handler =====
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// ===== Error Handler =====
app.use((err, req, res, next) => {
    console.error('Server error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// ===== Start Server =====
app.listen(PORT, () => {
    console.log(`\n🚀 MediaGrab API running on port ${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/api/health`);
    console.log(`   Info:   http://localhost:${PORT}/api/info?url=<video_url>`);
    console.log(`   Download: http://localhost:${PORT}/api/download?url=<video_url>&format=mp4\n`);
});
