// Prevent flash of unstyled content (FOUC) by setting theme + accent before React loads.
// External file (not inline) so the CSP needs no 'unsafe-inline' for scripts.
(function() {
    var d = document.documentElement;
    d.setAttribute('data-theme', localStorage.getItem('theme') || 'dark');
    var accent = localStorage.getItem('accent_color');
    if (accent) {
        var m = accent.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
        if (m) {
            var r = parseInt(m[1],16), g = parseInt(m[2],16), b = parseInt(m[3],16);
            var hx = function(v){ return Math.max(0,Math.min(255,v)).toString(16).padStart(2,'0'); };
            var dk = function(v){ return Math.round(v*0.88); };
            var br = function(v){ return Math.round(v + (255-v)*0.30); }; // toward white
            var dm = function(v){ return Math.round(v*0.70); };
            d.style.setProperty('--accent-primary', accent);
            d.style.setProperty('--accent', accent);
            d.style.setProperty('--accent-hover', '#'+hx(dk(r))+hx(dk(g))+hx(dk(b)));
            d.style.setProperty('--accent-bright', '#'+hx(br(r))+hx(br(g))+hx(br(b)));
            d.style.setProperty('--accent-dim', '#'+hx(dm(r))+hx(dm(g))+hx(dm(b)));
            d.style.setProperty('--accent-bg', 'rgba('+r+','+g+','+b+',0.13)');
            d.style.setProperty('--accent-bg-soft', 'rgba('+r+','+g+','+b+',0.07)');
            d.style.setProperty('--accent-glow', 'rgba('+r+','+g+','+b+',0.35)');
            d.style.setProperty('--accent-shadow', 'rgba('+r+','+g+','+b+',0.3)');
        }
    }
})();
