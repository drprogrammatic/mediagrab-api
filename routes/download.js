// ============================================
// Download Routes — YouTube + Social Media
// YouTube: uses @distube/ytdl-core (no bot detection)
// Social Media: uses yt-dlp
// ============================================

const express = require('express');
const router = express.Router();
const ytdl = require('@distube/ytdl-core');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Temp directory for downloads
const TEMP_DIR = path.join(os.tmpdir(), 'mediagrab-downloads');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// yt-dlp binary path (for social media)
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';

// Platform detection
const PLATFORM_PATTERNS = {
    youtube: /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)\//i,
    instagram: /^(https?:\/\/)?(www\.)?instagram\.com\//i,
    twitter: /^(https?:\/\/)?(www\.)?(twitter\.com|x\.com)\//i,
    pinterest: /^(https?:\/\/)?(www\.)?pinterest\.(com|co)\//i,
    tiktok: /^(https?:\/\/)?(www\.)?(tiktok\.com|vm\.tiktok\.com)\//i,
    facebook: /^(https?:\/\/)?(www\.)?(facebook\.com|fb\.watch)\//i,
};

function detectPlatform(url) {
    for (const [platform, pattern] of Object.entries(PLATFORM_PATTERNS)) {
        if (pattern.test(url)) return platform;
    }
    return null;
}

function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().substring(0, 200);
}

function formatDuration(seconds) {
    if (!seconds) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// =============================================
// GET /api/info — Fetch video metadata
// =============================================
router.get('/info', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing "url" parameter' });

    const platform = detectPlatform(url);
    if (!platform) return res.status(400).json({ error: 'Unsupported URL' });

    try {
        let data;
        if (platform === 'youtube') {
            data = await getYouTubeInfo(url);
        } else {
            data = await getYtdlpInfo(url);
        }
        res.json({ success: true, platform, data });
    } catch (err) {
        console.error('Info error:', err.message);
        res.status(500).json({ error: 'Failed to fetch video info: ' + err.message });
    }
});

// =============================================
// GET /api/download — Download video
// =============================================
router.get('/download', async (req, res) => {
    const { url, format } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing "url" parameter' });

    const platform = detectPlatform(url);
    if (!platform) return res.status(400).json({ error: 'Unsupported URL' });

    try {
        if (platform === 'youtube') {
            await downloadYouTube(url, format || 'mp4-best', res);
        } else {
            await downloadWithYtdlp(url, format || 'mp4-best', res);
        }
    } catch (err) {
        console.error('Download error:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Download failed: ' + err.message });
        }
    }
});

// =============================================
// GET /api/download-audio — Extract audio
// =============================================
router.get('/download-audio', async (req, res) => {
    const { url, format } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing "url" parameter' });

    const platform = detectPlatform(url);

    try {
        if (platform === 'youtube') {
            await downloadYouTubeAudio(url, res);
        } else {
            await downloadAudioWithYtdlp(url, format || 'mp3', res);
        }
    } catch (err) {
        console.error('Audio download error:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Audio download failed: ' + err.message });
        }
    }
});

// =============================================
// YOUTUBE — via @distube/ytdl-core
// =============================================

async function getYouTubeInfo(url) {
    const info = await ytdl.getInfo(url);
    const details = info.videoDetails;

    // Build format list
    const formats = info.formats
        .filter(f => f.contentLength)
        .map(f => ({
            format_id: f.itag.toString(),
            ext: f.container || 'mp4',
            resolution: f.qualityLabel || (f.hasVideo ? 'unknown' : 'audio only'),
            filesize: parseInt(f.contentLength) || 0,
            hasVideo: f.hasVideo,
            hasAudio: f.hasAudio,
            quality: f.quality,
            qualityLabel: f.qualityLabel || '',
            mimeType: f.mimeType || '',
        }));

    return {
        title: details.title || 'Unknown',
        description: (details.description || '').substring(0, 500),
        thumbnail: details.thumbnails?.length
            ? details.thumbnails[details.thumbnails.length - 1].url
            : '',
        duration: parseInt(details.lengthSeconds) || 0,
        duration_string: formatDuration(parseInt(details.lengthSeconds)),
        uploader: details.author?.name || details.ownerChannelName || '',
        view_count: parseInt(details.viewCount) || 0,
        webpage_url: details.video_url || url,
        formats,
    };
}

async function downloadYouTube(url, format, res) {
    const info = await ytdl.getInfo(url);
    const title = sanitizeFilename(info.videoDetails.title || 'video');

    let options = {};
    let ext = 'mp4';

    switch (format) {
        case 'mp4-4k':
            options = { quality: 'highestvideo', filter: f => f.container === 'mp4' && f.hasVideo };
            break;
        case 'mp4-1080':
            options = { quality: 'highestvideo', filter: f => f.container === 'mp4' && f.hasVideo && f.height <= 1080 };
            break;
        case 'mp4-720':
            options = { quality: 'highestvideo', filter: f => f.container === 'mp4' && f.hasVideo && f.height <= 720 };
            break;
        case 'mp4-480':
            options = { quality: 'highestvideo', filter: f => f.container === 'mp4' && f.hasVideo && f.height <= 480 };
            break;
        case 'mp4-360':
            options = { quality: 'highestvideo', filter: f => f.container === 'mp4' && f.hasVideo && f.height <= 360 };
            break;
        case 'webm-1080':
            options = { quality: 'highestvideo', filter: f => f.container === 'webm' && f.hasVideo };
            ext = 'webm';
            break;
        case 'mp4-best':
        default:
            options = { quality: 'highest', filter: 'audioandvideo' };
            break;
    }

    res.setHeader('Content-Disposition', `attachment; filename="${title}.${ext}"`);
    res.setHeader('Content-Type', ext === 'webm' ? 'video/webm' : 'video/mp4');

    const stream = ytdl(url, options);
    stream.pipe(res);

    stream.on('error', (err) => {
        console.error('ytdl stream error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Download stream error: ' + err.message });
        }
    });

    req = res.req;
    req.on('close', () => {
        stream.destroy();
    });
}

async function downloadYouTubeAudio(url, res) {
    const info = await ytdl.getInfo(url);
    const title = sanitizeFilename(info.videoDetails.title || 'audio');

    res.setHeader('Content-Disposition', `attachment; filename="${title}.mp3"`);
    res.setHeader('Content-Type', 'audio/mpeg');

    const stream = ytdl(url, {
        quality: 'highestaudio',
        filter: 'audioonly',
    });

    stream.pipe(res);

    stream.on('error', (err) => {
        console.error('ytdl audio stream error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Audio stream error: ' + err.message });
        }
    });
}

// =============================================
// SOCIAL MEDIA — via yt-dlp
// =============================================

async function getYtdlpInfo(url) {
    return new Promise((resolve, reject) => {
        const args = ['--dump-json', '--no-warnings', '--no-playlist', url];
        let output = '';
        let errorOutput = '';

        const proc = spawn(YTDLP, args);
        proc.stdout.on('data', d => output += d.toString());
        proc.stderr.on('data', d => errorOutput += d.toString());

        proc.on('error', () => reject(new Error('yt-dlp not found. Install with: pip install yt-dlp')));

        proc.on('close', code => {
            if (code === 0) {
                try {
                    const json = JSON.parse(output);
                    resolve({
                        title: json.title || 'Unknown',
                        description: (json.description || '').substring(0, 500),
                        thumbnail: json.thumbnail || '',
                        duration: json.duration || 0,
                        duration_string: json.duration_string || '',
                        uploader: json.uploader || '',
                        view_count: json.view_count || 0,
                        webpage_url: json.webpage_url || url,
                        formats: (json.formats || []).slice(0, 20).map(f => ({
                            format_id: f.format_id,
                            ext: f.ext,
                            resolution: f.resolution || 'audio only',
                            filesize: f.filesize || f.filesize_approx || 0,
                        })),
                    });
                } catch (e) {
                    reject(new Error('Failed to parse video info'));
                }
            } else {
                reject(new Error(errorOutput || 'yt-dlp failed'));
            }
        });
    });
}

async function downloadWithYtdlp(url, format, res) {
    const info = await getYtdlpInfo(url);
    const title = sanitizeFilename(info.title || 'download');

    const args = ['--no-warnings', '--no-playlist', '-o', '-'];

    switch (format) {
        case 'mp4-best':
        default:
            args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best');
            break;
        case 'mp4-sd':
            args.push('-f', 'bestvideo[height<=480][ext=mp4]+bestaudio/best[height<=480]');
            break;
    }
    args.push(url);

    res.setHeader('Content-Disposition', `attachment; filename="${title}.mp4"`);
    res.setHeader('Content-Type', 'video/mp4');

    const proc = spawn(YTDLP, args);
    proc.stdout.pipe(res);
    proc.stderr.on('data', d => console.log('yt-dlp:', d.toString()));

    proc.on('error', err => {
        if (!res.headersSent) res.status(500).json({ error: 'yt-dlp not found' });
    });

    proc.on('close', code => {
        if (code !== 0 && !res.headersSent) {
            res.status(500).json({ error: 'Download failed' });
        }
    });

    res.req.on('close', () => proc.kill('SIGTERM'));
}

async function downloadAudioWithYtdlp(url, format, res) {
    const info = await getYtdlpInfo(url);
    const title = sanitizeFilename(info.title || 'audio');
    const tempId = Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    const tempFile = path.join(TEMP_DIR, `${tempId}.%(ext)s`);

    const args = [
        '--no-warnings', '--no-playlist',
        '-x', '--audio-format', format || 'mp3',
        '--audio-quality', '0',
        '-o', tempFile,
        url,
    ];

    const proc = spawn(YTDLP, args);
    let errorOutput = '';
    proc.stderr.on('data', d => { errorOutput += d.toString(); });

    proc.on('error', () => {
        if (!res.headersSent) res.status(500).json({ error: 'yt-dlp not found' });
    });

    proc.on('close', code => {
        if (code !== 0) {
            if (!res.headersSent) res.status(500).json({ error: 'Audio extraction failed: ' + errorOutput });
            return;
        }

        // Find output file
        const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(tempId));
        if (files.length === 0) {
            if (!res.headersSent) res.status(500).json({ error: 'Output file not found' });
            return;
        }

        const outputFile = path.join(TEMP_DIR, files[0]);
        const ext = path.extname(files[0]).slice(1) || 'mp3';

        res.setHeader('Content-Disposition', `attachment; filename="${title}.${ext}"`);
        res.setHeader('Content-Type', 'audio/mpeg');

        const stream = fs.createReadStream(outputFile);
        stream.pipe(res);
        stream.on('end', () => fs.unlink(outputFile, () => { }));
        stream.on('error', () => {
            if (!res.headersSent) res.status(500).json({ error: 'File streaming error' });
            fs.unlink(outputFile, () => { });
        });
    });
}

// Cleanup old temp files every minute
setInterval(() => {
    try {
        const now = Date.now();
        fs.readdirSync(TEMP_DIR).forEach(file => {
            const fp = path.join(TEMP_DIR, file);
            if (now - fs.statSync(fp).mtimeMs > 5 * 60 * 1000) fs.unlinkSync(fp);
        });
    } catch (e) { }
}, 60000);

module.exports = router;
