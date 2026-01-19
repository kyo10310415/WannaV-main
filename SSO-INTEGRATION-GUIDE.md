# WannaV Dashboard SSO統合ガイド

## 概要
このガイドでは、外部システムをWannaV Dashboardと統合し、シングルサインオン（SSO）を実装する方法を説明します。

## 前提条件
- 外部システムがNode.js/Expressで動作している
- `jsonwebtoken`および`cookie-parser`がインストールされている
- WannaV Dashboardと同じ`JWT_SECRET`環境変数を設定している

## 統合手順

### 1. 依存関係のインストール

```bash
npm install jsonwebtoken cookie-parser
```

### 2. ミドルウェアファイルのコピー

`sso-auth-middleware.js`を外部システムのプロジェクトルートにコピーします。

### 3. 環境変数の設定

`.env`ファイルまたはRenderの環境変数に以下を設定：

```env
JWT_SECRET=your-shared-secret-key
DASHBOARD_URL=https://wannav-main.onrender.com
NODE_ENV=production
```

**重要**: `JWT_SECRET`はWannaV Dashboardと完全に同じ値を使用してください。

### 4. アプリケーションへの統合

#### Express.jsの場合

```javascript
const express = require('express');
const cookieParser = require('cookie-parser');
const ssoAuth = require('./sso-auth-middleware');

const app = express();

// cookie-parserを有効化（必須）
app.use(cookieParser());

// SSO認証ミドルウェアを追加（すべてのルートの前に）
app.use(ssoAuth);

// 通常のルート定義
app.get('/', (req, res) => {
  // req.userにユーザー情報が含まれます
  res.send(`Welcome ${req.user.username}! Role: ${req.user.role}`);
});

// ... その他のルート

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

#### 既存のアプリケーションへの追加

既存のアプリケーションがある場合、以下の2行を追加するだけです：

```javascript
const ssoAuth = require('./sso-auth-middleware');

// 既存のミドルウェアの後、ルート定義の前に追加
app.use(cookieParser()); // まだ使っていない場合
app.use(ssoAuth);
```

### 5. ユーザー情報の利用

認証後、すべてのルートで`req.user`オブジェクトが利用可能です：

```javascript
app.get('/profile', (req, res) => {
  console.log('User ID:', req.user.id);
  console.log('Username:', req.user.username);
  console.log('Role:', req.user.role); // 'admin', 'leader', 'crew'のいずれか
  
  res.json(req.user);
});
```

### 6. 権限チェック（オプション）

特定の権限が必要なルートの場合：

```javascript
// 管理者のみアクセス可能
app.get('/admin', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).send('管理者権限が必要です');
  }
  
  res.send('管理者ページ');
});

// リーダー以上がアクセス可能
app.get('/management', (req, res) => {
  if (!['admin', 'leader'].includes(req.user.role)) {
    return res.status(403).send('リーダー権限が必要です');
  }
  
  res.send('管理ページ');
});
```

## 仕組み

1. **初回アクセス**
   - ユーザーがダッシュボードでリンクをクリック
   - ダッシュボードがSSOトークン（JWT）を生成
   - `https://your-system.onrender.com/?auth_token=xxx`にリダイレクト

2. **トークン検証**
   - 外部システムがトークンを検証
   - 有効な場合、Cookieに保存してトークンなしのURLにリダイレクト
   - 無効な場合、ダッシュボードにリダイレクト

3. **以降のアクセス**
   - CookieからトークンOを読み取り
   - 自動的に認証（再ログイン不要）
   - トークンの有効期限は7日間

## トラブルシューティング

### 認証が失敗する
- `JWT_SECRET`がダッシュボードと同じか確認
- `cookie-parser`がインストールされているか確認
- ミドルウェアの順序を確認（`cookieParser()`の後に`ssoAuth`）

### 無限リダイレクトループ
- `DASHBOARD_URL`が正しく設定されているか確認
- 外部システムのURLがダッシュボードと同じでないか確認

### Cookieが保存されない
- `NODE_ENV=production`が設定されているか確認（HTTPS必須）
- ブラウザのCookie設定を確認

## 対象システム

以下のシステムにこのガイドを適用してください：

1. **WannaV 延長管理システム** (extended-management)
   - Repository: https://github.com/kyo10310415/extended-management
   
2. **WannaV わなみさん使用ログ分析** (discord-bot-wannami-v2)
   - Repository: https://github.com/kyo10310415/discord-bot-wannami-v2
   
3. **WannaV成長度リザルトシステム** (vtuber-school-evaluation)
   - Repository: https://github.com/kyo10310415/vtuber-school-evaluation
   
4. **発話比率算出AI** (Speech-ratio-evaluation-AI)
   - Repository: https://github.com/kyo10310415/Speech-ratio-evaluation-AI

## セキュリティ上の注意

- `JWT_SECRET`は絶対に公開しないでください
- GitHubにコミットせず、環境変数として管理してください
- 本番環境では必ず強力なランダム文字列を使用してください
- すべてのシステムで同じ`JWT_SECRET`を使用してください

## サポート

問題が発生した場合は、PM2ログを確認してください：

```bash
pm2 logs your-app-name --nostream --lines 50
```

または、サーバーログで以下のメッセージを確認：
- `✅ SSO 認証成功` - 認証成功
- `❌ SSO トークンなし` - トークンがない
- `❌ SSO トークン検証エラー` - トークンが無効
