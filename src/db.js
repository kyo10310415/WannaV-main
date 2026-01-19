import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, '../data/wannav.db');
const db = new Database(dbPath);

// テーブルの作成
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS systems (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    description TEXT,
    order_index INTEGER DEFAULT 0,
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

// デフォルトの管理者ユーザーを作成（username: admin, password: admin123）
const checkAdmin = db.prepare('SELECT COUNT(*) as count FROM users WHERE username = ?').get('admin');
if (checkAdmin.count === 0) {
  const hashedPassword = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (username, password, is_admin) VALUES (?, ?, 1)').run('admin', hashedPassword);
  console.log('✅ デフォルト管理者ユーザーを作成しました (username: admin, password: admin123)');
}

// デフォルトのシステムリンクを追加
const checkSystems = db.prepare('SELECT COUNT(*) as count FROM systems').get();
if (checkSystems.count === 0) {
  const systems = [
    { name: 'WannaV 延長管理システム', url: 'https://extended-management.onrender.com/', order_index: 1 },
    { name: 'WannaV わなみさん使用ログ分析', url: 'https://wanamisan-monitor.onrender.com/', order_index: 2 },
    { name: 'WannaV成長度リザルトシステム', url: 'https://vtuber-school-evaluation.onrender.com/', order_index: 3 },
    { name: '発話比率算出AI', url: 'https://speech-ratio-evaluation-ai.onrender.com/', order_index: 4 }
  ];
  
  const stmt = db.prepare('INSERT INTO systems (name, url, order_index) VALUES (?, ?, ?)');
  systems.forEach(sys => {
    stmt.run(sys.name, sys.url, sys.order_index);
  });
  console.log('✅ デフォルトシステムリンクを追加しました');
}

export default db;
