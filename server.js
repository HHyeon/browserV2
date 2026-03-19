const express = require('express');
const cors = require('cors');

const fs = require('fs');
const path = require('path');
const app = express();

const port = 3001;
const listenaddress = '0.0.0.0';

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Middleware to parse JSON request bodies
app.use(express.json());

const thumbnail_store_ext = 'jpg';

// Ensure the thumbnails directory exists
const thumbnailsDir = path.join(__dirname, '.');
if (!fs.existsSync(thumbnailsDir)) {
    fs.mkdirSync(thumbnailsDir, { recursive: true });
}

function return_thumbnailPath(videoPath) {
    const filename = path.basename(videoPath); //path.basename(videoPath, path.extname(videoPath));
    let thumbnailFileName = `${decodeURIComponent(filename)}.${thumbnail_store_ext}`;
    let thumbnailPath = '';
    
    if(videoPath.startsWith('drvs/')) {
        let _videoPath = videoPath.substr('drvs/'.length);

        thumbnailPath = 'drvs/';

        thumbnailPath += _videoPath.substr(0, _videoPath.indexOf('/'));

        thumbnailPath += '/.thumbnails/';
                
        if (!fs.existsSync(thumbnailPath)) {
            fs.mkdirSync(thumbnailPath, { recursive: true });
        }

        thumbnailPath += thumbnailFileName;
    }
    else {
        console.log('using root thumbnailDir');
        thumbnailPath = path.join(thumbnailsDir, thumbnailFileName);
    }

    return thumbnailPath;
}

// Route to save thumbnail to server disk
app.post('/save-thumbnail', (req, res) => {
    try {
        const { videoPath, thumbnailData } = req.body;

        if (!videoPath || !thumbnailData) {
            return res.status(400).json({ error: 'Missing videoPath or thumbnailData' });
        }
				
        let thumbnailPath = return_thumbnailPath(videoPath);

        // Convert Base64 data to binary and write to file
        const base64Data = thumbnailData.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        fs.writeFileSync(thumbnailPath, buffer);

        console.log(`[Thumbnail Saved] ${thumbnailPath}`);

        res.json({
            success: true,
            thumbnailPath: `${thumbnailPath}`
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
    
    let thumbnailPath = return_thumbnailPath(videoPath);
		
    const exists = fs.existsSync(thumbnailPath);
    
    console.log(`[Thumbnail Check] ${thumbnailPath} -> ${exists ? 'Exists' : 'Not Found'}`);

    res.json({
        exists: exists,
        thumbnailPath: `${thumbnailPath}`
    });
});

// Start the server
app.listen(port, listenaddress, () => {
    console.log(`Server running at http://${listenaddress}:${port}`);
});
