<?php
// bookmark_thumb.php
// GET  ?path={video_path}&time={seek_time}  -> cache image return (JPEG, 404 if not found)
// POST ?cache=1 body: {path, time, base64}  -> save cache (base64 -> binary JPEG)
// POST ?remove=1 body: {path, time}         -> remove cache
// POST ?generate=1 body: {path,time} or {id} -> generate thumbnail via FFmpeg
// POST ?generate=1&ALL                       -> generate all bookmark thumbnails

header('X-Content-Type-Options: nosniff');

$cacheDir = __DIR__ . '/bookmark_thumbs';
if (!is_dir($cacheDir)) {
    mkdir($cacheDir, 0755, true);
}

$ffmpegUrl = '';
$configFile = __DIR__ . '/ffmpeg_config.json';
if (file_exists($configFile)) {
    $cfg = json_decode(file_get_contents($configFile), true);
    if (!empty($cfg['ffmpeg_server_url'])) $ffmpegUrl = rtrim($cfg['ffmpeg_server_url'], '/');
}
if (!$ffmpegUrl) $ffmpegUrl = 'http://' . gethostname() . ':3002';

function getCachePath($videoPath, $time) {
    global $cacheDir;
    $safePath = preg_replace('#/+#', '/', trim($videoPath, '/'));
    return $cacheDir . '/' . $safePath . '/' . number_format((float)$time, 6, '.', '') . '.jpg';
}

function ensureCacheDir($videoPath) {
    global $cacheDir;
    $safePath = preg_replace('#/+#', '/', trim($videoPath, '/'));
    $dir = $cacheDir . '/' . dirname($safePath);
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    $fullDir = $cacheDir . '/' . $safePath;
    if (!is_dir($fullDir)) {
        mkdir($fullDir, 0775, true);
    }
}

function isCached($videoPath, $time) {
    $cachePath = getCachePath($videoPath, $time);
    return file_exists($cachePath) && filesize($cachePath) > 100;
}

function loadBookmarkFile($mode) {
    $file = $mode === 'vr' ? __DIR__ . '/bookmarks_vr.json' : __DIR__ . '/bookmarks.json';
    if (!file_exists($file)) return [];
    return json_decode(file_get_contents($file), true) ?: [];
}

function findBookmarkById($id) {
    foreach (['', 'vr'] as $mode) {
        $data = loadBookmarkFile($mode);
        foreach ($data as $path => $bookmarks) {
            foreach ($bookmarks as $bm) {
                if (isset($bm['id']) && (string)$bm['id'] === (string)$id) {
                    return ['path' => $path, 'time' => $bm['time'], 'mode' => $mode];
                }
            }
        }
    }
    return null;
}

function decodeFrame($videoPath, $seekTime) {
    global $ffmpegUrl;
    $url = "$ffmpegUrl/decode";
    error_log("[BmThumbCache] decodeFrame: url=$url, videoPath=$videoPath, seekTime=$seekTime");
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
        'videoPath' => $videoPath,
        'seekTime'  => (float)$seekTime
    ]));
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($httpCode !== 200 || !$response) {
        error_log("[BmThumbCache] decodeFrame failed: httpCode=$httpCode, curlError=$curlError");
        return null;
    }
    $result = json_decode($response, true);
    if (!$result || empty($result['success']) || empty($result['base64'])) {
        error_log("[BmThumbCache] decodeFrame invalid response: " . substr($response, 0, 200));
        return null;
    }
    error_log("[BmThumbCache] decodeFrame success: base64_len=" . strlen($result['base64']));
    return $result['base64'];
}

function saveCache($videoPath, $time, $base64Data) {
    if (preg_match('/^data:image\/\w+;base64,/', $base64Data, $matches)) {
        $base64Data = substr($base64Data, strlen($matches[0]));
    }
    $imageData = base64_decode($base64Data);
    if (!$imageData || strlen($imageData) < 100) return false;
    ensureCacheDir($videoPath);
    $cachePath = getCachePath($videoPath, $time);
    return file_put_contents($cachePath, $imageData) !== false;
}

function removeCache($videoPath, $time) {
    $cachePath = getCachePath($videoPath, $time);
    if (file_exists($cachePath)) {
        unlink($cachePath);
        $dir = dirname($cachePath);
        if (is_dir($dir) && count(scandir($dir)) <= 2) {
            rmdir($dir);
        }
    }
}

// 1. cache image serve
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['path']) && isset($_GET['time'])) {
    $path = $_GET['path'];
    $time = (float)$_GET['time'];
    $cachePath = getCachePath($path, $time);
    $cached = file_exists($cachePath) && filesize($cachePath) > 100;

    error_log("[BmThumbCache] GET: path=$path, time=$time, cachePath=$cachePath, cached=" . ($cached ? 'yes' : 'no'));

    if ($cached) {
        header('Content-Type: image/jpeg');
        header('Cache-Control: public, max-age=86400');
        header('Content-Length: ' . filesize($cachePath));
        readfile($cachePath);
        exit;
    }

    http_response_code(404);
    echo json_encode(['ret' => false, 'error' => 'not cached', 'path' => $cachePath]);
    exit;
}

// 2. cache save
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_GET['cache'])) {
    $input = json_decode(file_get_contents('php://input'), true);
    $path = $input['path'] ?? '';
    $time = $input['time'] ?? 0;
    $base64 = $input['base64'] ?? '';

    error_log("[BmThumbCache] POST cache: path=$path, time=$time, base64_len=" . strlen($base64));

    if ($path && $time && $base64) {
        if (saveCache($path, $time, $base64)) {
            $cachePath = getCachePath($path, $time);
            error_log("[BmThumbCache] saved: $cachePath (" . filesize($cachePath) . " bytes)");
            echo json_encode(['ret' => true, 'path' => $cachePath]);
            exit;
        }
        error_log("[BmThumbCache] save failed for: $path @ $time");
    }
    echo json_encode(['ret' => false, 'error' => 'save failed']);
    exit;
}

// 3. cache remove
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_GET['remove'])) {
    $input = json_decode(file_get_contents('php://input'), true);
    $path = $input['path'] ?? '';
    $time = $input['time'] ?? 0;

    if ($path && $time) {
        removeCache($path, $time);
        echo json_encode(['ret' => true]);
        exit;
    }
    echo json_encode(['ret' => false, 'error' => 'invalid params']);
    exit;
}

// 4. thumbnail generate
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_GET['generate'])) {
    $input = json_decode(file_get_contents('php://input'), true);

    if (isset($_GET['ALL'])) {
        set_time_limit(0);
        ignore_user_abort(true);
        $results = ['total' => 0, 'cached' => 0, 'generated' => 0, 'failed' => 0];
        foreach (['', 'vr'] as $mode) {
            $data = loadBookmarkFile($mode);
            foreach ($data as $path => $bookmarks) {
                foreach ($bookmarks as $bm) {
                    $results['total']++;
                    if (isCached($path, $bm['time'])) {
                        $results['cached']++;
                        continue;
                    }
                    $base64 = decodeFrame($path, $bm['time']);
                    if ($base64 && saveCache($path, $bm['time'], $base64)) {
                        $results['generated']++;
                    } else {
                        $results['failed']++;
                    }
                    usleep(50000);
                }
            }
        }
        echo json_encode(['ret' => true, 'data' => $results]);
        exit;
    }

    $id = $input['id'] ?? '';
    if ($id) {
        $bm = findBookmarkById($id);
        if ($bm) {
            $base64 = decodeFrame($bm['path'], $bm['time']);
            if ($base64 && saveCache($bm['path'], $bm['time'], $base64)) {
                echo json_encode(['ret' => true]);
                exit;
            }
        }
        echo json_encode(['ret' => false, 'error' => 'generation failed']);
        exit;
    }

    $path = $input['path'] ?? '';
    $time = $input['time'] ?? 0;
    if ($path && $time) {
        $base64 = decodeFrame($path, $time);
        if ($base64 && saveCache($path, $time, $base64)) {
            echo json_encode(['ret' => true]);
            exit;
        }
        echo json_encode(['ret' => false, 'error' => 'generation failed']);
        exit;
    }

    echo json_encode(['ret' => false, 'error' => 'invalid params']);
    exit;
}

// 5. cache status
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['status'])) {
    $path = $_GET['path'] ?? '';
    $time = $_GET['time'] ?? 0;

    if ($path && $time) {
        $cachePath = getCachePath($path, $time);
        $cached = file_exists($cachePath) && filesize($cachePath) > 100;
        echo json_encode([
            'ret' => true,
            'cached' => $cached,
            'size' => $cached ? filesize($cachePath) : 0,
            'path' => $cachePath
        ]);
        exit;
    }
    echo json_encode(['ret' => false, 'error' => 'invalid params']);
    exit;
}

http_response_code(400);
echo json_encode(['ret' => false, 'error' => 'invalid request']);
?>
