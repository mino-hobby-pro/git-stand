const express = require('express');
const mime = require('mime-types');
const app = express();

// --- 設定 & キャッシュ ---
const repoMetaCache = new Map();

// --- HTMLテンプレート: ランディングページ (GITStand) ---
const landingPageHTML = `
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GITStand | Instant Deployment</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600&family=JetBrains+Mono&display=swap" rel="stylesheet">
    <style>
        :root { --bg: #000; --card: #0d0d0d; --border: #222; --accent: #fff; --text-muted: #888; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: var(--bg); color: #fff; font-family: 'Inter', sans-serif; overflow-x: hidden; }
        .navbar { height: 70px; border-bottom: 1px solid var(--border); display: flex; align-items: center; padding: 0 40px; justify-content: space-between; position: sticky; top: 0; background: rgba(0,0,0,0.8); backdrop-filter: blur(10px); z-index: 100; }
        .logo { font-weight: 600; font-size: 22px; letter-spacing: -1px; display: flex; align-items: center; gap: 10px; cursor: pointer; }
        .logo-icon { width: 24px; height: 24px; border: 2px solid #fff; border-radius: 50%; position: relative; }
        .logo-icon::after { content: ''; position: absolute; width: 8px; height: 8px; background: #fff; border-radius: 50%; top: 50%; left: 50%; transform: translate(-50%, -50%); }
        .container { max-width: 900px; margin: 80px auto; padding: 0 20px; text-align: center; }
        h1 { font-size: 48px; font-weight: 300; margin-bottom: 40px; letter-spacing: -2px; }
        .input-group { position: relative; margin-bottom: 40px; }
        #repoInput { width: 100%; background: var(--card); border: 1px solid var(--border); padding: 24px 30px; border-radius: 100px; color: #fff; font-size: 18px; outline: none; transition: 0.3s; text-align: center; }
        #repoInput:focus { border-color: var(--accent); box-shadow: 0 0 30px rgba(255,255,255,0.05); }
        .file-browser { background: var(--card); border: 1px solid var(--border); border-radius: 12px; text-align: left; display: none; animation: fadeIn 0.5s ease; overflow: hidden; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .browser-header { padding: 15px 25px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: #151515; }
        .file-item { padding: 12px 25px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 15px; color: #ccc; }
        .deploy-btn { background: #fff; color: #000; border: none; padding: 10px 24px; border-radius: 100px; font-weight: 600; cursor: pointer; transition: 0.3s; }
        .log-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.98); z-index: 200; display: none; flex-direction: column; padding: 60px; font-family: 'JetBrains Mono', monospace; }
        .log-line { margin-bottom: 8px; font-size: 14px; color: #0f0; opacity: 0; animation: logEntry 0.1s forwards; }
        @keyframes logEntry { to { opacity: 1; } }
        .success-box { margin-top: 40px; display: none; text-align: center; }
        .live-btn { background: #fff; color: #000; text-decoration: none; padding: 15px 40px; border-radius: 100px; font-weight: 600; font-size: 18px; display: inline-block; }
    </style>
</head>
<body>
    <nav class="navbar"><div class="logo" onclick="location.reload()"><div class="logo-icon"></div> GITStand</div></nav>
    <div class="container">
        <h1>Deploy anything from GitHub.</h1>
        <div class="input-group">
            <input type="text" id="repoInput" placeholder="https://github.com/username/repository" autocomplete="off">
        </div>
        <div id="browser" class="file-browser">
            <div class="browser-header"><span id="repoNameDisplay">Files</span><button class="deploy-btn" onclick="startDeploy()">Deploy | 展開</button></div>
            <div id="fileList"></div>
        </div>
    </div>
    <div id="logOverlay" class="log-overlay">
        <div id="logContent"></div>
        <div id="successBox" class="success-box">
            <h2 style="font-size: 40px; margin-bottom: 20px;">Success!</h2>
            <a href="#" id="liveLink" class="live-btn">Open Live Site</a>
        </div>
    </div>
    <script>
        const input = document.getElementById('repoInput');
        input.addEventListener('input', async (e) => {
            const match = e.target.value.match(/github\.com\\/([^/]+)\\/([^/]+)/);
            if (match) {
                const [_, user, repo] = match;
                const repoClean = repo.replace('.git', '');
                const res = await fetch(\`https://api.github.com/repos/\${user}/\${repoClean}/contents/\`);
                const data = await res.json();
                if (!Array.isArray(data)) return;
                document.getElementById('repoNameDisplay').innerText = \`\${user} / \${repoClean}\`;
                document.getElementById('fileList').innerHTML = data.map(f => \`<div class="file-item"><span>\${f.type === 'dir' ? '📁' : '📄'}</span> \${f.name}</div>\`).join('');
                document.getElementById('browser').style.display = 'block';
                window.currentRepo = { user, repo: repoClean, hasIndex: data.some(f => f.name === 'index.html') };
            }
        });
        async function startDeploy() {
            document.getElementById('logOverlay').style.display = 'flex';
            const logs = ["Initializing Engine...", "Connecting to GitHub...", "Analyzing project structure...", "Rewriting absolute paths...", "Optimizing assets...", "Finalizing edge deployment..."];
            for (const log of logs) {
                const line = document.createElement('div');
                line.className = 'log-line';
                line.innerText = '> ' + log;
                document.getElementById('logContent').appendChild(line);
                await new Promise(r => setTimeout(r, 600));
            }
            document.getElementById('successBox').style.display = 'block';
            document.getElementById('liveLink').href = \`/\${window.currentRepo.user}/\${window.currentRepo.repo}/\`;
        }
    </script>
</body>
</html>
`;

// --- ヘルパー関数 ---
async function fetchRaw(user, repo, branch, path) {
    return await fetch(`https://raw.githubusercontent.com/${user}/${repo}/${branch}/${path}`);
}

function rewritePaths(content, user, repo, mimeType) {
    const base = `/${user}/${repo}`;
    if (mimeType.includes('html')) {
        return content.replace(/(href|src|action|srcset)\s*=\s*(['"])\/([^'"]*)\2/gi, `$1=$2${base}/$3$2`);
    } else if (mimeType.includes('css')) {
        return content.replace(/url\(\s*(['"]?)\/([^'"\)\s]*)\1\s*\)/gi, `url($1${base}/$2$1)`);
    } else if (mimeType.includes('javascript')) {
        return content.replace(/(['"])\/([^\s'"\n]+)\1/g, `$1${base}/$2$1`);
    }
    return content;
}

async function getRepoMeta(user, repo) {
    const key = `${user}/${repo}`;
    if (repoMetaCache.has(key)) return repoMetaCache.get(key);
    
    let branch = 'main';
    let isStatic = true;
    let res = await fetchRaw(user, repo, 'main', 'package.json');
    if (!res.ok) {
        res = await fetchRaw(user, repo, 'master', 'package.json');
        if (res.ok) { branch = 'master'; isStatic = false; }
        else {
            const checkMaster = await fetchRaw(user, repo, 'master', 'README.md');
            if (checkMaster.ok) branch = 'master';
        }
    } else { isStatic = false; }

    const meta = { branch, isStatic };
    repoMetaCache.set(key, meta);
    return meta;
}

// --- メインルーティング ---

// 1. トップページ
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 2. プロキシエンジン
app.get('/:username/:repo*', async (req, res) => {
    const { username, repo } = req.params;
    let reqPath = (req.params[0] || '').replace(/^\/+/, '');

    if (reqPath.includes('..')) return res.status(403).send('Forbidden');

    try {
        const meta = await getRepoMeta(username, repo);

        // ルートアクセス時の正規化
        if (reqPath === '') {
            if (!req.originalUrl.endsWith('/')) return res.redirect(301, `/${username}/${repo}/`);
            reqPath = 'index.html';
        }

        // ファイル取得試行ロジック (file -> .html -> /index.html)
        let fetchRes = await fetchRaw(username, repo, meta.branch, reqPath);
        let finalPath = reqPath;

        if (!fetchRes.ok && !reqPath.includes('.')) {
            const tryHtml = await fetchRaw(username, repo, meta.branch, `${reqPath}.html`);
            if (tryHtml.ok) { fetchRes = tryHtml; finalPath = `${reqPath}.html`; }
            else {
                const tryIndex = await fetchRaw(username, repo, meta.branch, `${reqPath}/index.html`);
                if (tryIndex.ok) { 
                    if (!req.originalUrl.endsWith('/')) return res.redirect(301, req.originalUrl + '/');
                    fetchRes = tryIndex; finalPath = `${reqPath}/index.html`; 
                }
            }
        }

        // --- ディレクトリリスティング (index.htmlがない場合) ---
        if (!fetchRes.ok && (reqPath === 'index.html' || req.originalUrl.endsWith('/'))) {
            const apiPath = reqPath === 'index.html' ? '' : reqPath;
            const apiRes = await fetch(`https://api.github.com/repos/${username}/${repo}/contents/${apiPath}?ref=${meta.branch}`);
            const files = await apiRes.json();
            
            if (Array.isArray(files)) {
                const listItems = files.map(f => `
                    <a href="/${username}/${repo}/${f.path}" style="display:flex;align-items:center;padding:15px;color:#ccc;text-decoration:none;border-bottom:1px solid #222;gap:15px;transition:0.2s;" onmouseover="this.style.background='#111'" onmouseout="this.style.background='transparent'">
                        <span style="font-size:18px">${f.type === 'dir' ? '📁' : '📄'}</span>
                        <span style="flex:1">${f.name}</span>
                        <span style="color:#555;font-size:12px">${f.size ? (f.size/1024).toFixed(1)+'KB' : ''}</span>
                    </a>`).join('');

                return res.send(`
                    <!DOCTYPE html><html><head><meta charset="UTF-8"><title>Index of /${reqPath}</title>
                    <style>body{background:#000;color:#fff;font-family:sans-serif;padding:50px;} .box{max-width:800px;margin:0 auto;background:#0d0d0d;border:1px solid #222;border-radius:12px;overflow:hidden;}</style></head>
                    <body>
                        <div style="max-width:800px;margin:0 auto 20px;display:flex;justify-content:space-between;align-items:center;">
                            <h2 style="font-weight:300">Index of <span style="color:#888">/${reqPath}</span></h2>
                            <a href="/" style="color:#555;text-decoration:none;font-size:14px">GITStand Home</a>
                        </div>
                        <div class="box">${listItems}</div>
                    </body></html>`);
            }
        }

        if (!fetchRes.ok) return res.status(404).send('404: File Not Found on GitHub');

        // --- レポ判定 (Nodeプロジェクト拒否) ---
        if (finalPath.endsWith('index.html') && !meta.isStatic) {
            return res.status(400).send('<h2>Error</h2><p>This is a Node.js project (package.json found). Only static sites are supported.</p>');
        }

        // --- コンテンツ配信 ---
        const mimeType = mime.lookup(finalPath) || 'text/plain';
        const isText = mimeType.startsWith('text/') || mimeType.includes('javascript') || mimeType.includes('json');
        
        res.setHeader('Content-Type', isText ? `${mimeType}; charset=utf-8` : mimeType);
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

        if (isText) {
            let text = await fetchRes.text();
            res.send(rewritePaths(text, username, repo, mimeType));
        } else {
            res.send(Buffer.from(await fetchRes.arrayBuffer()));
        }

    } catch (e) {
        console.error(e);
        res.status(500).send('Proxy Engine Error');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`GITStand Ultimate running on port ${PORT}`));

module.exports = app;
