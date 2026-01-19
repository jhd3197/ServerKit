<?php
/**
 * Sample PHP Application
 * Replace this with your actual application code
 */

$appName = getenv('APP_NAME') ?: 'PHP App';
$phpVersion = phpversion();
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= htmlspecialchars($appName) ?></title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .card {
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 { color: #333; margin-bottom: 10px; }
        .version { color: #777; font-size: 14px; }
        .info { margin-top: 20px; padding: 15px; background: #e8f5e9; border-radius: 4px; }
        a { color: #4CAF50; }
    </style>
</head>
<body>
    <div class="card">
        <h1><?= htmlspecialchars($appName) ?></h1>
        <p class="version">PHP <?= $phpVersion ?></p>

        <div class="info">
            <strong>Your PHP app is running!</strong>
            <p>Put your PHP files in the <code>src/</code> directory.</p>
            <p><a href="info.php">View PHP Info</a></p>
        </div>
    </div>
</body>
</html>
