// main.ts (for lugyicar-application - FINAL Clean URL Version)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { getCookies, setCookie } from "https://deno.land/std@0.224.0/http/cookie.ts";

const kv = await Deno.openKv();
const SECRET_TOKEN = Deno.env.get("SECRET_TOKEN") || "fallback-secret-token";
const ADMIN_TOKEN = Deno.env.get("ADMIN_TOKEN") || "fallback-admin-token";

console.log("Clean URL Link Generator is starting...");

// Helper functions
function extractAndCleanMovieName(url: string): string {
    try {
        const pathname = new URL(url).pathname;
        let filename = pathname.substring(pathname.lastIndexOf('/') + 1);
        filename = decodeURIComponent(filename).replace(/[._-]/g, ' ');
        const noiseRegex = /\b(1080p|720p|480p|HD|4K|BluRay|WEBRip|WEB-DL|HDRip|x264|x265|HEVC|AAC|YTS|AM|MX|RARBG|TGx|\[.*?\]|\(.*?\))\b/gi;
        filename = filename.replace(noiseRegex, '').replace(/\.(mp4|mkv|avi|mov|webm)$/i, '').replace(/\s+/g, ' ').trim();
        return filename.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    } catch { return ''; }
}

function slugify(text: string): string {
    return text.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-.]+/g, '').replace(/\-\-+/g, '-').replace(/^-+|-+$/g, '');
}

async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const { pathname, searchParams } = url;
    const method = req.method;

    if (pathname === "/") {
        return new Response(getGeneratorPageHTML(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // API to suggest a name from URL
    if (pathname === "/fetch-title" && method === "POST") {
        try {
            const { originalUrl } = await req.json();
            const suggestedName = extractAndCleanMovieName(originalUrl);
            return new Response(JSON.stringify({ suggestedName }), { headers: { "Content-Type": "application/json" } });
        } catch { return new Response(JSON.stringify({ suggestedName: "" }), { status: 400 }); }
    }

    // API for the admin to generate a clean URL
    if (pathname === "/generate" && method === "POST") {
        const { originalUrl, movieName } = await req.json();
        if (!originalUrl || !movieName) return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400 });
        const fileSlug = slugify(movieName);
        await kv.set(["videos", fileSlug], originalUrl);
        const cleanUrl = `${url.origin}/play/${fileSlug}`;
        return new Response(JSON.stringify({ cleanUrl }), { headers: { "Content-Type": "application/json" } });
    }

    // This is the clean URL the user visits
    const playPattern = new URLPattern({ pathname: "/play/:slug+" });
    if (playPattern.exec(url)) {
        const cookies = getCookies(req.headers);
        if (cookies.access_token === SECRET_TOKEN) {
            // User has access, stream the video
            const slug = playPattern.exec(url)!.pathname.groups.slug!;
            const result = await kv.get<string>(["videos", slug]);
            const originalVideoUrl = result.value;
            if (!originalVideoUrl) return new Response("Video not found.", { status: 404 });
            try {
                const range = req.headers.get("range");
                const headers = new Headers();
                if (range) { headers.set("range", range); }
                const videoResponse = await fetch(originalVideoUrl, { headers });
                if (!videoResponse.ok || !videoResponse.body) return new Response("Failed to fetch video.", { status: videoResponse.status });
                const responseHeaders = new Headers(videoResponse.headers);
                responseHeaders.set("Access-Control-Allow-Origin", "*");
                return new Response(videoResponse.body, { status: videoResponse.status, headers: responseHeaders });
            } catch { return new Response("Error streaming video.", { status: 500 }); }
        } else {
            // User does not have access, redirect to get a cookie
            const slug = playPattern.exec(url)!.pathname.groups.slug!;
            const authUrl = `${url.origin}/auth/${slug}?token=${SECRET_TOKEN}`;
            return Response.redirect(authUrl, 302);
        }
    }
    
    // Intermediate auth URL to set the cookie
    const authPattern = new URLPattern({ pathname: "/auth/:slug+" });
    if (authPattern.exec(url)) {
        if (searchParams.get("token") !== SECRET_TOKEN) {
            return new Response("Unauthorized.", { status: 401 });
        }
        const slug = authPattern.exec(url)!.pathname.groups.slug!;
        const finalUrl = `${url.origin}/play/${slug}`;
        const headers = new Headers({ Location: finalUrl });
        setCookie(headers, { name: "access_token", value: SECRET_TOKEN, maxAge: 365 * 24 * 60 * 60, path: "/", httpOnly: true, secure: true });
        return new Response(null, { status: 302, headers });
    }

    // Your existing admin routes can be added here if needed
    
    return new Response("Not Found", { status: 404 });
}

serve(handler);

function getGeneratorPageHTML(): string {
  return `
    <!DOCTYPE html><html lang="en">
    <head><meta charset="UTF-8"><title>Clean Link Generator</title>
    <style>
        :root{--bg-color:#1a1a2e;--text-color:#f0f0f0;--primary-color:#00aaff;--input-bg:#2a2a2a;--border-color:#444;--success-color:#31a34a;}
        body{font-family:system-ui,sans-serif;background-color:var(--bg-color);color:var(--text-color);display:flex;justify-content:center;align-items:center;min-height:100vh;margin:2rem 0;}
        .container{width:90%;max-width:600px;padding:2rem;background-color:var(--input-bg);border-radius:8px;box-shadow:0 4px 15px #0003;}
        h1{text-align:center;margin-top:0;color:var(--primary-color)}
        label{display:block;margin-bottom:.5rem;font-weight:bold}
        input[type=text]{width:100%;padding:.75rem;margin-bottom:1.5rem;border:1px solid var(--border-color);background-color:var(--bg-color);color:var(--text-color);border-radius:4px;box-sizing:border-box}
        button{width:100%;padding:.75rem;border:none;background-color:var(--primary-color);color:#fff;font-size:1rem;border-radius:4px;cursor:pointer;}
        .result-box{margin-top:1.5rem;display:none}.result-wrapper{display:flex}
        #generatedLink{flex-grow:1;background-color:#333} 
        #copyBtn{width:auto;margin-left:.5rem;background-color:var(--success-color)}
    </style>
    </head>
    <body>
      <div class="container">
        <h1>Clean URL Generator</h1>
        <label for="originalUrl">1. Paste Original Video URL:</label>
        <input type="text" id="originalUrl" placeholder="https://example.com/The.Matrix.1999.1080p.mkv">
        <label for="movieName">2. Verify or Edit Movie Name (e.g., movie-name.mp4):</label>
        <input type="text" id="movieName" placeholder="Will be auto-filled...">
        <button id="generateBtn">3. Generate Clean Link</button>
        <div class="result-box" id="resultBox">
          <label for="generatedLink">Your Clean URL:</label>
          <div class="result-wrapper">
            <input type="text" id="generatedLink" readonly>
            <button id="copyBtn">Copy</button>
          </div>
        </div>
      </div>
      <script>
        const originalUrlInput = document.getElementById('originalUrl');
        const movieNameInput = document.getElementById('movieName');
        const generateBtn = document.getElementById('generateBtn');
        const copyBtn = document.getElementById('copyBtn');
        const resultBox = document.getElementById('resultBox');
        const generatedLinkInput = document.getElementById('generatedLink');
        
        originalUrlInput.addEventListener('blur', () => fetchTitle(originalUrlInput.value));
        async function fetchTitle(url) {
            if (!url.startsWith('http')) return;
            movieNameInput.value = 'Fetching name...';
            try {
                const res = await fetch('/fetch-title', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ originalUrl: url }) });
                const { suggestedName } = await res.json();
                const ext = url.match(/\.(mp4|mkv|avi)$/i);
                movieNameInput.value = suggestedName ? (suggestedName + (ext ? ext[0] : '.mp4')) : '';
            } catch (e) { movieNameInput.value = 'Could not guess name.'; }
        }

        generateBtn.addEventListener('click', async () => {
            const originalUrl = originalUrlInput.value.trim();
            const movieName = movieNameInput.value.trim();
            if (!originalUrl || !movieName) return alert('Please fill all fields.');
            generateBtn.disabled = true; generateBtn.textContent = 'Generating...';
            try {
                const res = await fetch('/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ originalUrl, movieName }) });
                const { cleanUrl } = await res.json();
                generatedLinkInput.value = cleanUrl;
                resultBox.style.display = 'block';
            } catch (e) { alert('Error: ' + e.message);
            } finally { generateBtn.disabled = false; generateBtn.textContent = 'Generate Clean Link'; }
        });

        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(generatedLinkInput.value).then(() => {
                copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
            });
        });
      </script>
    </body></html>
  `;
}
