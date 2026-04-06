const express = require('express');
const mime = require('mime-types');
const path = require('path');

const app = express();
const repoMetaCache = new Map();

async function fetchRaw(username, repo, branch, path) {
    return await fetch(`https://raw.githubusercontent.com/${username}/${repo}/${branch}/${path}`);
}

// 共通パス書き換え
function rewriteAbsolutePaths(content, username, repo, mimeType) {
    const basePath = `/${username}/${repo}`;
    if (mimeType.includes('text/html')) {
        return content.replace(/(href|src|action)\s*=\s*(['"])\/([^'"]*)\2/gi, `$1=$2${basePath}/$3$2`);
    } else if (mimeType.includes('text/css')) {
        return content.replace(/url\(\s*(['"]?)\/([^'"\)\s]*)\1\s*\)/gi, `url($1${basePath}/$2$1)`);
    } else if (mimeType.includes('javascript')) {
        return content.replace(/(['"])\/([^\s'"\n]+)\1/g, `$1${basePath}/$2$1`);
    }
    return content;
}

// ディレクトリリスティング用HTML生成
async function generateDirectoryListing(username, repo, branch, dirPath) {
    const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents/${dirPath}?ref=${branch}`;
    const res = await fetch(apiUrl);
    const files = await res.json();

    const itemsHtml = Array.isArray(files) ? files.map(f => `
        <a href="/${username}/${repo}/${f.path}" style="display:flex;align-items:center;padding:12px;color:#ccc;text-decoration:none;border-bottom:1px solid #222;gap:10px;">
            <span>${f.type === 'dir' ? '📁' : '📄'}</span> ${f.name}
        </a>`).join('') : '<p style="padding:20px;">No files found.</p>';

    return `
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8"><title>Index of /${dirPath}</title>
        <style>body{background:#000;color:#fff;font-family:sans-serif;padding:40px;} .box{max-width:800px;margin:0 auto;background:#0d0d0d;border:1px solid #222;border-radius:8px;overflow:hidden;}</style>
    </head>
    <body>
        <div style="max-width:800px;margin:0 auto 20px;display:flex;justify-content:space-between;align-items:center;">
            <h2>Index of /${dirPath}</h2>
            <a href="/" style="color:#888;text-decoration:none;">← GITStand Home</a>
        </div>
        <div class="box">${itemsHtml}</div>
    </body>
    </html>`;
}

// ルート（GITStandトップページ）
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// プロキシエンジン
app.get('/:username/:repo*', async (req, res) => {
    const { username, repo } = req.params;
    let reqPath = (req.params[0] || '').replace(/^\/+/, '');
    
    if (reqPath.includes('..')) return res.status(403).send('Forbidden');

    try {
        let branch = 'main';
        // 初回チェック
        let fetchRes = await fetchRaw(username, repo, branch, reqPath || 'index.html');
        if (fetchRes.status === 404) {
            branch = 'master';
            fetchRes = await fetchRaw(username, repo, branch, reqPath || 'index.html');
        }

        // 1. ファイルが見つかり、かつ index.html (または要求されたファイル) の場合
        if (fetchRes.ok) {
            const mimeType = mime.lookup(reqPath || 'index.html') || 'text/plain';
            if (mimeType.startsWith('text/') || mimeType.includes('javascript')) {
                let content = await fetchRes.text();
                res.setHeader('Content-Type', `${mimeType}; charset=utf-8`);
                res.send(rewriteAbsolutePaths(content, username, repo, mimeType));
            } else {
                const buffer = Buffer.from(await fetchRes.arrayBuffer());
                res.setHeader('Content-Type', mimeType);
                res.send(buffer);
            }
            return;
        }

        // 2. index.html が見つからない場合 -> ディレクトリ一覧を表示
        if (!reqPath || reqPath.endsWith('/')) {
            const listingHtml = await generateDirectoryListing(username, repo, branch, reqPath);
            return res.send(listingHtml);
        }

        res.status(404).send('File Not Found');
    } catch (e) {
        res.status(500).send('Proxy Engine Error');
    }
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(3000, () => console.log('GITStand Engine running on port 3000'));
}

module.exports = app;
