// main.ts

import { getCookies } from "https://deno.land/std@0.224.0/http/cookie.ts";

const kv = await Deno.openKv();

const SECRET_TOKEN = Deno.env.get("SECRET_TOKEN") || "user-token-123";
const ADMIN_TOKEN = Deno.env.get("ADMIN_TOKEN") || "admin-token-456";

console.log("Server starting with integrated Admin Login Form...");

// Helper functions (slugify, extractAndCleanMovieName) are the same
function extractAndCleanMovieName(url: string): string {
    try {
        const pathname = new URL(url).pathname;
        let filename = pathname.substring(pathname.lastIndexOf('/') + 1);
        filename = decodeURIComponent(filename).replace(/[._-]/g, ' ');
        const noiseRegex = /\b(1080p|720p|480p|HD|4K|BluRay|WEBRip|WEB-DL|HDRip|x264|x265|HEVC|AAC|YTS|AM|MX|RARBG|TGx|\[.*?\]|\(.*?\))\b/gi;
        filename = filename.replace(noiseRegex, '').replace(/\.(mp4|mkv|avi|mov|webm)$/i, '').replace(/\s+/g, ' ').trim();
        return filename.split(' ').map(w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(' ');
    } catch { return ''; }
}
function slugify(text: string): string {
    return text.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-.]+/g, '').replace(/\-\-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const method = req.method;

  // --- ADMIN PANEL ROUTES (No changes here) ---
  if (pathname === "/admin") {
    if (url.searchParams.get("token") !== ADMIN_TOKEN) return new Response("Forbidden", { status: 403 });
    const videos = [];
    const iterator = kv.list({ prefix: ["videos"] });
    for await (const entry of iterator) { videos.push({ key: entry.key[1], value: entry.value }); }
    return new Response(getAdminPage(videos, ADMIN_TOKEN), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  if (pathname.startsWith("/delete/") && method === "DELETE") {
    if (req.headers.get("Authorization") !== `Bearer ${ADMIN_TOKEN}`) return new Response("Unauthorized", { status: 401 });
    try {
        const slug = pathname.split('/')[2];
        if (!slug) throw new Error("Invalid slug");
        await kv.delete(["videos", decodeURIComponent(slug)]);
        return new Response(JSON.stringify({ success: true, message: `Deleted: ${slug}` }), { headers: { "Content-Type": "application/json" } });
    } catch (e) { return new Response(JSON.stringify({ success: false, message: e.message }), { status: 400 }); }
  }
  
  // --- USER-FACING ROUTES (No changes here) ---
  if (pathname === "/") { return new Response(getHtmlPage(), { headers: { "Content-Type": "text/html; charset=utf-8" } }); }
  if (pathname === "/fetch-title" && method === "POST") {
      const { originalUrl } = await req.json();
      return new Response(JSON.stringify({ suggestedName: extractAndCleanMovieName(originalUrl) }));
  }
  if (pathname === "/generate" && method === "POST") { 
      const { originalUrl, movieName } = await req.json();
      if (!originalUrl || !movieName) return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
      const fileSlug = slugify(movieName);
      await kv.set(["videos", fileSlug], originalUrl);
      return new Response(JSON.stringify({ playbackUrl: `${url.origin}/play/${fileSlug}?t=${SECRET_TOKEN}` }));
  }
  const playPattern = new URLPattern({ pathname: "/play/:filename+" });
  if (playPattern.exec(url)) {
    if (url.searchParams.get("t") !== SECRET_TOKEN) return new Response("Unauthorized", { status: 401 });
    const filename = playPattern.exec(url)!.pathname.groups.filename!;
    const headers = new Headers({ "Location": `${url.origin}/stream/${filename}` });
    headers.set("Set-Cookie", `auth-token=${SECRET_TOKEN}; HttpOnly; Secure; Path=/stream; SameSite=Strict; Max-Age=86400`);
    return new Response(null, { status: 302, headers });
  }
  const streamPattern = new URLPattern({ pathname: "/stream/:filename+" });
  if (streamPattern.exec(url)) {
    if (getCookies(req.headers)["auth-token"] !== SECRET_TOKEN) return new Response("Access Denied", { status: 403 });
    const filename = streamPattern.exec(url)!.pathname.groups.filename!;
    const result = await kv.get<string>(["videos", filename]);
    if (!result.value) return new Response("Video not found", { status: 404 });
    const videoResponse = await fetch(result.value, { headers: { range: req.headers.get("range") || "" } });
    const responseHeaders = new Headers(videoResponse.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    return new Response(videoResponse.body, { status: videoResponse.status, headers: responseHeaders });
  }

  return new Response("Not Found.", { status: 404 });
});

// Generator & Admin Login Page HTML
function getHtmlPage(): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Auto-Suggest Link Generator</title>
      <style>
        :root{--bg-color:#1a1a1a;--text-color:#f0f0f0;--primary-color:#0af;--input-bg:#2a2a2a;--border-color:#444;--success-color:#31a34a;--admin-color:#f90;}
        body{font-family:system-ui,sans-serif;background-color:var(--bg-color);color:var(--text-color);display:flex;justify-content:center;align-items:center;min-height:100vh;margin:2rem 0; flex-direction: column;}
        .container{width:90%;max-width:600px;padding:2rem;background-color:var(--input-bg);border-radius:8px;box-shadow:0 4px 15px #0003; margin-bottom: 2rem;}
        h1, h2{text-align:center;margin-top:0;color:var(--primary-color)}
        label{display:block;margin-bottom:.5rem;font-weight:bold}
        input[type=text], input[type=password]{width:100%;padding:.75rem;margin-bottom:1.5rem;border:1px solid var(--border-color);background-color:var(--bg-color);color:var(--text-color);border-radius:4px;box-sizing:border-box}
        button{width:100%;padding:.75rem;border:none;background-color:var(--primary-color);color:#fff;font-size:1rem;border-radius:4px;cursor:pointer;transition:background-color .2s}
        button:hover:not(:disabled){background-color:#08d}button:disabled{background-color:#555;cursor:not-allowed}
        .result-box{margin-top:1.5rem;display:none}.result-wrapper{display:flex}#generatedLink{flex-grow:1;background-color:#333}
        #copyBtn{width:auto;margin-left:.5rem;background-color:var(--success-color)}#copyBtn:hover{background-color:#267c38}
        #adminLoginBtn { background-color: var(--admin-color); } #adminLoginBtn:hover { background-color: #d70; }
        h2.admin-header { color: var(--admin-color); }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Auto-Suggest Video Link Generator</h1>
        <label for="originalUrl">1. Paste Original Video URL:</label>
        <input type="text" id="originalUrl" placeholder="https://example.com/The.Matrix.1999.1080p.mkv">
        <label for="movieName">2. Verify or Edit Movie Name (add .mp4 or .mkv):</label>
        <input type="text" id="movieName" placeholder="Will be auto-filled...">
        <button id="generateBtn">3. Generate Playback Link</button>
        <div class="result-box" id="resultBox">
          <label for="generatedLink">Your Secure Playback Link:</label>
          <div class="result-wrapper">
            <input type="text" id="generatedLink" readonly>
            <button id="copyBtn">Copy</button>
          </div>
        </div>
      </div>

      <!-- NEW: ADMIN LOGIN SECTION -->
      <div class="container">
        <h2 class="admin-header">Admin Login</h2>
        <label for="adminTokenInput">Enter Admin Token:</label>
        <input type="password" id="adminTokenInput" placeholder="Your secret admin token">
        <button id="adminLoginBtn">Login to Admin Panel</button>
      </div>

      <script>
        // Generator page logic
        const originalUrlInput = document.getElementById('originalUrl');
        const movieNameInput = document.getElementById('movieName');
        const generateBtn = document.getElementById('generateBtn');
        const copyBtn = document.getElementById('copyBtn');
        const resultBox = document.getElementById('resultBox');

        originalUrlInput.addEventListener('paste', (event) => {
            const pastedText = (event.clipboardData || window.clipboardData).getData('text');
            fetchTitle(pastedText);
        });
        originalUrlInput.addEventListener('blur', () => { fetchTitle(originalUrlInput.value); });

        async function fetchTitle(url) {
            const originalUrl = url.trim();
            if (!originalUrl.startsWith('http')) return;
            movieNameInput.value = 'Fetching name...';
            try {
                const response = await fetch('/fetch-title', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ originalUrl }) });
                if (!response.ok) throw new Error('Server could not fetch title.');
                const { suggestedName } = await response.json();
                const extension = originalUrl.match(/\.(mp4|mkv|avi|mov|webm)$/i);
                const finalName = suggestedName ? (suggestedName + (extension ? extension[0] : '.mp4')) : '';
                movieNameInput.value = finalName;
            } catch (e) { movieNameInput.value = 'Could not guess name. Please enter manually.'; }
        }

        generateBtn.addEventListener('click', async () => {
          const originalUrl = originalUrlInput.value.trim();
          const movieName = movieNameInput.value.trim();
          if (!originalUrl || !movieName) { alert('Please fill in both fields.'); return; }
          generateBtn.disabled = true; generateBtn.textContent = 'Generating...';
          try {
            const response = await fetch('/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ originalUrl, movieName }) });
            if (!response.ok) throw new Error((await response.json()).error || 'Failed to generate link.');
            const { playbackUrl } = await response.json();
            generatedLinkInput.value = playbackUrl; resultBox.style.display = 'block';
          } catch (e) { alert('Error: ' + e.message);
          } finally { generateBtn.disabled = false; generateBtn.textContent = '3. Generate Playback Link'; }
        });

        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(generatedLinkInput.value).then(() => {
            copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
          });
        });

        // NEW: Admin login logic
        const adminTokenInput = document.getElementById('adminTokenInput');
        const adminLoginBtn = document.getElementById('adminLoginBtn');

        adminLoginBtn.addEventListener('click', () => {
            const token = adminTokenInput.value.trim();
            if (!token) {
                alert('Please enter your admin token.');
                return;
            }
            // Construct the admin URL and redirect the user
            window.location.href = \`\${window.location.origin}/admin?token=\${encodeURIComponent(token)}\`;
        });
      <\/script>
    </body>
    </html>
  `;
}

// Admin Page HTML for listing and deleting (no changes)
function getAdminPage(videos: any[], token: string): string {
    let videoListHtml = videos.length > 0 ? '' : '<tr><td colspan="3" style="text-align:center;">No videos generated yet.</td></tr>';
    for (const video of videos) {
        videoListHtml += `<tr id="row-${video.key}"><td><code>/stream/${video.key}</code></td><td class="original-url">${video.value}</td><td><button class="delete-btn" data-slug="${video.key}">Delete</button></td></tr>`;
    }
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Admin Panel - Link Management</title><style>body{font-family:sans-serif;background:#1a1a1a;color:#f0f0f0;padding:2rem}table{width:100%;border-collapse:collapse}th,td{padding:12px;border:1px solid #444;text-align:left;vertical-align:middle}th{background:#0af}.original-url{word-break:break-all;max-width:300px}.delete-btn{background:#e44;color:white;border:none;padding:8px 12px;cursor:pointer;border-radius:4px}.delete-btn:hover{background:#c22}</style></head><body><h1>Link Management Admin Panel</h1><table><thead><tr><th>Generated Link Path</th><th>Original URL</th><th>Action</th></tr></thead><tbody>${videoListHtml}</tbody></table><script>
        const ADMIN_TOKEN = "${token}";
        document.body.addEventListener('click', async (event) => {
            if (event.target.classList.contains('delete-btn')) {
                const button = event.target; const slug = button.dataset.slug;
                if (confirm(\`Are you sure you want to delete: \${slug}?\`)) {
                    try {
                        const response = await fetch(\`/delete/\${slug}\`, { method: 'DELETE', headers: { 'Authorization': \`Bearer \${ADMIN_TOKEN}\` } });
                        const result = await response.json();
                        if (result.success) { document.getElementById(\`row-\${slug}\`).remove(); } else { alert('Error: ' + result.message); }
                    } catch (e) { alert('An error occurred: ' + e.message); }
                }
            }
        });
    <\/script></body></html>`;
}
