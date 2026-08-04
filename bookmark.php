<?php

$file = __DIR__ . '/bookmarks.json';

function load() {
    global $file;
    if (!file_exists($file)) return [];
    return json_decode(file_get_contents($file), true) ?: [];
}

function save($data) {
    global $file;

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
        error_log("Failed to save bookmarks to: $file");
        return false;
    }
    return true;
}

function sort_bookmarks(&$bookmarks) {
    usort($bookmarks, function ($a, $b) {
        return ($a['time'] ?? 0) - ($b['time'] ?? 0);
    });
}

if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['all'])) {
    $data = load();
    echo json_encode(['ret' => true, 'data' => $data]);
}
else if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['path'])) {
    $data = load();
    $path = $_GET['path'];
    echo json_encode(['ret' => true, 'bookmarks' => $data[$path] ?? []]);
}
else if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input)) {
        echo json_encode(['ret' => false, 'error' => 'invalid json']);
        exit;
    }

    $action = $input['action'] ?? '';
    $path = $input['path'] ?? '';

    if ($action === 'add' && $path !== '' && isset($input['time'])) {
        $data = load();
        if (!isset($data[$path]) || !is_array($data[$path])) $data[$path] = [];

        $time = (float)$input['time'];
        $name = isset($input['name']) ? $input['name'] : gmdate('i:s', (int)$time);

        $bookmark = [
            'id' => (int)(microtime(true) * 1000) . rand(100, 999),
            'name' => $name,
            'time' => $time,
            'created' => (int)(microtime(true) * 1000)
        ];

        $data[$path][] = $bookmark;
        sort_bookmarks($data[$path]);

        if (save($data)) {
            echo json_encode(['ret' => true, 'bookmarks' => $data[$path]]);
        } else {
            echo json_encode(['ret' => false, 'error' => 'save failed']);
        }
    }
    else if ($action === 'remove' && $path !== '' && isset($input['id'])) {
        $data = load();
        $data[$path] = array_values(array_filter($data[$path] ?? [], function ($b) use ($input) {
            return (string)($b['id'] ?? '') !== (string)$input['id'];
        }));

        if (save($data)) {
            echo json_encode(['ret' => true, 'bookmarks' => $data[$path]]);
        } else {
            echo json_encode(['ret' => false, 'error' => 'save failed']);
        }
    }
    else {
        echo json_encode(['ret' => false, 'error' => 'invalid params']);
    }
}
else {
    echo json_encode(['ret' => false, 'error' => 'invalid request']);
}
?>
