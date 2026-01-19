"""
Sample Python Flask Application
Replace this with your actual application code
"""

import os
import sys
from flask import Flask, jsonify

app = Flask(__name__)

@app.route('/')
def home():
    return f'''
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Python App</title>
        <style>
            body {{
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                max-width: 800px;
                margin: 50px auto;
                padding: 20px;
                background: #f5f5f5;
            }}
            .card {{
                background: white;
                padding: 30px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }}
            h1 {{ color: #333; margin-bottom: 10px; }}
            .version {{ color: #777; font-size: 14px; }}
            .info {{ margin-top: 20px; padding: 15px; background: #e3f2fd; border-radius: 4px; }}
            a {{ color: #2196F3; }}
        </style>
    </head>
    <body>
        <div class="card">
            <h1>Python App</h1>
            <p class="version">Python {sys.version.split()[0]} | Flask {Flask.__version__ if hasattr(Flask, '__version__') else 'N/A'}</p>

            <div class="info">
                <strong>Your Python app is running!</strong>
                <p>Edit <code>src/app.py</code> to customize.</p>
                <p><a href="/health">Health Check</a> | <a href="/info">System Info</a></p>
            </div>
        </div>
    </body>
    </html>
    '''

@app.route('/health')
def health():
    return jsonify({
        'status': 'healthy',
        'python_version': sys.version.split()[0]
    })

@app.route('/info')
def info():
    return jsonify({
        'python_version': sys.version,
        'platform': sys.platform,
        'environment': dict(os.environ)
    })

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    app.run(host='0.0.0.0', port=port, debug=False)
