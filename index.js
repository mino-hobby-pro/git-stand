const express = require('express');
const mime = require('mime-types');
const path = require('path'); // 追加
const app = express();

// --- 設定 & キャッシュ ---
const repoMetaCache = new Map();

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

// 1. トップページ (public/index.html を返すように変更)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
