// main.ts (Final "Force Download" Version with Admin Panel Fix)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const kv = await Deno.openKv();
const ADMIN_TOKEN = Deno.env.get("ADMIN_TOKEN") || "fallback-admin-token";

console.log("Force Download Proxy Server (Admin Fix) is starting...");

function slugify(text: string): string {
    return text.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-.]+/g, '').replace(/\-\-+/g, '-').replace(/^-+|-+$/g, '');
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
        for await (const entry of kv.list({ prefix: ["videos"] })) { videos.push({ slug: entry.key[1], url: entry.value }); }
        
        const generatedLinkParam = searchParams.get("generatedLink") || "";
        return new Response(getAdminPageHTML(videos, ADMIN_TOKEN, generatedLinkParam), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    if (pathname === "/generate" && method === "POST") {
        const formData = await req.formData();
        if (formData.get("token") !== ADMIN_TOKEN) return new Response("Forbidden", { status: 403 });
        const originalUrl = formData.get("originalUrl") as string;
        const movieName = formData.get("movieName") as string;
        if (!originalUrl || !movieName) return Response.redirect(`${url.origin}/admin?token=${ADMIN_TOKEN}&error=missing_fields`);

        const fileSlug = slugify(movieName);
        await kv.set(["videos", fileSlug], originalUrl);
        
        const generatedLink = `${url.origin}/download/${fileSlug}?token=${ADMIN_TOKEN}`;
        return Response.redirect(`${url.origin}/admin?token=${ADMIN_TOKEN}&generatedLink=${encodeURIComponent(generatedLink)}`);
    }

    const downloadPattern = new URLPattern({ pathname: "/download/:slug+" });
    if (downloadPattern.exec(url)) {
        const token = searchParams.get("token");
        if (token !== ADMIN_TOKEN) {
            return new Response("Access Denied: Invalid or missing token.", { status: 403 });
        }

        const slug = downloadPattern.exec(url)!.pathname.groups.slug!;
        const result = await kv.get<string>(["videos", slug]);
        const originalVideoUrl = result.value;
        if (!originalVideoUrl) return new Response("File link not found.", { status: 404 });

        try {
            const videoResponse = await fetch(originalVideoUrl);
            if (!videoResponse.ok || !videoResponse.body) {
                return new Response("Failed to fetch the file from the source.", { status: videoResponse.status });
            }
            
            const responseHeaders = new Headers();
            const filename = slug;

            responseHeaders.set('Content-Disposition', `attachment; filename="${filename}"`);
            responseHeaders.set('Content-Type', 'application/octet-stream');
            responseHeaders.set('Content-Length', videoResponse.headers.get('Content-Length') || '0');

            return new Response(videoResponse.body, { status: 200, headers: responseHeaders });

        } catch (e) {
            console.error("Download proxy error:", e);
            return new Response("Error proxying the download.", { status: 500 });
        }
    }

    if (pathname === "/delete-video" && method === "POST") {
        const formData = await req.formData();
        if (formData.get("token") !== ADMIN_TOKEN) return new Response("Forbidden", { status: 403 });
        const slugToDelete = formData.get("slug") as string;
        if (slugToDelete) {
            await kv.delete(["videos", slugToDelete]);
        }
        return Response.redirect(`${url.origin}/admin?token=${ADMIN_TOKEN}`);
    }

    return new Response("Not Found", { status: 404 });
}

serve(handler);

function getLoginPageHTML(): string {
    return `<!DOCTYPE html><html><head><title>Admin Login</title><style>body{display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1a1a2e;font-family:sans-serif;} .container{background:#162447;padding:2.5rem;border-radius:10px;text-align:center;} h1{color:#e43f5a;} input{width:100%;padding:0.8rem;margin-bottom:1rem;border-radius:5px;} button{width:100%;padding:0.8rem;border:none;border-radius:5px;background:#e43f5a;color:white;cursor:pointer;}</style></head><body><div class="container"><h1>Admin Login</h1><form action="/admin"><input type="password" name="token" placeholder="Enter Admin Token" required><button type="submit">Login</button></form></div></body></html>`;
}

function getAdminPageHTML(videos: any[], token: string, generatedLink: string): string {
    const generatedLinkHTML = generatedLink ? `
        <div class="result-box">
            <h3>Generated App Download Link:</h3>
            <input type="text" id="generated-link-input" value="${decodeURIComponent(generatedLink)}" readonly>
            <button onclick="copyLink()">Copy</button>
        </div>
    ` : '';

    const videoRows = videos.map(v => `<tr><td><code>.../download/${v.slug}?token=...</code></td><td>${v.url}</td><td><form method="POST" onsubmit="return confirm('Delete?');"><input type="hidden" name="token" value="${token}"><input type="hidden" name="slug" value="${v.slug}"><button formaction="/delete-video">Delete</button></form></td></tr>`).join('');
    return `<!DOCTYPE html><html><head><title>Download Link Generator</title>
    <style>body{font-family:sans-serif;background:#0d1117;color:#c9d1d9;padding:2rem;} .container{max-width:1000px;margin:auto;} h1,h2{color:#58a6ff;} .panel{background:#161b22;padding:2rem;border:1px solid #30363d;border-radius:8px;margin-bottom:2rem;} form{display:grid;gap:1rem;} label{font-weight:bold;} input{width:100%;padding:0.8rem;background:#0d1117;border:1px solid #30363d;color:#c9d1d9;border-radius:6px;} button{background:#238636;color:white;padding:0.8rem;border:none;border-radius:6px;} table{width:100%;border-collapse:collapse;margin-top:1rem;} th,td{border:1px solid #30363d;padding:0.8rem;} .result-box{background:#222;padding:1rem;border:1px solid #28a745; margin-top:1.5rem; display: flex; flex-direction: column; gap: 0.5rem;}</style></head>
    <body><div class="container"><h1>Download Link Generator</h1>
    <div class="panel"><h2>Generate New Download Link</h2><form action="/generate" method="POST"><input type="hidden" name="token" value="${token}"><label>Original URL:</label><input type="text" name="originalUrl" required><label>Filename (e.g., movie-name.mp4):</label><input type="text" name="movieName" required><button type="submit">Generate Link</button></form>${generatedLinkHTML}</div>
    <div class="panel"><h2>Generated Links</h2><table><thead><tr><th>Generated Path</th><th>Original URL</th><th>Action</th></tr></thead><tbody>${videoRows}</tbody></table></div>
    <script>
        function copyLink() {
            const input = document.getElementById('generated-link-input');
            input.select();
            input.setSelectionRange(0, 99999); // For mobile devices
            navigator.clipboard.writeText(input.value).then(() => {
                alert('Link copied to clipboard!');
            });
        }
    </script>
    </body></html>`;
}
