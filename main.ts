// main.ts (Final Smart Content-Type & Filename Version)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const kv = await Deno.openKv();
const ADMIN_TOKEN = Deno.env.get("ADMIN_TOKEN") || "fallback-admin-token";
const DOWNLOAD_TOKEN = Deno.env.get("DOWNLOAD_TOKEN") || "fallback-download-token";

console.log("Smart Proxy Server is starting...");

function slugify(text: string): string {
    return text.toString().toLowerCase()
        .replace(/\.mp4|\.mkv|\.avi|\.webm/i, '')
        .replace(/\s+/g, '-').replace(/[^\w-]/g, '')
        .replace(/--+/g, '-').replace(/^-+|-+$/g, '');
}

async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const { pathname, searchParams } = url;
    const method = req.method;

    if (pathname === "/") {
        return new Response(getLoginPageHTML(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    if (pathname === "/admin") {
        if (searchParams.get("token") !== ADMIN_TOKEN) return new Response("Forbidden", { status: 403 });
        const videos: any[] = [];
        for await (const entry of kv.list({ prefix: ["videos"] })) { videos.push({ slug: entry.key[1], url: entry.value.url, filename: entry.value.filename }); }
        const generatedLinkParam = searchParams.get("generatedLink") || "";
        return new Response(getAdminPageHTML(videos, ADMIN_TOKEN, generatedLinkParam), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    if (pathname === "/generate" && method === "POST") {
        const formData = await req.formData();
        if (formData.get("token") !== ADMIN_TOKEN) return new Response("Forbidden", { status: 403 });
        const originalUrl = formData.get("originalUrl") as string;
        const filename = formData.get("filename") as string;
        if (!originalUrl || !filename) return Response.redirect(`${url.origin}/admin?token=${ADMIN_TOKEN}&error=missing_fields`);

        const slug = slugify(filename);
        await kv.set(["videos", slug], { url: originalUrl, filename: filename });
        
        const generatedLink = `${url.origin}/download/${slug}?token=${DOWNLOAD_TOKEN}`;
        return Response.redirect(`${url.origin}/admin?token=${ADMIN_TOKEN}&generatedLink=${encodeURIComponent(generatedLink)}`);
    }

    const downloadPattern = new URLPattern({ pathname: "/download/:slug+" });
    if (downloadPattern.exec(url)) {
        const token = searchParams.get("token");
        if (token !== DOWNLOAD_TOKEN) { return new Response("Access Denied.", { status: 403 }); }

        const slug = downloadPattern.exec(url)!.pathname.groups.slug!;
        const result = await kv.get<{ url: string, filename: string }>(["videos", slug]);
        
        if (!result.value) return new Response("File link not found.", { status: 404 });
        
        const { url: originalVideoUrl, filename } = result.value;

        try {
            const range = req.headers.get("range");
            const fetchHeaders = new Headers();
            if (range) { fetchHeaders.set("range", range); }

            const videoResponse = await fetch(originalVideoUrl, { headers: fetchHeaders });
            if (!videoResponse.ok || !videoResponse.body) {
                return new Response("Failed to fetch from source.", { status: videoResponse.status });
            }
            
            const responseHeaders = new Headers();
            
            ['Content-Length', 'Content-Range', 'Accept-Ranges'].forEach(headerName => {
                if (videoResponse.headers.has(headerName)) {
                    responseHeaders.set(headerName, videoResponse.headers.get(headerName)!);
                }
            });
            
            // --- THIS IS THE SMART FIX ---
            let contentType = videoResponse.headers.get('Content-Type');
            // If the original source gives a non-video content type, force it to video/mp4.
            if (!contentType || !contentType.startsWith('video/')) {
                contentType = 'video/mp4';
            }
            responseHeaders.set('Content-Type', contentType);
            // --- END OF SMART FIX ---
            
            const shouldPlayInline = searchParams.get("play") === "true";
            responseHeaders.set('Content-Disposition', shouldPlayInline ? 'inline' : `attachment; filename="${filename}"`);

            return new Response(videoResponse.body, { status: videoResponse.status, headers: responseHeaders });
        } catch (e) {
            return new Response("Error proxying the download.", { status: 500 });
        }
    }

    if (pathname === "/delete-video" && method === "POST") {
        const formData = await req.formData();
        if (formData.get("token") !== ADMIN_TOKEN) return new Response("Forbidden", { status: 403 });
        const slugToDelete = formData.get("slug") as string;
        if (slugToDelete) { await kv.delete(["videos", slugToDelete]); }
        return Response.redirect(`${url.origin}/admin?token=${ADMIN_TOKEN}`);
    }

    return new Response("Not Found.", { status: 404 });
}

serve(handler);

function getLoginPageHTML(): string {
    return `<!DOCTYPE html><html><head><title>Admin Login</title><style>body{display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1a1a2e;font-family:sans-serif;} .container{background:#162447;padding:2.5rem;border-radius:10px;text-align:center;} h1{color:#e43f5a;} input{width:100%;padding:0.8rem;margin-bottom:1rem;border-radius:5px;} button{width:100%;padding:0.8rem;border:none;border-radius:5px;background:#e43f5a;color:white;cursor:pointer;}</style></head><body><div class="container"><h1>Admin Login</h1><form action="/admin"><input type="password" name="token" placeholder="Enter Admin Token" required><button type="submit">Login</button></form></div></body></html>`;
}

function getAdminPageHTML(videos: any[], token: string, generatedLink: string): string {
    const generatedLinkHTML = generatedLink ? `<div class="result-box"><h3>Generated Link:</h3><p>To stream, add <b>&play=true</b> to the URL.</p><input type="text" id="generated-link-input" value="${decodeURIComponent(generatedLink)}" readonly><button onclick="copyLink()">Copy Link</button></div>` : '';
    const videoRows = videos.map(v => `<tr><td><code>.../download/${v.slug}?token=...</code></td><td>${v.filename}</td><td>${v.url}</td><td><form method="POST" onsubmit="return confirm('Delete?');"><input type="hidden" name="token" value="${token}"><input type="hidden" name="slug" value="${v.slug}"><button formaction="/delete-video">Delete</button></form></td></tr>`).join('');
    return `<!DOCTYPE html><html><head><title>Download Link Generator</title><style>body{font-family:sans-serif;background:#0d1117;color:#c9d1d9;padding:2rem;} .container{max-width:1000px;margin:auto;} h1,h2{color:#58a6ff;} .panel{background:#161b22;padding:2rem;border:1px solid #30363d;border-radius:8px;margin-bottom:2rem;} form{display:grid;gap:1rem;} label{font-weight:bold;} input{width:100%;padding:0.8rem;background:#0d1117;border:1px solid #30363d;color:#c9d1d9;border-radius:6px;} button{background:#238636;color:white;padding:0.8rem;border:none;border-radius:6px;} table{width:100%;border-collapse:collapse;margin-top:1rem;table-layout:fixed;} th,td{border:1px solid #30363d;padding:0.8rem;word-wrap:break-word;} .result-box{background:#222;padding:1rem;border:1px solid #28a745; margin-top:1.5rem;}</style></head>
    <body><div class="container"><h1>Download & Stream Link Generator</h1>
    <div class="panel"><h2>Generate New Link</h2><form action="/generate" method="POST"><input type="hidden" name="token" value="${token}"><label>Original URL:</label><input type="text" name="originalUrl" required><label>Filename (e.g., movie-name.mp4 or movie-name.mkv):</label><input type="text" name="filename" required><button type="submit">Generate Link</button></form>${generatedLinkHTML}</div>
    <div class="panel"><h2>Generated Links</h2><table><thead><tr><th>Generated Path</th><th>Filename</th><th>Original URL</th><th>Action</th></tr></thead><tbody>${videoRows}</tbody></table></div>
    <script>function copyLink(){const i=document.getElementById('generated-link-input');i.select();navigator.clipboard.writeText(i.value).then(()=>{alert('Link copied!')});}</script>
    </body></html>`;
}
