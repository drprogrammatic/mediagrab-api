// ============================================
// Download Routes — YouTube + Social Media
// Uses yt-dlp for all platforms
// ============================================

const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Temp directory for downloads
const TEMP_DIR = path.join(os.tmpdir(), 'mediagrab-downloads');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// yt-dlp binary path
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';

// Supported platforms
const SUPPORTED_PLATFORMS = {
    youtube: /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i,
    instagram: /^(https?:\/\/)?(www\.)?instagram\.com\//i,
    twitter: /^(https?:\/\/)?(www\.)?(twitter\.com|x\.com)\//i,
    pinterest: /^(https?:\/\/)?(www\.)?pinterest\.(com|co)\//i,
    tiktok: /^(https?:\/\/)?(www\.)?(tiktok\.com|vm\.tiktok\.com)\//i,
    facebook: /^(https?:\/\/)?(www\.)?(facebook\.com|fb\.watch)\//i,
};

function detectPlatform(url) {
    for (const [platform, pattern] of Object.entries(SUPPORTED_PLATFORMS)) {
        if (pattern.test(url)) return platform;
    }
    return null;
}

function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*]/g, '').substring(0, 200);
}

// ===== GET /api/info =====
// Fetch video metadata without downloading
router.get('/info', async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'Missing "url" parameter' });
    }

    const platform = detectPlatform(url);
    if (!platform) {
        return res.status(400).json({ error: 'Unsupported URL. Supported: YouTube, Instagram, Twitter/X, Pinterest, TikTok, Facebook' });
    }

    try {
        const info = await getVideoInfo(url);
        res.json({
            success: true,
            platform,
            data: info,
        });
    } catch (err) {
        console.error('Info error:', err.message);
        res.status(500).json({ error: 'Failed to fetch video info: ' + err.message });
    }
});

// ===== GET /api/formats =====
// Get available formats for a video
router.get('/formats', async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'Missing "url" parameter' });
    }

    try {
        const formats = await getVideoFormats(url);
        res.json({ success: true, formats });
    } catch (err) {
        console.error('Formats error:', err.message);
        res.status(500).json({ error: 'Failed to fetch formats: ' + err.message });
    }
});

// ===== GET /api/download =====
// Download video and stream it to the client
router.get('/download', async (req, res) => {
    const { url, format, quality } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'Missing "url" parameter' });
    }

    const platform = detectPlatform(url);
    if (!platform) {
        return res.status(400).json({ error: 'Unsupported URL' });
    }

    try {
        // Get video info first for the filename
        const info = await getVideoInfo(url);
        const title = sanitizeFilename(info.title || 'download');
        const ext = getExtensionForFormat(format || 'mp4');

        // Set response headers for file download
        res.setHeader('Content-Disposition', `attachment; filename="${title}.${ext}"`);
        res.setHeader('Content-Type', getContentType(ext));

        // Build yt-dlp arguments
        const args = buildDownloadArgs(url, format, quality);

        // Stream download to response
        const ytdlp = spawn(YTDLP, args);

        ytdlp.stdout.pipe(res);

        ytdlp.stderr.on('data', (data) => {
            console.log('yt-dlp:', data.toString());
        });

        ytdlp.on('error', (err) => {
            console.error('yt-dlp spawn error:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Download failed: yt-dlp not found. Make sure yt-dlp is installed.' });
            }
        });

        ytdlp.on('close', (code) => {
            if (code !== 0 && !res.headersSent) {
                res.status(500).json({ error: `Download failed with exit code ${code}` });
            }
        });

        // Handle client disconnect
        req.on('close', () => {
            ytdlp.kill('SIGTERM');
        });

    } catch (err) {
        console.error('Download error:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Download failed: ' + err.message });
        }
    }
});

// ===== Helper Functions =====

function getVideoInfo(url) {
    return new Promise((resolve, reject) => {
        const args = [
            '--dump-json',
            '--no-warnings',
            '--no-playlist',
            url,
        ];

        let output = '';
        let errorOutput = '';

        const proc = spawn(YTDLP, args);

        proc.stdout.on('data', (data) => {
            output += data.toString();
        });

        proc.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        proc.on('error', (err) => {
            reject(new Error('yt-dlp not found. Please install yt-dlp: pip install yt-dlp'));
        });

        proc.on('close', (code) => {
            if (code === 0) {
                try {
                    const json = JSON.parse(output);
                    resolve({
                        title: json.title || 'Unknown',
                        description: json.description || '',
                        thumbnail: json.thumbnail || '',
                        duration: json.duration || 0,
                        duration_string: json.duration_string || '',
                        uploader: json.uploader || '',
                        view_count: json.view_count || 0,
                        like_count: json.like_count || 0,
                        webpage_url: json.webpage_url || url,
                        formats: (json.formats || []).map(f => ({
                            format_id: f.format_id,
                            ext: f.ext,
                            resolution: f.resolution || 'audio only',
                            filesize: f.filesize || f.filesize_approx || 0,
                            vcodec: f.vcodec,
                            acodec: f.acodec,
                            tbr: f.tbr,
                            format_note: f.format_note || '',
                        })).filter(f => f.filesize > 0 || f.tbr > 0),
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

function getVideoFormats(url) {
    return new Promise((resolve, reject) => {
        const args = [
            '--list-formats',
            '--no-warnings',
            '--no-playlist',
            url,
        ];

        let output = '';

        const proc = spawn(YTDLP, args);

        proc.stdout.on('data', (data) => {
            output += data.toString();
        });

        proc.on('error', (err) => {
            reject(new Error('yt-dlp not found'));
        });

        proc.on('close', (code) => {
            if (code === 0) {
                resolve(output);
            } else {
                reject(new Error('Failed to list formats'));
            }
        });
    });
}

function buildDownloadArgs(url, format, quality) {
    const args = [
        '--no-warnings',
        '--no-playlist',
        '-o', '-', // Output to stdout for streaming
    ];

    // Format selection
    switch (format) {
        case 'mp3':
        case 'mp3-320':
            args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
            // Can't pipe to stdout with audio conversion, use temp file approach
            return buildTempFileArgs(url, 'mp3', '0');

        case 'mp3-128':
            return buildTempFileArgs(url, 'mp3', '128K');

        case 'mp4-4k':
            args.push('-f', 'bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/best[height<=2160][ext=mp4]/best');
            break;

        case 'mp4-1080':
            args.push('-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best');
            break;

        case 'mp4-720':
            args.push('-f', 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best');
            break;

        case 'mp4-480':
            args.push('-f', 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best');
            break;

        case 'mp4-360':
            args.push('-f', 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360][ext=mp4]/best');
            break;

        case 'webm-1080':
            args.push('-f', 'bestvideo[height<=1080][ext=webm]+bestaudio[ext=webm]/best[ext=webm]/best');
            break;

        case 'mp4-best':
        default:
            args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best');
            break;

        case 'mp4-sd':
            args.push('-f', 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]');
            break;

        case 'jpg':
            args.push('--write-thumbnail', '--skip-download', '--convert-thumbnails', 'jpg');
            break;
    }

    args.push(url);
    return args;
}

// For audio extraction, yt-dlp needs to write to a file first, then we stream it
function buildTempFileArgs(url, audioFormat, quality) {
    const tempFile = path.join(TEMP_DIR, `${Date.now()}_%(title)s.%(ext)s`);
    return [
        '--no-warnings',
        '--no-playlist',
        '-x',
        '--audio-format', audioFormat,
        '--audio-quality', quality,
        '-o', tempFile,
        url,
        '--print', 'after_move:filepath', // Print the final file path
    ];
}

function getExtensionForFormat(format) {
    if (format.startsWith('mp3')) return 'mp3';
    if (format.startsWith('webm')) return 'webm';
    if (format === 'wav') return 'wav';
    if (format === 'jpg') return 'jpg';
    return 'mp4';
}

function getContentType(ext) {
    const types = {
        mp4: 'video/mp4',
        webm: 'video/webm',
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        jpg: 'image/jpeg',
        png: 'image/png',
    };
    return types[ext] || 'application/octet-stream';
}

// ===== Download with temp file (for audio extraction) =====
router.get('/download-audio', async (req, res) => {
    const { url, format, quality } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'Missing "url" parameter' });
    }

    const audioFormat = format || 'mp3';
    const audioQuality = quality || '0';
    const tempId = Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    const tempFile = path.join(TEMP_DIR, `${tempId}.%(ext)s`);

    const args = [
        '--no-warnings',
        '--no-playlist',
        '-x',
        '--audio-format', audioFormat,
        '--audio-quality', audioQuality,
        '-o', tempFile,
        url,
    ];

    try {
        // Get title for filename
        const info = await getVideoInfo(url);
        const title = sanitizeFilename(info.title || 'audio');

        const proc = spawn(YTDLP, args);
        let errorOutput = '';

        proc.stderr.on('data', (data) => {
            errorOutput += data.toString();
            console.log('yt-dlp:', data.toString());
        });

        proc.on('error', (err) => {
            if (!res.headersSent) {
                res.status(500).json({ error: 'yt-dlp not found' });
            }
        });

        proc.on('close', (code) => {
            if (code !== 0) {
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Audio extraction failed: ' + errorOutput });
                }
                return;
            }

            // Find the output file
            const expectedFile = tempFile.replace('%(ext)s', audioFormat);

            // Search for the file (yt-dlp may name it slightly differently)
            const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(tempId));
            const outputFile = files.length > 0
                ? path.join(TEMP_DIR, files[0])
                : expectedFile;

            if (!fs.existsSync(outputFile)) {
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Output file not found' });
                }
                return;
            }

            // Stream the file
            res.setHeader('Content-Disposition', `attachment; filename="${title}.${audioFormat}"`);
            res.setHeader('Content-Type', getContentType(audioFormat));

            const stream = fs.createReadStream(outputFile);
            stream.pipe(res);
            stream.on('end', () => {
                // Clean up temp file
                fs.unlink(outputFile, () => { });
            });
            stream.on('error', (err) => {
                if (!res.headersSent) {
                    res.status(500).json({ error: 'File streaming error' });
                }
                fs.unlink(outputFile, () => { });
            });
        });
    } catch (err) {
        console.error('Download audio error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    }
});

// ===== Cleanup old temp files periodically =====
setInterval(() => {
    try {
        const files = fs.readdirSync(TEMP_DIR);
        const now = Date.now();
        files.forEach(file => {
            const filePath = path.join(TEMP_DIR, file);
            const stat = fs.statSync(filePath);
            // Remove files older than 5 minutes
            if (now - stat.mtimeMs > 5 * 60 * 1000) {
                fs.unlinkSync(filePath);
            }
        });
    } catch (e) {
        // Ignore cleanup errors
    }
}, 60 * 1000); // Run every minute

module.exports = router;
