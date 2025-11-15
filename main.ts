// main.ts (Final Complete Version with All Features)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { getCookies, setCookie } from "https://deno.land/std@0.224.0/http/cookie.ts";

const kv = await Deno.openKv();
const SECRET_TOKEN = Deno.env.get("SECRET_TOKEN") || "fallback-secret-token";
const ADMIN_TOKEN = Deno.env.get("ADMIN_TOKEN") || "fallback-admin-token";

console.log("Clean URL Proxy with Landing Page is starting...");

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

    if (pathname === "/fetch-title" && method === "POST") {
        try {
            const { originalUrl } = await req.json();
            return new Response(JSON.stringify({ suggestedName: extractAndCleanMovieName(originalUrl) }));
        } catch { return new Response(JSON.stringify({ suggestedName: "" }), { status: 400 }); }
    }

    if (pathname === "/generate" && method === "POST") {
        const { originalUrl, movieName } = await req.json();
        if (!originalUrl || !movieName) return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400 });
        const fileSlug = slugify(movieName);
        await kv.set(["videos", fileSlug], originalUrl);
        const cleanUrl = `${url.origin}/play/${fileSlug}`;
        return new Response(JSON.stringify({ cleanUrl }), { headers: { "Content-Type": "application/json" } });
    }

    const playPattern = new URLPattern({ pathname: "/play/:slug+" });
    if (playPattern.exec(url)) {
        const slug = playPattern.exec(url)!.pathname.groups.slug!;
        const result = await kv.get<string>(["videos", slug]);
        if (!result.value) return new Response("Link not found.", { status: 404 });
        const appLink = `${url.origin}/stream/${slug}?token=${SECRET_TOKEN}`;
        const browserLink = `${url.origin}/auth/${slug}?token=${SECRET_TOKEN}`;
        return new Response(getLandingPageHTML(slug, appLink, browserLink), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    
    const authPattern = new URLPattern({ pathname: "/auth/:slug+" });
    if (authPattern.exec(url)) {
        if (searchParams.get("token") !== SECRET_TOKEN) return new Response("Unauthorized.", { status: 401 });
        const slug = authPattern.exec(url)!.pathname.groups.slug!;
        const finalUrl = `${url.origin}/stream/${slug}?token=${SECRET_TOKEN}`;
        const headers = new Headers({ Location: finalUrl });
        setCookie(headers, { name: "access_token", value: SECRET_TOKEN, maxAge: 365 * 24 * 60 * 60, path: "/", httpOnly: true, secure: true });
        return new Response(null, { status: 302, headers });
    }
    
    const streamPattern = new URLPattern({ pathname: "/stream/:slug+" });
    if (streamPattern.exec(url)) {
        const token = searchParams.get("token");
        const cookies = getCookies(req.headers);
        
        if (token !== SECRET_TOKEN && cookies.access_token !== SECRET_TOKEN) {
            return new Response("Access Denied.", { status: 403 });
        }

        const slug = streamPattern.exec(url)!.pathname.groups.slug!;
        const result = await kv.get<string>(["videos", slug]);
        const originalVideoUrl = result.value;
        if (!originalVideoUrl) return new Response("Video not found.", { status: 404 });

        try {
            const range = req.headers.get("range");
            const fetchHeaders = new Headers();
            if (range) { fetchHeaders.set("range", range); }
            const videoResponse = await fetch(originalVideoUrl, { headers: fetchHeaders });
            if (!videoResponse.ok || !videoResponse.body) return new Response("Failed to fetch video.", { status: videoResponse.status });
            
            const responseHeaders = new Headers();
            responseHeaders.set('Content-Length', videoResponse.headers.get('Content-Length') || '0');
            responseHeaders.set('Accept-Ranges', 'bytes');
            if (videoResponse.headers.has('Content-Range')) {
                responseHeaders.set('Content-Range', videoResponse.headers.get('Content-Range')!);
            }
            responseHeaders.set('Content-Type', 'video/mp4');
            responseHeaders.set('Content-Disposition', 'inline');
            responseHeaders.set("Access-Control-Allow-Origin", "*");

            return new Response(videoResponse.body, { status: videoResponse.status, headers: responseHeaders });
        } catch (e) { 
            return new Response("Error streaming video.", { status: 500 });
        }
    }

    if (pathname === "/admin") {
        if (searchParams.get("token") !== ADMIN_TOKEN) return new Response("Forbidden", { status: 403 });
        const videos: any[] = [];
        for await (const entry of kv.list({ prefix: ["videos"] })) { videos.push({ slug: entry.key[1], url: entry.value }); }
        return new Response(getAdminPageHTML(videos, ADMIN_TOKEN), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    if (pathname === "/delete-video" && method === "POST") {
        const formData = await req.formData();
        if (formData.get("token") !== ADMIN_TOKEN) return new Response("Forbidden", { status: 403 });
        const slugToDelete = formData.get("slug") as string;
        if (slugToDelete) {
            await kv.delete(["videos", slugToDelete]);
        }
        return Response.redirect(`${url.origin}/admin?token=${ADMIN_TOKEN}`, 302);
    }

    return new Response("Not Found.", { status: 404 });
}

serve(handler);

function getGeneratorPageHTML(): string {
  return `
    <!DOCTYPE html><html lang="en">
    <head><meta charset="UTF-8"><title>Clean Link Generator</title>
    <style>
        :root { --bg: #1a1a2e; --primary: #1f4068; --secondary: #162447; --accent: #00aaff; --text: #e0e0e0; --success: #28a745; --admin-color: #ffae42; }
        body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:var(--bg);color:var(--text);margin:2rem 0;display:flex;flex-direction:column;align-items:center;gap:2rem;}
        .container{width:90%;max-width:960px;background:var(--secondary);padding:2rem;border-radius:10px;}
        h1, h2 {color:var(--accent);border-bottom:2px solid var(--accent);padding-bottom:0.5rem;}
        label{display:block;margin-bottom:.5rem;font-weight:bold;}
        input[type="text"], input[type="password"]{width:100%;padding:0.8rem;background:var(--bg);border:1px solid var(--primary);color:var(--text);border-radius:5px;font-size:1rem;margin-bottom:1rem;}
        button{width:100%;padding:0.8rem 1.5rem;background:var(--accent);color:white;border:none;border-radius:5px;cursor:pointer;font-weight:bold;}
        .result-box{margin-top:1.5rem;display:none;}.result-wrapper{display:flex;gap:1rem;}
        #generatedLink{flex-grow:1;}
        #copyBtn{background:var(--success);}
        h2.admin-header { color: var(--admin-color); }
        #adminLoginBtn { background-color: var(--admin-color); }
    </style>
    </head><body><div class="container"><h1>Auto-Suggest URL Generator</h1>
    <label for="originalUrl">1. Paste Original Video URL:</label><input type="text" id="originalUrl" placeholder="https://example.com/movie.name.2025.mp4">
    <label for="movieName">2. Verify or Edit Movie Name (e.g., movie-name.mp4):</label><input type="text" id="movieName" placeholder="Will be auto-filled..."><button id="generateBtn">3. Generate Clean Link</button>
    <div class="result-box" id="resultBox"><label for="generatedLink">Your Clean URL:</label><div class="result-wrapper"><input type="text" id="generatedLink" readonly><button id="copyBtn">Copy</button></div></div></div>
    <div class="container"><h2 class="admin-header">Admin Panel</h2><label for="adminTokenInput">Enter Admin Token to Manage Links:</label><input type="password" id="adminTokenInput" placeholder="Your secret admin token"><button id="adminLoginBtn">Go to Admin Dashboard</button></div>
    <script>
        const originalUrlInput=document.getElementById('originalUrl'),movieNameInput=document.getElementById('movieName'),generateBtn=document.getElementById('generateBtn'),copyBtn=document.getElementById('copyBtn'),resultBox=document.getElementById('resultBox'),generatedLinkInput=document.getElementById('generatedLink');
        originalUrlInput.addEventListener('blur',()=>fetchTitle(originalUrlInput.value));async function fetchTitle(e){if(!e.startsWith('http'))return;movieNameInput.value='Fetching...';try{const t=await fetch('/fetch-title',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({originalUrl:e})}),{suggestedName:n}=await t.json(),a=e.match(/\.(mp4|mkv|avi)$/i);movieNameInput.value=n?n+(a?a[0]:'.mp4'):''}catch{movieNameInput.value='Could not guess.'}}
        generateBtn.addEventListener('click',async()=>{const e=originalUrlInput.value.trim(),t=movieNameInput.value.trim();if(!e||!t)return alert('Please fill all fields.');generateBtn.disabled=!0,generateBtn.textContent='Generating...';try{const n=await fetch('/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({originalUrl:e,movieName:t})}),{cleanUrl:a}=await n.json();generatedLinkInput.value=a,resultBox.style.display='block'}catch(e){alert('Error: '+e.message)}finally{generateBtn.disabled=!1,generateBtn.textContent='Generate Clean Link'}});
        copyBtn.addEventListener('click',()=>{navigator.clipboard.writeText(generatedLinkInput.value).then(()=>{copyBtn.textContent='Copied!',setTimeout(()=>{copyBtn.textContent='Copy'},2e3)})});
        document.getElementById('adminLoginBtn').addEventListener('click',()=>{const e=document.getElementById('adminTokenInput').value.trim();e&&(window.location.href='/admin?token='+e)});
    </script></body></html>`;
}

function getLandingPageHTML(slug: string, appLink: string, browserLink: string): string {
    return `
    <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Get Your Link</title>
    <style>
        body{font-family:sans-serif;background:#1a1a2e;color:#e0e0e0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;}
        .container{background:#162447;padding:2rem;border-radius:10px;text-align:center;width:90%;max-width:500px;}
        h1{color:#00aaff;} p{opacity:0.8;}
        .link-box{background:#0d1117;padding:1rem;border-radius:5px;word-break:break-all;margin:1.5rem 0;text-align:left;}
        .btn-group{display:grid;grid-template-columns:1fr;gap:1rem;}
        .btn{display:block;padding:0.8rem;text-decoration:none;border-radius:5px;font-weight:bold;cursor:pointer;}
        .primary-btn{background:#00aaff;color:white;} .secondary-btn{background:#28a745;color:white;}
    </style></head><body><div class="container"><h1>Your Video is Ready</h1>
    <p>Use the links below to watch in your browser or copy the special link for your app.</p>
    <a href="${browserLink}" class="btn primary-btn" style="width:100%;margin-bottom:1rem;">Play in Browser</a>
    <p><strong>For Movie App Users:</strong></p><div class="link-box" id="app-link-text">${appLink}</div>
    <div class="btn-group"><button id="copy-btn" class="btn secondary-btn">Copy App Link</button></div></div>
    <script>document.getElementById('copy-btn').addEventListener('click',()=>{const e=document.getElementById('app-link-text').textContent;navigator.clipboard.writeText(e).then(()=>{alert('App Link Copied!')})});</script>
    </body></html>`;
}

function getAdminPageHTML(videos: any[], token: string): string {
    const videoRows = videos.map(v => `<tr><td><code>/play/${v.slug}</code></td><td>${v.url}</td><td><form method="POST" onsubmit="return confirm('Delete this link?');"><input type="hidden" name="token" value="${token}"><input type="hidden" name="slug" value="${v.slug}"><button formaction="/delete-video">Delete</button></form></td></tr>`).join('');
    return `<!DOCTYPE html><html><head><title>Link Management</title><style>body{font-family:sans-serif;background:#0d1117;color:#c9d1d9;padding:2rem;} .container{max-width:1000px;margin:auto;} h1{color:#58a6ff;} table{width:100%;border-collapse:collapse;margin-top:1rem;} th,td{border:1px solid #30363d;padding:0.8rem;} th{background:#21262d;} a{color:#58a6ff;}</style></head>
    <body><div class="container"><h1>Generated Links</h1><a href="/">&larr; Back to Generator</a><table><thead><tr><th>Clean URL Path</th><th>Original URL</th><th>Action</th></tr></thead><tbody>${videoRows}</tbody></table></div></body></html>`;
}
