"""Security middleware for adding security headers to responses."""

from flask import Flask

# sha256 of the build-injected import map (frontend/vite.config.js, from
# src/plugins/runtime/vendorManifest.js). test_security_headers recomputes it.
VENDOR_IMPORTMAP_HASH = 'sha256-lIJXjhqB4GwFLcjRTSjM91Q7vwXxH4Wbcn475CzkW4U='


def register_security_headers(app: Flask):
    """Register security headers as an after_request handler."""

    @app.after_request
    def add_security_headers(response):
        # Prevent clickjacking
        response.headers['X-Frame-Options'] = 'DENY'

        # Prevent MIME type sniffing
        response.headers['X-Content-Type-Options'] = 'nosniff'

        # XSS Protection (legacy but still useful for older browsers)
        response.headers['X-XSS-Protection'] = '1; mode=block'

        # Referrer Policy
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'

        # Content Security Policy
        # In debug mode, allow inline styles/scripts for Vite dev tooling.
        # The production policy intentionally matches the nginx edge config so
        # responses served directly by Flask are consistent with Cloudflare/nginx.
        if app.debug:
            csp_directives = [
                "default-src 'self'",
                "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' data: https:",
                "font-src 'self'",
                "connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:*",
                "frame-ancestors 'none'",
                "base-uri 'self'",
                "form-action 'self' https://github.com",
            ]
        else:
            # style-src keeps 'unsafe-inline' because React renders style="" attributes;
            # script-src has no 'unsafe-inline'/'unsafe-eval': the FOUC snippet is
            # /theme-init.js; the one inline script (build-injected vendor importmap)
            # is allowed by hash; blob: is for runtime extensions (plugins/runtime/loader.js).
            csp_directives = [
                "default-src 'self'",
                "script-src 'self' '%s' blob:" % VENDOR_IMPORTMAP_HASH,
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' data: https:",
                "font-src 'self'",
                "connect-src 'self' ws: wss:",
                "frame-ancestors 'none'",
                "base-uri 'self'",
                "form-action 'self' https://github.com",
            ]
        response.headers['Content-Security-Policy'] = '; '.join(csp_directives)

        # Permissions Policy (formerly Feature-Policy)
        response.headers['Permissions-Policy'] = 'geolocation=(), microphone=(), camera=()'

        # HSTS - only when the deployment actually terminates HTTPS. The installer
        # records that choice (SSL_MODE / HSTS_ENABLED in config); we never
        # advertise HSTS or `preload` on a plain-HTTP or Cloudflare-Flexible
        # install, since that's a hard-to-reverse commitment and HTTPS is
        # intentionally optional. 63072000s = 2 years, matching the nginx edge
        # config and the preload-list requirements.
        if app.config.get('HSTS_ENABLED') and not app.debug:
            response.headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload'

        return response
