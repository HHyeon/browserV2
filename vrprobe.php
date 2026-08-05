<?php

// 🔑 VR 파일 감지용 프로브 엔드포인트
// 입력: x[]=경로 (1개 이상, URL 인코딩됨)
// 출력: 순차 배열 [ {path, isVR, width, height, dar}, ... ]
//   - isVR: 2:1 비율(equirectangular) 판정. 프로브 실패 시 null.
//   - 캐시: vrprobe_cache.json (md5(경로) -> mtime + 결과)

$cacheFile = __DIR__ . '/vrprobe_cache.json';
$cache = array();
if (file_exists($cacheFile)) {
    $raw = file_get_contents($cacheFile);
    if ($raw !== false) {
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) $cache = $decoded;
    }
}

$cacheChanged = false;

function vrprobe_probe($path) {
    $cmd = escapeshellcmd('ffprobe')
        . ' -v error -select_streams v:0'
        . ' -show_entries stream=width,height,sample_aspect_ratio'
        . ' -of json '
        . escapeshellarg($path) . ' 2>/dev/null';

    $out = shell_exec($cmd);
    if ($out === null || $out === false || $out === '') return null;

    $json = json_decode($out, true);
    if (!is_array($json) || !isset($json['streams'][0])) return null;

    $s = $json['streams'][0];
    $w = (int)($s['width'] ?? 0);
    $h = (int)($s['height'] ?? 0);
    if ($w <= 0 || $h <= 0) return null;

    $sarNum = 1;
    $sarDen = 1;
    if (isset($s['sample_aspect_ratio'])) {
        $parts = explode(':', $s['sample_aspect_ratio']);
        if (count($parts) == 2) {
            $sarNum = (int)$parts[0];
            $sarDen = (int)$parts[1];
        }
    }

    $dar = ($w * $sarNum) / ($h * $sarDen);

    return array(
        'isVR' => ($dar >= 1.9 && $dar <= 2.1),
        'width' => $w,
        'height' => $h,
        'dar' => round($dar, 4)
    );
}

$results = array();

if (isset($_GET["x"]))
{
    $paths = $_GET["x"];
    if (!is_array($paths)) $paths = array($paths);

    foreach ($paths as $path)
    {
        $path = rtrim($path, '/');

        $key = md5($path);
        $mtime = @filemtime($path);
        $mtime = ($mtime === false) ? 0 : (int)$mtime;

        if (isset($cache[$key]) && ($cache[$key]['mtime'] ?? -1) === $mtime)
        {
            $result = $cache[$key]['result'];
        }
        else
        {
            $result = vrprobe_probe($path);

            if ($result !== null)
            {
                $cache[$key] = array('mtime' => $mtime, 'result' => $result);
                $cacheChanged = true;
            }
            else
            {
                $result = array('isVR' => null, 'width' => 0, 'height' => 0, 'dar' => 0);
            }
        }

        array_push($results, array('path' => $path, 'isVR' => $result['isVR'], 'width' => $result['width'], 'height' => $result['height'], 'dar' => $result['dar']));
    }
}

if ($cacheChanged)
{
    file_put_contents($cacheFile, json_encode($cache));
}

header('Content-Type: application/json');
echo json_encode($results);
?>
