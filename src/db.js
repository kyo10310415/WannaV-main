import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Render Disk利用時は /data を使用、それ以外は ./data
const dataDir = existsSync('/data') ? '/data' : join(__dirname, '../data');
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
  console.log('✅ dataディレクトリを作成しました');
}

const dbPath = join(dataDir, 'wannav.db');
console.log(`📁 データベースパス: ${dbPath}`);
const db = new Database(dbPath);

// テーブルの作成
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'crew' CHECK(role IN ('admin', 'leader', 'crew')),
    must_change_password INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS systems (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    description TEXT,
    order_index INTEGER DEFAULT 0,
    required_role TEXT DEFAULT 'crew' CHECK(required_role IN ('admin', 'leader', 'crew')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// 既存テーブルに新しいカラムを追加（マイグレーション）
try {
  // usersテーブルにroleカラムを追加
  db.exec(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'crew' CHECK(role IN ('admin', 'leader', 'crew'))`);
  console.log('✅ usersテーブルにroleカラムを追加しました');
} catch (e) {
  // カラムが既に存在する場合はエラーを無視
  if (!e.message.includes('duplicate column')) {
    console.log('ℹ️  usersテーブルのroleカラムは既に存在します');
  }
}

try {
  // usersテーブルにmust_change_passwordカラムを追加
  db.exec(`ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0`);
  console.log('✅ usersテーブルにmust_change_passwordカラムを追加しました');
} catch (e) {
  if (!e.message.includes('duplicate column')) {
    console.log('ℹ️  usersテーブルのmust_change_passwordカラムは既に存在します');
  }
}

try {
  // systemsテーブルにrequired_roleカラムを追加
  db.exec(`ALTER TABLE systems ADD COLUMN required_role TEXT DEFAULT 'crew' CHECK(required_role IN ('admin', 'leader', 'crew'))`);
  console.log('✅ systemsテーブルにrequired_roleカラムを追加しました');
} catch (e) {
  if (!e.message.includes('duplicate column')) {
    console.log('ℹ️  systemsテーブルのrequired_roleカラムは既に存在します');
  }
}

// 既存のis_adminカラムからroleカラムへの移行
try {
  const usersWithOldSchema = db.prepare('SELECT id, is_admin FROM users WHERE role IS NULL OR LENGTH(role) = 0').all();
  if (usersWithOldSchema.length > 0) {
    console.log(`🔄 ${usersWithOldSchema.length}人のユーザーをis_adminからroleに移行中...`);
    const updateRole = db.prepare('UPDATE users SET role = ? WHERE id = ?');
    usersWithOldSchema.forEach(user => {
      const role = user.is_admin ? 'admin' : 'crew';
      updateRole.run(role, user.id);
    });
    console.log('✅ ユーザーのロール移行が完了しました');
  }
} catch (e) {
  console.log('ℹ️  ロール移行処理をスキップ:', e.message);
}

// デフォルトの管理者ユーザーを作成（username: admin, password: admin123）
const checkAdmin = db.prepare('SELECT COUNT(*) as count FROM users WHERE username = ?').get('admin');
console.log(`📊 既存の管理者ユーザー数: ${checkAdmin.count}`);

if (checkAdmin.count === 0) {
  const hashedPassword = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (username, password, role, must_change_password) VALUES (?, ?, ?, ?)').run('admin', hashedPassword, 'admin', 0);
  console.log('✅ デフォルト管理者ユーザーを作成しました (username: admin, role: admin)');
} else {
  console.log('ℹ️  管理者ユーザーは既に存在します');
  // 既存のadminユーザーのroleを確実に'admin'に設定
  db.prepare('UPDATE users SET role = ? WHERE username = ?').run('admin', 'admin');
}

// 全ユーザーを確認
const allUsers = db.prepare('SELECT id, username, role, must_change_password FROM users').all();
console.log('📋 現在のユーザー一覧:', allUsers);

// デフォルトのシステムリンクを追加
const checkSystems = db.prepare('SELECT COUNT(*) as count FROM systems').get();
if (checkSystems.count === 0) {
  const systems = [
    { name: 'WannaV 延長管理システム', url: 'https://extended-management.onrender.com/', order_index: 1, required_role: 'crew' },
    { name: 'WannaV わなみさん使用ログ分析', url: 'https://wanamisan-monitor.onrender.com/', order_index: 2, required_role: 'leader' },
    { name: 'WannaV成長度リザルトシステム', url: 'https://vtuber-school-evaluation.onrender.com/', order_index: 3, required_role: 'crew' },
    { name: '発話比率算出AI', url: 'https://speech-ratio-evaluation-ai.onrender.com/', order_index: 4, required_role: 'admin' },
    { name: '特典送付システム', url: 'https://wannav-benefit-system.onrender.com/', order_index: 5, required_role: 'admin' },
    {
      name: 'AI回答ソース管理',
      url: process.env.AI_SOURCE_ADMIN_URL || 'https://discord-bot-wannami-v2.onrender.com/admin/sources',
      description: 'AI回答に使用するナレッジソースを登録・編集します',
      order_index: 6,
      required_role: 'admin'
    }
  ];
  
  const stmt = db.prepare('INSERT INTO systems (name, url, description, order_index, required_role) VALUES (?, ?, ?, ?, ?)');
  systems.forEach(sys => {
    stmt.run(sys.name, sys.url, sys.description || null, sys.order_index, sys.required_role);
  });
  console.log('✅ デフォルトシステムリンクを追加しました');
} else {
  // 既存システムにrequired_roleが設定されていない場合はデフォルト値を設定
  const systemsWithoutRole = db.prepare('SELECT id FROM systems WHERE required_role IS NULL OR LENGTH(required_role) = 0').all();
  if (systemsWithoutRole.length > 0) {
    console.log(`🔄 ${systemsWithoutRole.length}個のシステムリンクにrequired_roleを設定中...`);
    const updateRole = db.prepare('UPDATE systems SET required_role = ? WHERE id = ?');
    systemsWithoutRole.forEach(sys => {
      updateRole.run('crew', sys.id);
    });
    console.log('✅ システムリンクのrequired_role設定が完了しました');
  }
}

// 既存の本番DBにもAI回答ソース管理へのSSOリンクを反映する。
// systemsテーブルが空でない環境でも、アプリ起動時に一度だけ追加される。
const aiSourceAdminSystem = {
  name: 'AI回答ソース管理',
  url: process.env.AI_SOURCE_ADMIN_URL || 'https://discord-bot-wannami-v2.onrender.com/admin/sources',
  description: 'AI回答に使用するナレッジソースを登録・編集します',
  requiredRole: 'admin'
};

const existingAiSourceSystem = db.prepare('SELECT id FROM systems WHERE name = ?').get(aiSourceAdminSystem.name);

if (existingAiSourceSystem) {
  db.prepare('UPDATE systems SET url = ?, description = ?, required_role = ? WHERE id = ?').run(
    aiSourceAdminSystem.url,
    aiSourceAdminSystem.description,
    aiSourceAdminSystem.requiredRole,
    existingAiSourceSystem.id
  );
  console.log('ℹ️  AI回答ソース管理リンクを更新しました');
} else {
  const nextOrder = db.prepare('SELECT COALESCE(MAX(order_index), 0) + 1 AS next_order FROM systems').get().next_order;
  db.prepare('INSERT INTO systems (name, url, description, order_index, required_role) VALUES (?, ?, ?, ?, ?)').run(
    aiSourceAdminSystem.name,
    aiSourceAdminSystem.url,
    aiSourceAdminSystem.description,
    nextOrder,
    aiSourceAdminSystem.requiredRole
  );
  console.log('✅ AI回答ソース管理リンクを追加しました');
}

export default db;
