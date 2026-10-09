<?php

// 🔑 비디오/디렉터리 자체 즐겨찾기 — 시점북마크(bookmark.php)와 무관한 별도 저장소 favorites.json
// 스키마: { "<전체상대경로>": { "created": <ms> }, ... }
// GET  ?all=1          → { ret, data: { path: { created } } }
// GET  ?path=<경로>     → { ret, favorited: bool }
// POST { action: add|remove|toggle, path } → { ret, favorited: bool }

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

function favorite_file() {
    return __DIR__ . '/favorites.json';
}

function load() {
    $file = favorite_file();
    if (!file_exists($file)) return [];
    return json_decode(file_get_contents($file), true) ?: [];
}

function save($data) {
    $file = favorite_file();

    $dir = dirname($file);
    if (!is_dir($dir)) {
        error_log("Directory does not exist: $dir");
        return false;
    }
    if (!is_writable($dir)) {
        error_log("Directory is not writable: $dir");
        return false;
    }

    $result = file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT));
    if ($result === false) {
        error_log("Failed to save favorites to: $file");
        return false;
    }
    return true;
}

function respond($ret, $extra = array()) {
    echo json_encode(array_merge(['ret' => $ret], $extra));
    exit;
}

// JS decodeURI와 동일 규칙의 정규화: %xx 디코딩하되 예약 문자(; / ? : @ & = + $ , #) 보존,
// 잘못된 % 시퀀스는 원본 유지 → 메인페이지(encodeURI 경로)와 플레이어(디코드 경로) 키를 동일 경로로 취급
function canon($path) {
    return preg_replace_callback('/%([0-9A-Fa-f]{2})/', function ($m) {
        $chr = chr(hexdec($m[1]));
        if (strpos(';/?:@&=+$,#', $chr) !== false) return $m[0];
        return $chr;
    }, $path);
}

function matching_keys($data, $path) {
    $c = canon($path);
    $out = array();
    foreach ($data as $k => $v) {
        if (canon($k) === $c) $out[] = $k;
    }
    return $out;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['all'])) {
    respond(true, ['data' => load()]);
}
else if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['path'])) {
    $data = load();
    respond(true, ['favorited' => count(matching_keys($data, $_GET['path'])) > 0]);
}
else if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $raw = file_get_contents('php://input');
    $input = json_decode($raw, true);
    if (!is_array($input)) {
        respond(false, ['error' => 'invalid json']);
    }

    $action = $input['action'] ?? '';
    $path = $input['path'] ?? '';
    if ($path === '' || !in_array($action, ['add', 'remove', 'toggle'], true)) {
        respond(false, ['error' => 'invalid params']);
    }

    $data = load();
    $matches = matching_keys($data, $path);
    $favorited = count($matches) > 0;

    if ($action === 'add') {
        $favorited = true;
    } else if ($action === 'remove') {
        $favorited = false;
    } else { // toggle
        $favorited = !$favorited;
    }

    if ($favorited) {
        if (count($matches) === 0) {
            $entry = ['created' => (int)(microtime(true) * 1000)];
            if (isset($input['dir']) && is_bool($input['dir'])) {
                $entry['dir'] = $input['dir'];
            }
            $data[$path] = $entry;
        } else if (count($matches) > 1) {
            // 정규화 후 중복 키 정리: 첫 키만 유지
            foreach (array_slice($matches, 1) as $k) unset($data[$k]);
        }
    } else {
        foreach ($matches as $k) unset($data[$k]);
    }

    if (save($data)) {
        respond(true, ['favorited' => $favorited]);
    } else {
        respond(false, ['error' => 'save failed']);
    }
}
else {
    respond(false, ['error' => 'invalid request']);
}
?>
