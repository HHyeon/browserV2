const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const port = 3000;

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
        
        if (!videoPath || !thumbnailData) {
            return res.status(400).json({ error: 'Missing videoPath or thumbnailData' });
        }

        // Extract video name without extension
        const videoName = path.basename(videoPath, path.extname(videoPath));
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

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log('Use POST /save-thumbnail to upload thumbnails');
});
