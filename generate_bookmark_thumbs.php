<?php
// generate_bookmark_thumbs.php
// CLI: php generate_bookmark_thumbs.php [--workers=N]
// Web: GET ?progress=1 (poll progress), GET (start generation)

$isCLI = php_sapi_name() === 'cli';

// ─── Config ───
$cacheDir = __DIR__ . '/bookmark_thumbs';
if (!is_dir($cacheDir)) mkdir($cacheDir, 0775, true);

$ffmpegUrl = '';
$configFile = __DIR__ . '/ffmpeg_config.json';
if (file_exists($configFile)) {
    $cfg = json_decode(file_get_contents($configFile), true);
    if (!empty($cfg['ffmpeg_server_url'])) $ffmpegUrl = rtrim($cfg['ffmpeg_server_url'], '/');
}
if (!$ffmpegUrl) $ffmpegUrl = 'http://192.168.0.101:3002';

// ─── Parse CLI args ───
$numWorkers = 6;
$pathFilter = '';
foreach ($argv as $arg) {
    if (preg_match('/^--workers=(\d+)$/', $arg, $m)) {
        $numWorkers = max(1, min(16, (int)$m[1]));
    }
    if (preg_match('/^--path=(.+)$/', $arg, $m)) {
        $pathFilter = rtrim($m[1], '/');
    }
}

// ─── Progress state file (web mode) ───
$progressFile = __DIR__ . '/.bookmark_gen_progress.json';
function saveProgress($data) {
    global $progressFile;
    file_put_contents($progressFile, json_encode($data));
}
function loadProgress() {
    global $progressFile;
    if (!file_exists($progressFile)) return null;
    return json_decode(file_get_contents($progressFile), true);
}

// ─── Graceful shutdown ───
$shutdownRequested = false;
$childPids = [];

$shutdownHandler = function ($sig) use (&$shutdownRequested, &$childPids) {
    if ($sig === SIGINT || $sig === SIGTERM) {
        if (!$shutdownRequested) {
            $shutdownRequested = true;
            // Forward SIGTERM to all children so they finish current decode
            foreach ($childPids as $pid) {
                posix_kill($pid, SIGTERM);
            }
        }
    }
};
if ($isCLI) {
    pcntl_signal(SIGINT, $shutdownHandler);
    pcntl_signal(SIGTERM, $shutdownHandler);
    pcntl_async_signals(true);
}

// ─── Helpers ───
function getCachePath($videoPath, $time) {
    global $cacheDir;
    $safePath = preg_replace('#/+#', '/', trim($videoPath, '/'));
    return $cacheDir . '/' . $safePath . '/' . number_format((float)$time, 6, '.', '') . '.jpg';
}

function ensureCacheDir($videoPath) {
    global $cacheDir;
    $safePath = preg_replace('#/+#', '/', trim($videoPath, '/'));
    $dir = $cacheDir . '/' . dirname($safePath);
    if (!is_dir($dir)) mkdir($dir, 0775, true);
    $fullDir = $cacheDir . '/' . $safePath;
    if (!is_dir($fullDir)) mkdir($fullDir, 0775, true);
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

function decodeFrame($videoPath, $seekTime, $retries = 2) {
    global $ffmpegUrl;
    for ($attempt = 0; $attempt <= $retries; $attempt++) {
        if ($attempt > 0) sleep(3);

        $url = "$ffmpegUrl/decode";
        $payload = json_encode([
            'videoPath' => $videoPath,
            'seekTime'  => (float)$seekTime
        ]);
        $ctx = stream_context_create([
            'http' => [
                'method'  => 'POST',
                'header'  => 'Content-Type: application/json',
                'content' => $payload,
                'timeout' => 30
            ]
        ]);
        $response = @file_get_contents($url, false, $ctx);

        if ($response !== false) {
            $result = json_decode($response, true);
            if ($result && !empty($result['success']) && !empty($result['base64'])) {
                return $result['base64'];
            }
        }
        error_log("[BmGen:W$$] Attempt " . ($attempt + 1) . " failed for $videoPath @ {$seekTime}s");
    }
    return null;
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

function formatDuration($seconds) {
    $h = floor($seconds / 3600);
    $m = floor(($seconds % 3600) / 60);
    $s = floor($seconds % 60);
    if ($h > 0) return sprintf('%dh%02dm%02ds', $h, $m, $s);
    if ($m > 0) return sprintf('%dm%02ds', $m, $s);
    return sprintf('%ds', $s);
}

function workerProgressFile($workerId) {
    return __DIR__ . "/.bookmark_gen_worker_{$workerId}.json";
}

function saveWorkerProgress($workerId, $data) {
    file_put_contents(workerProgressFile($workerId), json_encode($data));
}

function loadWorkerProgress($workerId) {
    $f = workerProgressFile($workerId);
    if (!file_exists($f)) return null;
    return json_decode(file_get_contents($f), true);
}

function aggregateWorkerProgress($numWorkers) {
    $total = 0; $cached = 0; $generated = 0; $failed = 0;
    $running = false;
    for ($w = 0; $w < $numWorkers; $w++) {
        $p = loadWorkerProgress($w);
        if (!$p) continue;
        $total += $p['total'] ?? 0;
        $cached += $p['cached'] ?? 0;
        $generated += $p['generated'] ?? 0;
        $failed += $p['failed'] ?? 0;
        if (!empty($p['running'])) $running = true;
    }
    $processed = $cached + $generated + $failed;
    return compact('total', 'cached', 'generated', 'failed', 'processed', 'running');
}

// ─── Web: progress endpoint ───
if (!$isCLI && isset($_GET['progress'])) {
    $p = loadProgress();
    header('Content-Type: application/json');
    if ($p) {
        $p['ret'] = true;
        echo json_encode($p);
    } else {
        echo json_encode(['ret' => true, 'running' => false]);
    }
    exit;
}

// ─── Collect all bookmarks grouped by video path ───
$grouped = [];
$normalCount = 0;
$vrCount = 0;

foreach (['' => 'normal', 'vr' => 'vr'] as $mode => $label) {
    $data = loadBookmarkFile($mode);
    foreach ($data as $path => $bookmarks) {
        if (!isset($grouped[$path])) $grouped[$path] = [];
        foreach ($bookmarks as $bm) {
            $timeKey = number_format((float)$bm['time'], 6, '.', '');
            if (!isset($grouped[$path][$timeKey])) {
                $grouped[$path][$timeKey] = $mode;
            }
        }
    }
    if ($mode === '') $normalCount = array_sum(array_map('count', $data));
    if ($mode === 'vr') $vrCount = array_sum(array_map('count', $data));
}

// Flatten for sequential processing
$allJobs = [];
foreach ($grouped as $path => $times) {
    $sortedTimes = array_keys($times);
    sort($sortedTimes);
    foreach ($sortedTimes as $timeKey) {
        $allJobs[] = ['path' => $path, 'time' => (float)$timeKey, 'mode' => $times[$timeKey]];
    }
}

// ─── Filter by path if --path specified ───
if ($pathFilter) {
    $allJobs = array_values(array_filter($allJobs, function ($job) use ($pathFilter) {
        return $job['path'] === $pathFilter || str_starts_with($job['path'], $pathFilter . '/');
    }));
}

$total = count($allJobs);
$startTime = time();

// ─── Split jobs into N chunks ───
function splitArray($arr, $n) {
    $chunks = array_fill(0, $n, []);
    foreach ($arr as $i => $item) {
        $chunks[$i % $n][] = $item;
    }
    return $chunks;
}

// ─── Single worker function (runs in child process) ───
function runWorker($workerId, $jobs, $ffmpegUrl, $numWorkers) {
    global $cacheDir;

    $cached = 0;
    $generated = 0;
    $failed = 0;
    $total = count($jobs);
    $workerStart = time();

    // Child has its own shutdown flag
    $shutdownRequested = false;
    pcntl_signal(SIGTERM, function ($sig) use (&$shutdownRequested) {
        $shutdownRequested = true;
    });
    pcntl_async_signals(true);

    saveWorkerProgress($workerId, [
        'running'   => true,
        'workerId'  => $workerId,
        'numWorkers'=> $numWorkers,
        'total'     => $total,
        'processed' => 0,
        'cached'    => 0,
        'generated' => 0,
        'failed'    => 0,
        'current'   => ''
    ]);

    foreach ($jobs as $idx => $job) {
        if ($shutdownRequested) break;

        $path = $job['path'];
        $time = $job['time'];

        if (isCached($path, $time)) {
            $cached++;
            continue;
        }

        $base64 = decodeFrame($path, $time);
        if ($base64 && saveCache($path, $time, $base64)) {
            $generated++;
        } else {
            $failed++;
        }

        $processed = $cached + $generated + $failed;

        // Save progress every 3 items
        if ($processed % 3 === 0 || $processed === $total) {
            saveWorkerProgress($workerId, [
                'running'   => !$shutdownRequested,
                'workerId'  => $workerId,
                'numWorkers'=> $numWorkers,
                'total'     => $total,
                'processed' => $processed,
                'cached'    => $cached,
                'generated' => $generated,
                'failed'    => $failed,
                'current'   => "$path @ {$time}s"
            ]);
        }

        usleep(30000); // 30ms between decodes
    }

    // Final worker progress
    $processed = $cached + $generated + $failed;
    $elapsed = time() - $workerStart;
    saveWorkerProgress($workerId, [
        'running'   => false,
        'workerId'  => $workerId,
        'numWorkers'=> $numWorkers,
        'total'     => $total,
        'processed' => $processed,
        'cached'    => $cached,
        'generated' => $generated,
        'failed'    => $failed,
        'elapsed'   => formatDuration($elapsed),
        'current'   => ''
    ]);

    exit(0);
}

// ═══════════════════════════════════════════
//  MAIN: Fork workers
// ═══════════════════════════════════════════

// Clean old worker files
for ($w = 0; $w < 16; $w++) {
    $f = workerProgressFile($w);
    if (file_exists($f)) @unlink($f);
}

$chunks = splitArray($allJobs, $numWorkers);
$actualWorkers = 0;
$childPids = [];

if ($isCLI) {
    fprintf(STDERR, "=== Bookmark Thumbnail Generator (Parallel) ===\n");
    fprintf(STDERR, "Total: $total (normal: $normalCount, VR: $vrCount)\n");
    if ($pathFilter) fprintf(STDERR, "Path filter: %s\n", $pathFilter);
    fprintf(STDERR, "Workers: $numWorkers\n");
    fprintf(STDERR, "FFmpeg server: $ffmpegUrl\n");
    fprintf(STDERR, "Ctrl+C to stop gracefully (all current decodes will finish)\n\n");
}

for ($w = 0; $w < $numWorkers; $w++) {
    if (empty($chunks[$w])) continue;

    $pid = pcntl_fork();
    if ($pid === -1) {
        fprintf(STDERR, "[ERROR] Failed to fork worker $w\n");
        continue;
    }

    if ($pid === 0) {
        // ─── Child process ───
        // Reset shutdown handler for child
        runWorker($w, $chunks[$w], $ffmpegUrl, $numWorkers);
        // never reached (exit in runWorker)
    } else {
        // ─── Parent process ───
        $childPids[] = $pid;
        $actualWorkers++;
        if ($isCLI) {
            fprintf(STDERR, "  [fork] Worker $w: PID $pid, " . count($chunks[$w]) . " jobs\n");
        }
    }
}

fprintf(STDERR, "\n");

// ─── Parent: monitor progress until all children exit ───
$lastProgressLine = '';
while (true) {
    pcntl_waitpid(0, $status, WNOHANG);

    // Check if all children exited
    $allDone = true;
    foreach ($childPids as $pid) {
        $result = pcntl_waitpid($pid, $status, WNOHANG);
        if ($result === 0) {
            $allDone = false;
            break;
        }
    }

    // Aggregate progress from all workers
    $agg = aggregateWorkerProgress($actualWorkers);
    $elapsed = time() - $startTime;
    $speed = $elapsed > 0 ? ($agg['generated'] + $agg['failed']) / $elapsed : 0;
    $remaining = max(0, $agg['total'] - $agg['processed']);
    $eta = ($speed > 0 && $remaining > 0) ? formatDuration($remaining / $speed) : ($allDone ? '0s' : '...');

    // Find a current video from any worker for display
    $currentDisplay = '';
    for ($w = 0; $w < $actualWorkers; $w++) {
        $p = loadWorkerProgress($w);
        if ($p && !empty($p['current']) && $p['current'] !== '') {
            $currentDisplay = $p['current'];
            break;
        }
    }

    // CLI: compact aggregated progress line
    if ($isCLI) {
        $short = strlen($currentDisplay) > 35 ? '...' . substr($currentDisplay, -32) : $currentDisplay;
        fprintf(STDERR, "\r\033[K[%d/%d] w:%d cached:%d gen:%d fail:%d | %s | %.1f/s ETA:%s",
            $agg['processed'], $agg['total'], $actualWorkers,
            $agg['cached'], $agg['generated'], $agg['failed'],
            $short, $speed, $eta
        );
    }

    // Save aggregated progress for web endpoint
    saveProgress([
        'running'   => $agg['running'],
        'total'     => $agg['total'],
        'normal'    => $normalCount,
        'vr'        => $vrCount,
        'workers'   => $actualWorkers,
        'processed' => $agg['processed'],
        'cached'    => $agg['cached'],
        'generated' => $agg['generated'],
        'failed'    => $agg['failed'],
        'speed'     => round($speed, 1),
        'eta'       => $eta,
        'current'   => $currentDisplay
    ]);

    if ($allDone) break;

    usleep(500000); // 500ms between progress checks
}

// ─── Final stats ───
$totalTime = time() - $startTime;
$agg = aggregateWorkerProgress($actualWorkers);

saveProgress([
    'running'   => false,
    'total'     => $agg['total'],
    'normal'    => $normalCount,
    'vr'        => $vrCount,
    'workers'   => $actualWorkers,
    'processed' => $agg['processed'],
    'cached'    => $agg['cached'],
    'generated' => $agg['generated'],
    'failed'    => $agg['failed'],
    'speed'     => $agg['processed'] > 0 ? round(($agg['generated'] + $agg['failed']) / max($totalTime, 1), 1) : 0,
    'eta'       => 'done',
    'current'   => '',
    'totalTime' => formatDuration($totalTime)
]);

if ($isCLI) {
    fprintf(STDERR, "\n\n=== Complete ===\n");
    fprintf(STDERR, "Total:     %d\n", $agg['total']);
    fprintf(STDERR, "Cached:    %d (skipped)\n", $agg['cached']);
    fprintf(STDERR, "Generated: %d\n", $agg['generated']);
    fprintf(STDERR, "Failed:    %d\n", $agg['failed']);
    fprintf(STDERR, "Workers:   %d\n", $actualWorkers);
    fprintf(STDERR, "Time:      %s\n", formatDuration($totalTime));

    // Per-worker breakdown
    fprintf(STDERR, "\nPer-worker breakdown:\n");
    for ($w = 0; $w < $actualWorkers; $w++) {
        $p = loadWorkerProgress($w);
        if ($p) {
            fprintf(STDERR, "  Worker %d: %d/%d (cached:%d gen:%d fail:%d) %s\n",
                $w, $p['processed'], $p['total'],
                $p['cached'] ?? 0, $p['generated'] ?? 0, $p['failed'] ?? 0,
                $p['elapsed'] ?? '?'
            );
        }
    }

    if ($shutdownRequested) {
        fprintf(STDERR, "\n[SHUTDOWN] Gracefully stopped. Re-run to continue from where it stopped.\n");
    }

    // Cleanup worker files
    for ($w = 0; $w < 16; $w++) {
        $f = workerProgressFile($w);
        if (file_exists($f)) @unlink($f);
    }
} else {
    header('Content-Type: application/json');
    $results = loadProgress();
    $results['ret'] = true;
    echo json_encode($results);
}
?>
