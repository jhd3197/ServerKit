/**
 * Sample Node.js Express Application
 * Replace this with your actual application code
 */

const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Node.js App</title>
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
        .info { margin-top: 20px; padding: 15px; background: #fff3e0; border-radius: 4px; }
        a { color: #ff9800; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Node.js App</h1>
        <p class="version">Node ${process.version} | Express</p>

        <div class="info">
          <strong>Your Node.js app is running!</strong>
          <p>Edit <code>src/index.js</code> to customize.</p>
          <p><a href="/health">Health Check</a> | <a href="/info">System Info</a></p>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    node_version: process.version
  });
});

app.get('/info', (req, res) => {
  res.json({
    node_version: process.version,
    platform: process.platform,
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});
