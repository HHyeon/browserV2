const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const pLimit = require('p-limit').default || require('p-limit');

const app = express();
const port = 3002;
const limit = pLimit(8);

app.use(cors());
app.use(express.json({ limit: '50mb' }));

let completedCount = 0;
setInterval(() => {
    if (completedCount > 0) {
        console.log(`[${new Date().toISOString()}] Decoded: ${completedCount} videos/sec`);
        completedCount = 0;
    }
}, 1000);

function decodeVideo(videoPath, seekTime) {
    return new Promise((resolve, reject) => {
        const ffmpegArgs = [
            '-hwaccel', 'videotoolbox',
            '-ss', seekTime.toString(),
            '-i', videoPath,
            '-frames:v', '1',
            '-q:v', '2',
            '-vf', 'scale=1280:-1:force_original_aspect_ratio=decrease',
            '-f', 'image2pipe',
            '-'
        ];

        const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
            stdio: ['ignore', 'pipe', 'ignore']
        });

        const chunks = [];

        ffmpeg.stdout.on('data', (data) => {
            chunks.push(data);
        });

        ffmpeg.on('error', (error) => {
            reject(new Error(error.message));
        });

        let responseSent = false;

        ffmpeg.on('close', (code) => {
            if (responseSent) return;
            responseSent = true;
            clearTimeout(timeout);

            if (code === 0) {
                const buffer = Buffer.concat(chunks);
                const base64 = 'data:image/jpeg;base64,' + buffer.toString('base64');
                completedCount++;
                resolve({ success: true, base64 });
            } else {
                reject(new Error('FFmpeg exited with code ' + code));
            }
        });

        const timeout = setTimeout(() => {
            if (responseSent) return;
            responseSent = true;
            ffmpeg.kill();
            reject(new Error('Timeout'));
        }, 30000);
    });
}

app.post('/decode', async (req, res) => {
    let { videoPath, seekTime } = req.body;

    if (!videoPath) {
        return res.status(400).json({ error: 'Missing videoPath' });
    }

    if (typeof videoPath !== 'string' || videoPath.length > 4096) {
        return res.status(400).json({ error: 'Invalid videoPath' });
    }

    if (seekTime === undefined || seekTime === null) {
        seekTime = 30;
    }

    seekTime = Number(seekTime);
    if (!Number.isFinite(seekTime) || seekTime < 0) {
        return res.status(400).json({ error: 'Invalid seekTime' });
    }

    console.log(`Processing: ${videoPath} at ${seekTime}s`);

    try {
        const result = await limit(() => decodeVideo(videoPath, seekTime));
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`FFmpeg Server running at http://0.0.0.0:${port}`);
});

