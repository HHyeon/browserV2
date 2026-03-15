const express = require('express');
const cors = require('cors');

const fs = require('fs');
const path = require('path');
const app = express();
const port = 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));


// Middleware to parse JSON request bodies
app.use(express.json());

// Ensure the thumbnails directory exists
const thumbnailsDir = path.join(__dirname, 'thumbnails');
if (!fs.existsSync(thumbnailsDir)) {
    fs.mkdirSync(thumbnailsDir, { recursive: true });
}

// Route to save thumbnail to server disk
app.post('/save-thumbnail', (req, res) => {
    try {
        const { videoPath, thumbnailData } = req.body;

        // console.log('Received thumbnail data for video:', videoPath);
        
        if (!videoPath || !thumbnailData) {
            return res.status(400).json({ error: 'Missing videoPath or thumbnailData' });
        }

        // Extract video name without extension
        const videoName = path.basename(videoPath);
        const thumbnailFileName = `${videoName}.jpg`;
        const thumbnailPath = path.join(thumbnailsDir, thumbnailFileName);

        // Convert Base64 data to binary and write to file
        const base64Data = thumbnailData.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        fs.writeFileSync(thumbnailPath, buffer);

        res.json({
            success: true,
            thumbnailPath: `/thumbnails/${thumbnailFileName}`
        });
    } catch (error) {
        console.error('Error saving thumbnail:', error);
        res.status(500).json({ error: 'Failed to save thumbnail' });
    }
});

app.get('/thumbnail-exists', (req, res) => {

    const videoPath = req.query.videoPath;

    if (!videoPath) {
        return res.status(400).json({
            error: "videoPath parameter required"
        });
    }

    const videoName = path.basename(videoPath, path.extname(videoPath));
    const thumbnailFileName = `${videoName}.jpg`;
    const thumbnailPath = path.join(thumbnailsDir, thumbnailFileName);

    const exists = fs.existsSync(thumbnailPath);

    res.json({
        exists: exists,
        thumbnailPath: `/thumbnails/${thumbnailFileName}`
    });
});

// Start the server
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log('Use POST /save-thumbnail to upload thumbnails');
});
