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
- ✅ **SSO（シングルサインオン）対応** - 1回のログインで全外部システムにアクセス可能

### ユーザー権限管理
- ✅ **3段階ロール制御**（管理者・リーダー・クルー）
- ✅ ユーザーの追加・削除（リーダー以上）
- ✅ パスワード変更機能
- ✅ 管理者・リーダー権限の付与
- ✅ **初回ログイン時の強制パスワード変更**（admin以外）
- ✅ 新規ユーザーの初期パスワードは「1111」

### システムリンク管理（リーダー以上）
- ✅ リンクの追加・編集・削除
- ✅ **リンク単位の権限設定**（管理者・リーダー・クルー）
- ✅ 表示順序の管理
- ✅ 説明文の設定
- ✅ **権限に応じたリンクの自動フィルタリング**
- ✅ **トークンベース認証でSSO実装** - 外部システムを自動的に保護

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
├── sso-auth-middleware.js    # SSO認証ミドルウェア（外部システム用）
├── SSO-INTEGRATION-GUIDE.md  # SSO統合ガイド
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
- `role`: ユーザー権限（'admin', 'leader', 'crew'）
- `must_change_password`: 初回ログイン時のパスワード変更フラグ
- `created_at`: 作成日時

### systems テーブル
- `id`: システムID
- `name`: システム名
- `url`: URL
- `description`: 説明文
- `required_role`: 必要な権限レベル（'admin', 'leader', 'crew'）
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

### 一般ユーザー（クルー）
1. ログインページでユーザー名とパスワードを入力
2. 初回ログイン時はパスワード変更が必要
3. ダッシュボードから自分の権限でアクセス可能なシステムを表示
4. 各リンクをクリック → **SSO認証で自動的に外部システムにログイン**

### リーダー
1. クルーの全機能に加え、「管理」ボタンにアクセス可能
2. ユーザー管理：ユーザーの追加・削除・パスワード変更
3. システムリンク管理：リンクの追加・編集・削除・権限設定

### 管理者（admin）
1. リーダーの全機能に加え、管理者権限の付与が可能
2. すべてのシステムリンクにアクセス可能
3. ユーザーに管理者・リーダー権限を付与可能

## 🔐 SSO（シングルサインオン）機能

### 仕組み
1. ダッシュボードでログイン
2. 外部システムリンクをクリック
3. **自動的にトークンが生成され、外部システムに認証情報を送信**
4. 外部システムがトークンを検証
5. 認証成功 → 外部システムにログイン完了（再ログイン不要）

### 外部システムの保護
- すべての外部システムが自動的に認証で保護されます
- トークンなしでの直接アクセスは自動的にダッシュボードにリダイレクト
- トークンの有効期限は5分（Cookieは7日間保持）

### SSO統合ガイド
外部システムへのSSO統合方法は `SSO-INTEGRATION-GUIDE.md` を参照してください。

## 🌐 公開URL

- **本番環境**: https://wannav-main.onrender.com
- **GitHub**: https://github.com/kyo10310415/WannaV-main

## 📅 更新履歴

- **2026-01-19 v2.0**: SSO機能実装
  - ✅ **3段階ロール制御**（admin/leader/crew）実装
  - ✅ **SSO（シングルサインオン）機能**実装
  - ✅ トークンベース認証で外部システムを自動保護
  - ✅ 初回ログイン時の強制パスワード変更機能
  - ✅ リンク単位の権限設定機能
  - ✅ リーダー専用の管理画面
  - ✅ SQLiteクエリの最適化（LENGTH関数使用）

- **2026-01-19 v1.0**: 初回リリース
  - ✅ 認証機能実装（JWT + Cookie）
  - ✅ ユーザー管理機能実装
  - ✅ システムリンク管理機能実装
  - ✅ Renderへのデプロイ完了
  - ✅ SQLite datetime構文の修正
  - ✅ Cookie設定の本番環境対応

## 👤 作成者

@kyo10310415

## 📄 ライセンス

ISC
