<?php

// 🔑 디렉터리 목록 조회 엔드포인트
// 입력: x=경로 (상대경로는 이 스크립트 기준, 절대경로는 /mnt 등 drvs 대상까지 허용)
// 출력: { ret: bool, error?: string, data: [ { d: 이름, t: mtime, dir: is_dir }, ... ] }
// 보안: 프로젝트 루트 + drvs 심볼릭 링크 실제 대상 하위만 접근 허용 (path traversal 차단)

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

function respond($httpCode, $ret, $error = null, $data = array()) {
    http_response_code($httpCode);
    $out = array('ret' => $ret, 'data' => $data);
    if ($error !== null) $out['error'] = $error;
    echo json_encode($out, JSON_UNESCAPED_UNICODE);
    exit;
}

// 🔑 접근 허용 루트 화이트리스트: 프로젝트 디렉터리 + drvs 링크의 실제 대상
$allowedRoots = array();
$projectRoot = realpath(__DIR__);
if ($projectRoot !== false) $allowedRoots[] = $projectRoot;
$drvsTarget = realpath(__DIR__ . '/drvs');
if ($drvsTarget !== false && !in_array($drvsTarget, $allowedRoots, true)) {
    $allowedRoots[] = $drvsTarget;
}

if (!isset($_GET['x']) || trim((string)$_GET['x']) === '') {
    respond(400, false, 'missing parameter x');
}

$path = rtrim((string)$_GET['x'], '/');
if ($path === '' || strpos($path, "\0") !== false) {
    respond(400, false, 'invalid parameter');
}

// 상대경로는 스크립트 디렉터리 기준으로 해석 (CWD 의존 제거)
$isAbsolute = ($path[0] === '/');
$base = $isAbsolute ? '' : __DIR__ . '/';

$real = @realpath($base . $path);
if ($real === false || !is_dir($real)) {
    respond(404, false, 'directory not found');
}

// 🔑 realpath가 허용 루트 하위인지 검사 (../ traversal 차단)
$allowed = false;
foreach ($allowedRoots as $root) {
    if ($real === $root || strncmp($real, $root . DIRECTORY_SEPARATOR, strlen($root) + 1) === 0) {
        $allowed = true;
        break;
    }
}
if (!$allowed) {
    respond(403, false, 'forbidden path');
}

$entries = @scandir($real);
if ($entries === false) {
    respond(500, false, 'cannot read directory');
}

$data = array();
foreach ($entries as $entry) {
    if ($entry === '.' || $entry === '..') continue;
    if ($entry[0] === '.') continue; // 숨김파일 및 macOS AppleDouble(._*) 제외

    $full = $real . DIRECTORY_SEPARATOR . $entry;
    $mtime = @filemtime($full); // 경합 중 사라진 항목이 있어도 warning으로 JSON 오염되지 않도록 억제

    $data[] = array(
        'd' => $entry,
        't' => ($mtime !== false) ? date('Y-m-d H:i:s', $mtime) : '',
        'dir' => is_dir($full)
    );
}

respond(200, true, null, $data);
