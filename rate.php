<?php

$file = __DIR__ . '/ratings.json';

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
        error_log("Failed to save ratings to: $file");
        return false;
    }
    error_log("Successfully saved: $file (" . strlen(json_encode($data)) . " bytes)");
    return true;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['name'])) {
    $data = load();
    $name = $_GET['name'];
    echo json_encode(['ret' => true, 'value' => $data[$name] ?? 0]);
}
else if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    if (isset($input['name']) && isset($input['value'])) {
        $data = load();
        $data[$input['name']] = $input['value'];
        $saved = save($data);
        if ($saved) {
            echo json_encode(['ret' => true]);
        } else {
            echo json_encode(['ret' => false, 'error' => 'save failed']);
        }
    } else {
        echo json_encode(['ret' => false, 'error' => 'invalid params']);
    }
}
?>