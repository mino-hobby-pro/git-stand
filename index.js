const express = require('express');
const mime = require('mime-types');

const app = express();

// Vercelの実行コンテキスト間でメタデータを保持するためのインメモリキャッシュ
// GitHubへの無駄なリクエストを減らし高速化する
const repoMetaCache = new Map();

// GitHub Rawからファイルを取得する基本関数
async function fetchRaw(username, repo, branch, path) {
    const url = `https://raw.githubusercontent.com/${username}/${repo}/${branch}/${path}`;
    return await fetch(url);
}

// レポジトリのブランチ(main/master)とpackage.jsonの有無を検証してキャッシュする
async function getRepoMeta(username, repo) {
    const cacheKey = `${username}/${repo}`;
    if (repoMetaCache.has(cacheKey)) {
        return repoMetaCache.get(cacheKey);
    }

    let branch = 'main';
    let isStatic = true;

    // mainのpackage.jsonをチェック
    let pkgRes = await fetchRaw(username, repo, 'main', 'package.json');
    if (!pkgRes.ok && pkgRes.status === 404) {
        // mainになければmasterのpackage.jsonをチェック
        pkgRes = await fetchRaw(username, repo, 'master', 'package.json');
        if (pkgRes.ok) {
            branch = 'master';
            isStatic = false;
        } else if (pkgRes.status === 404) {
            // masterにもpackage.jsonがない -> mainかmasterか確定させるためにREADME等を探す
            const checkMaster = await fetchRaw(username, repo, 'master', '');
            if (checkMaster.ok) branch = 'master';
        }
    } else if (pkgRes.ok) {
        isStatic = false;
    }

    const meta = { branch, isStatic };
    // 5分間キャッシュ (Vercelのインスタンス生存期間内)
    repoMetaCache.set(cacheKey, meta);
    setTimeout(() => repoMetaCache.delete(cacheKey), 5 * 60 * 1000);

    return meta;
}

// 絶対パスを /username/repo/ 始まりに書き換えるコアロジック
function rewriteAbsolutePaths(content, username, repo, mimeType) {
    const basePath = `/${username}/${repo}`;

    if (mimeType.includes('text/html')) {
        // HTML: href="/...", src="/...", action="/...", srcset="/...", data-src="/..." などを置換
        const htmlRegex = /(href|src|action|srcset|data-src|data-href)\s*=\s*(['"])\/([^'"]*)\2/gi;
        content = content.replace(htmlRegex, `$1=$2${basePath}/$3$2`);
    } 
    else if (mimeType.includes('text/css')) {
        // CSS: url("/..."), url('/...'), url(/...) を置換
        const cssRegex = /url\(\s*(['"]?)\/([^'"\)\s]*)\1\s*\)/gi;
        content = content.replace(cssRegex, `url($1${basePath}/$2$1)`);
    } 
    else if (mimeType.includes('application/javascript') || mimeType.includes('text/javascript')) {
        // JS: "/..." や '/...' のような文字列リテラルを置換（スペースを含まないパス状の文字列のみ）
        const jsRegex = /(['"])\/([^\s'"\n]+)\1/g;
        // 単純な "/" のみの指定（ルートへのリダイレクトなど）も対応
        const jsRootRegex = /(['"])\/(['"])/g;
        
        content = content.replace(jsRegex, `$1${basePath}/$2$1`);
        content = content.replace(jsRootRegex, `$1${basePath}/$2`);
    }

    return content;
}

app.get('/:username/:repo*', async (req, res) => {
    const { username, repo } = req.params;
    let reqPath = req.params[0] || '';

    // URLの先頭の不要なスラッシュを削除
    reqPath = reqPath.replace(/^\/+/, '');

    // セキュリティ: ディレクトリトラバーサル攻撃を防ぐ
    if (reqPath.includes('..')) {
        return res.status(403).send('Forbidden');
    }

    try {
        // 1. レポジトリのメタデータ（ブランチと静的サイト判定）を取得
        const meta = await getRepoMeta(username, repo);

        if (!meta.isStatic) {
            return res.status(400).send(`
                <h2>エラー: Node.jsプロジェクトが検出されました</h2>
                <p>リポジトリ内に <code>package.json</code> が存在するため、静的サイトとしての配信を拒否しました。<br>
                HTML / CSS / JS / 画像 などで構成された純粋な静的リポジトリのみ対応しています。</p>
            `);
        }

        // ルートアクセス時の処理
        if (reqPath === '') {
            if (!req.originalUrl.endsWith('/')) {
                return res.redirect(301, `/${username}/${repo}/`);
            }
            reqPath = 'index.html';
        }

        let fetchRes = null;
        let finalPath = reqPath;
        let isDirectoryRedirectNeeded = false;

        // 2. パスの自動探索ロジック（ファイル -> .html -> /index.html の順で探索）
        fetchRes = await fetchRaw(username, repo, meta.branch, reqPath);

        if (!fetchRes.ok && fetchRes.status === 404) {
            // パターンA: 拡張子を省略したアクセス (.html を試す)
            if (!reqPath.includes('.')) {
                const htmlPath = `${reqPath}.html`;
                const tryHtml = await fetchRaw(username, repo, meta.branch, htmlPath);
                if (tryHtml.ok) {
                    fetchRes = tryHtml;
                    finalPath = htmlPath;
                } else {
                    // パターンB: ディレクトリへのアクセス (ディレクトリ内の index.html を試す)
                    const indexPath = `${reqPath}/index.html`;
                    const tryIndex = await fetchRaw(username, repo, meta.branch, indexPath);
                    if (tryIndex.ok) {
                        fetchRes = tryIndex;
                        finalPath = indexPath;
                        // 末尾にスラッシュがない状態でディレクトリにアクセスされた場合、
                        // 相対パス（./style.css等）が壊れるためリダイレクトフラグを立てる
                        if (!req.originalUrl.endsWith('/')) {
                            isDirectoryRedirectNeeded = true;
                        }
                    }
                }
            }
        }

        // ディレクトリアクセス時の正規化リダイレクト
        if (isDirectoryRedirectNeeded) {
            return res.redirect(301, req.originalUrl + '/');
        }

        // どこを探しても見つからなかった場合
        if (!fetchRes || !fetchRes.ok) {
            return res.status(404).send(`404 Not Found: ${reqPath} はリポジトリ内に存在しません。`);
        }

        // 3. MIMEタイプの判定とヘッダー設定
        const mimeType = mime.lookup(finalPath) || 'text/plain';
        const isTextFile = mimeType.startsWith('text/') || mimeType.includes('javascript') || mimeType.includes('json');
        
        // 文字化け防止のためテキストにはcharsetを付与
        res.setHeader('Content-Type', isTextFile ? `${mimeType}; charset=utf-8` : mimeType);
        
        // Vercelのエッジキャッシュ設定（1時間キャッシュ、バックグラウンド更新）
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

        // 4. データ処理（テキストの書き換え または バイナリの直接転送）
        if (isTextFile) {
            let content = await fetchRes.text();
            // HTML, CSS, JSの中の絶対パスを書き換える
            content = rewriteAbsolutePaths(content, username, repo, mimeType);
            res.send(content);
        } else {
            // 画像、フォント、動画などのバイナリファイルはそのままストリーム転送
            const arrayBuffer = await fetchRes.arrayBuffer();
            res.send(Buffer.from(arrayBuffer));
        }

    } catch (error) {
        console.error('Proxy Engine Error:', error);
        res.status(500).send('Internal Server Error: プロキシ処理中に致命的なエラーが発生しました。');
    }
});

// ローカルテスト用
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Ultimate Proxy Engine running on port ${PORT}`));
}

module.exports = app;
