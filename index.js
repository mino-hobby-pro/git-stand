const express = require('express');
const mime = require('mime-types');

const app = express();

// GitHub Rawファイルを取得するヘルパー関数
async function fetchGitHubFile(username, repo, branch, path) {
    const url = `https://raw.githubusercontent.com/${username}/${repo}/${branch}/${path}`;
    const response = await fetch(url);
    return response;
}

// メインルーティング: /:username/:repo/*
app.get('/:username/:repo*', async (req, res) => {
    const { username, repo } = req.params;
    let filePath = req.params[0] || '';

    // 先頭のスラッシュを削除
    if (filePath.startsWith('/')) {
        filePath = filePath.substring(1);
    }

    // ディレクトリトラバーサル対策
    if (filePath.includes('..')) {
        return res.status(403).send('Forbidden');
    }

    // ルート（/username/repo）へのアクセス時、末尾にスラッシュがない場合はリダイレクト
    // （これにより、HTML内の相対パスによるCSS/JSの読み込みエラーを防止）
    if (filePath === '' && !req.originalUrl.endsWith('/')) {
        return res.redirect(`/${username}/${repo}/`);
    }

    // パスが空の場合は index.html を要求
    if (filePath === '') {
        filePath = 'index.html';
    }

    try {
        // ルート（index.html）アクセス時にのみ、package.jsonの有無をチェックする
        if (filePath === 'index.html') {
            // mainブランチとmasterブランチの両方を確認
            const [pkgMain, pkgMaster] = await Promise.all([
                fetchGitHubFile(username, repo, 'main', 'package.json'),
                fetchGitHubFile(username, repo, 'master', 'package.json')
            ]);

            if (pkgMain.ok || pkgMaster.ok) {
                return res.status(400).send('エラー: このリポジトリには package.json が存在します。静的サイト（HTML/CSS/JSのみ）のみ配信可能です。');
            }
        }

        // ファイルの取得（まずは main ブランチから試行）
        let branch = 'main';
        let response = await fetchGitHubFile(username, repo, branch, filePath);

        // mainで見つからない場合は master ブランチを試行
        if (response.status === 404) {
            branch = 'master';
            response = await fetchGitHubFile(username, repo, branch, filePath);
        }

        // どちらにも存在しない場合
        if (!response.ok) {
            return res.status(404).send(`404 Not Found: ${filePath} がリポジトリ内に見つかりません。`);
        }

        // MIMEタイプを拡張子から判定（見つからない場合は text/plain）
        const contentType = mime.lookup(filePath) || 'text/plain';
        res.setHeader('Content-Type', contentType);

        // Vercelのエッジキャッシュを利用し、GitHubへのリクエスト過多を防ぐ
        // (CDNで1日間キャッシュ、バックグラウンドで非同期更新)
        res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');

        // バイナリデータとして変換してレスポンス（画像ファイルなどもそのまま配信可能）
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        res.send(buffer);

    } catch (error) {
        console.error('Proxy Error:', error);
        res.status(500).send('Internal Server Error: ファイルの取得中にエラーが発生しました。');
    }
});

// ローカルテスト用ポート設定
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Proxy server running on port ${PORT}`));
}

module.exports = app;
