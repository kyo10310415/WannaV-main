# WannaV Dashboard

認証機能を備えた複数システムへのリンク管理ダッシュボード

## 🎯 概要

WannaV関連システムへのアクセスを一元管理するダッシュボードです。ログイン認証により、許可されたユーザーのみが各システムにアクセスできます。

## ✨ 機能

### 認証機能
- ✅ ログイン/ログアウト機能
- ✅ セッション管理（7日間有効）
- ✅ Cookie-based認証
- ✅ 未ログイン時の自動リダイレクト

### ユーザー管理（管理者のみ）
- ✅ ユーザーの追加・削除
- ✅ パスワード変更
- ✅ 管理者権限の付与

### システムリンク管理
- ✅ リンクの追加・編集・削除
- ✅ 表示順序の管理
- ✅ 説明文の設定
- ✅ 新しいタブでリンクを開く

## 🔗 登録済みシステム

1. **WannaV 延長管理システム**  
   https://extended-management.onrender.com/

2. **WannaV わなみさん使用ログ分析**  
   https://wanamisan-monitor.onrender.com/

3. **WannaV成長度リザルトシステム**  
   https://vtuber-school-evaluation.onrender.com/

4. **発話比率算出AI**  
   https://speech-ratio-evaluation-ai.onrender.com/

## 🚀 デプロイ方法

### Renderへのデプロイ

1. **GitHubリポジトリと連携**
   - Render.comにログイン
   - 「New Web Service」を選択
   - このリポジトリ（WannaV-main）を選択

2. **環境設定**
   ```
   Name: wannav-dashboard (任意)
   Environment: Node
   Build Command: npm install
   Start Command: npm start
   ```

3. **環境変数の設定**
   ```
   JWT_SECRET=your-random-secret-key-here
   NODE_ENV=production
   ```

4. **デプロイ**
   - 「Create Web Service」をクリック
   - 自動的にビルド・デプロイが開始されます

### ローカル開発環境

```bash
# 依存関係のインストール
npm install

# データベース初期化
npm run init-db

# サーバー起動
npm start

# または開発モード（ホットリロード）
npm run dev
```

サーバーが起動したら http://localhost:3000 にアクセス

## 🔐 デフォルトアカウント

```
ユーザー名: admin
パスワード: admin123
```

⚠️ **本番環境では必ずパスワードを変更してください！**

## 📁 プロジェクト構造

```
webapp/
├── src/
│   ├── index.js       # メインアプリケーション
│   ├── db.js          # データベース設定
│   └── init-db.js     # DB初期化スクリプト
├── data/
│   └── wannav.db      # SQLiteデータベース（自動生成）
├── package.json
├── .gitignore
└── README.md
```

## 🛠️ 技術スタック

- **Backend**: Hono (高速なWebフレームワーク)
- **Runtime**: Node.js
- **Database**: SQLite (better-sqlite3)
- **Authentication**: JWT + Cookie
- **Password**: bcrypt
- **Frontend**: TailwindCSS + Vanilla JavaScript

## 📊 データベーススキーマ

### users テーブル
- `id`: ユーザーID
- `username`: ユーザー名（一意）
- `password`: ハッシュ化されたパスワード
- `is_admin`: 管理者フラグ
- `created_at`: 作成日時

### systems テーブル
- `id`: システムID
- `name`: システム名
- `url`: URL
- `description`: 説明文
- `order_index`: 表示順序
- `created_at`: 作成日時

### sessions テーブル
- `id`: セッションID
- `user_id`: ユーザーID
- `token`: JWTトークン
- `expires_at`: 有効期限
- `created_at`: 作成日時

## 🔒 セキュリティ

- パスワードはbcryptでハッシュ化
- JWT認証による安全なセッション管理
- HttpOnly Cookie（XSS対策）
- SQL injection対策（プリペアドステートメント使用）
- 管理者権限の厳密なチェック

## 📝 使い方

### 一般ユーザー
1. ログインページでユーザー名とパスワードを入力
2. ダッシュボードから各システムにアクセス
3. 各リンクをクリックして新しいタブでシステムを開く

### 管理者
1. ダッシュボードから「管理」ボタンをクリック
2. ユーザー管理画面でユーザーの追加・削除・パスワード変更
3. システムリンク管理でリンクの追加・編集・削除

## 🌐 公開URL

- **本番環境**: https://wannav-main.onrender.com
- **GitHub**: https://github.com/kyo10310415/WannaV-main

## 📅 更新履歴

- **2026-01-19**: 初回リリース
  - 認証機能実装（JWT + Cookie）
  - ユーザー管理機能実装
  - システムリンク管理機能実装
  - Renderへのデプロイ完了
  - SQLite datetime構文の修正
  - Cookie設定の本番環境対応

## 👤 作成者

@kyo10310415

## 📄 ライセンス

ISC
