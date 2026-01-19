import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { parse, serialize } from 'cookie';
import db from './db.js';

const app = new Hono();
const JWT_SECRET = process.env.JWT_SECRET || 'wannav-secret-key-change-in-production';
const PORT = process.env.PORT || 3000;

// 静的ファイルの提供
app.use('/static/*', serveStatic({ root: './' }));
app.use('/public/*', serveStatic({ root: './' }));

// 認証ミドルウェア
const authMiddleware = async (c, next) => {
  const cookies = parse(c.req.header('cookie') || '');
  const token = cookies.auth_token;

  if (!token) {
    return c.redirect('/login');
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const session = db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > datetime("now")').get(token);
    
    if (!session) {
      return c.redirect('/login');
    }

    const user = db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').get(session.user_id);
    if (!user) {
      return c.redirect('/login');
    }

    c.set('user', user);
    await next();
  } catch (error) {
    return c.redirect('/login');
  }
};

// 管理者チェックミドルウェア
const adminMiddleware = async (c, next) => {
  const user = c.get('user');
  if (!user || !user.is_admin) {
    return c.json({ error: '管理者権限が必要です' }, 403);
  }
  await next();
};

// ログインページ
app.get('/login', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WannaV Dashboard - ログイン</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
</head>
<body class="bg-gradient-to-br from-purple-600 to-blue-500 min-h-screen flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div class="text-center mb-8">
            <div class="inline-block bg-purple-100 p-4 rounded-full mb-4">
                <i class="fas fa-lock text-purple-600 text-4xl"></i>
            </div>
            <h1 class="text-3xl font-bold text-gray-800">WannaV Dashboard</h1>
            <p class="text-gray-600 mt-2">システムダッシュボードへようこそ</p>
        </div>

        <div id="error" class="hidden bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            <p id="error-message"></p>
        </div>

        <form id="loginForm" class="space-y-6">
            <div>
                <label class="block text-gray-700 font-semibold mb-2">
                    <i class="fas fa-user mr-2"></i>ユーザー名
                </label>
                <input type="text" name="username" required
                    class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500">
            </div>

            <div>
                <label class="block text-gray-700 font-semibold mb-2">
                    <i class="fas fa-lock mr-2"></i>パスワード
                </label>
                <input type="password" name="password" required
                    class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500">
            </div>

            <button type="submit"
                class="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-4 rounded-lg transition duration-200">
                <i class="fas fa-sign-in-alt mr-2"></i>ログイン
            </button>
        </form>

        <div class="mt-6 text-center text-sm text-gray-600">
            <p>デフォルトアカウント: <code class="bg-gray-100 px-2 py-1 rounded">admin / admin123</code></p>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script>
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData);

            try {
                const response = await axios.post('/api/login', data);
                if (response.data.success) {
                    window.location.href = '/';
                }
            } catch (error) {
                const errorDiv = document.getElementById('error');
                const errorMessage = document.getElementById('error-message');
                errorDiv.classList.remove('hidden');
                errorMessage.textContent = error.response?.data?.error || 'ログインに失敗しました';
            }
        });
    </script>
</body>
</html>
  `);
});

// ログアウト
app.get('/logout', (c) => {
  const cookies = parse(c.req.header('cookie') || '');
  const token = cookies.auth_token;
  
  if (token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  c.header('Set-Cookie', serialize('auth_token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: -1,
    path: '/'
  }));

  return c.redirect('/login');
});

// メインダッシュボード
app.get('/', authMiddleware, (c) => {
  const user = c.get('user');
  const systems = db.prepare('SELECT * FROM systems ORDER BY order_index ASC').all();

  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WannaV Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
</head>
<body class="bg-gray-100 min-h-screen">
    <nav class="bg-white shadow-lg">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex justify-between h-16">
                <div class="flex items-center">
                    <i class="fas fa-chart-line text-purple-600 text-2xl mr-3"></i>
                    <h1 class="text-2xl font-bold text-gray-800">WannaV Dashboard</h1>
                </div>
                <div class="flex items-center space-x-4">
                    <span class="text-gray-700">
                        <i class="fas fa-user mr-2"></i>${user.username}
                    </span>
                    ${user.is_admin ? '<a href="/admin" class="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg transition duration-200"><i class="fas fa-cog mr-2"></i>管理</a>' : ''}
                    <a href="/logout" class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition duration-200">
                        <i class="fas fa-sign-out-alt mr-2"></i>ログアウト
                    </a>
                </div>
            </div>
        </div>
    </nav>

    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div class="bg-white rounded-lg shadow-lg p-6 mb-6">
            <h2 class="text-2xl font-bold text-gray-800 mb-4">
                <i class="fas fa-link mr-2 text-purple-600"></i>システムリンク一覧
            </h2>
            <p class="text-gray-600 mb-6">各システムへアクセスするには、下のボタンをクリックしてください。</p>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                ${systems.map(sys => `
                    <a href="${sys.url}" target="_blank" 
                       class="block bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white rounded-lg p-6 shadow-md transition duration-200 transform hover:scale-105">
                        <div class="flex items-center justify-between">
                            <div>
                                <h3 class="text-xl font-bold mb-2">
                                    <i class="fas fa-external-link-alt mr-2"></i>${sys.name}
                                </h3>
                                ${sys.description ? `<p class="text-sm opacity-90">${sys.description}</p>` : ''}
                            </div>
                            <i class="fas fa-arrow-right text-2xl"></i>
                        </div>
                    </a>
                `).join('')}
            </div>
        </div>

        <div class="bg-blue-50 border-l-4 border-blue-500 p-4 rounded">
            <div class="flex">
                <i class="fas fa-info-circle text-blue-500 text-xl mr-3"></i>
                <div>
                    <p class="text-blue-800 font-semibold">ご利用にあたって</p>
                    <p class="text-blue-700 text-sm mt-1">各システムは新しいタブで開きます。ログイン状態を保持したまま複数のシステムを同時に利用できます。</p>
                </div>
            </div>
        </div>
    </div>
</body>
</html>
  `);
});

// 管理画面
app.get('/admin', authMiddleware, adminMiddleware, (c) => {
  const user = c.get('user');
  const users = db.prepare('SELECT id, username, is_admin, created_at FROM users').all();
  const systems = db.prepare('SELECT * FROM systems ORDER BY order_index ASC').all();

  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>管理画面 - WannaV Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
</head>
<body class="bg-gray-100 min-h-screen">
    <nav class="bg-white shadow-lg">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex justify-between h-16">
                <div class="flex items-center">
                    <i class="fas fa-cog text-purple-600 text-2xl mr-3"></i>
                    <h1 class="text-2xl font-bold text-gray-800">管理画面</h1>
                </div>
                <div class="flex items-center space-x-4">
                    <a href="/" class="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg transition duration-200">
                        <i class="fas fa-home mr-2"></i>ダッシュボード
                    </a>
                    <a href="/logout" class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition duration-200">
                        <i class="fas fa-sign-out-alt mr-2"></i>ログアウト
                    </a>
                </div>
            </div>
        </div>
    </nav>

    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <!-- ユーザー管理 -->
        <div class="bg-white rounded-lg shadow-lg p-6 mb-6">
            <h2 class="text-2xl font-bold text-gray-800 mb-4">
                <i class="fas fa-users mr-2 text-purple-600"></i>ユーザー管理
            </h2>
            
            <div class="mb-6">
                <button onclick="showAddUserModal()" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition duration-200">
                    <i class="fas fa-plus mr-2"></i>新規ユーザー追加
                </button>
            </div>

            <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ユーザー名</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">管理者</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">作成日</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                        ${users.map(u => `
                            <tr>
                                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${u.id}</td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${u.username}</td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm">
                                    ${u.is_admin ? '<span class="px-2 py-1 bg-purple-100 text-purple-800 rounded">管理者</span>' : '<span class="px-2 py-1 bg-gray-100 text-gray-800 rounded">一般</span>'}
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${new Date(u.created_at).toLocaleString('ja-JP')}</td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                                    <button onclick="changePassword(${u.id}, '${u.username}')" class="text-blue-600 hover:text-blue-900">
                                        <i class="fas fa-key"></i> パスワード変更
                                    </button>
                                    ${u.username !== 'admin' ? `<button onclick="deleteUser(${u.id}, '${u.username}')" class="text-red-600 hover:text-red-900"><i class="fas fa-trash"></i> 削除</button>` : ''}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- システムリンク管理 -->
        <div class="bg-white rounded-lg shadow-lg p-6">
            <h2 class="text-2xl font-bold text-gray-800 mb-4">
                <i class="fas fa-link mr-2 text-purple-600"></i>システムリンク管理
            </h2>
            
            <div class="mb-6">
                <button onclick="showAddSystemModal()" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition duration-200">
                    <i class="fas fa-plus mr-2"></i>新規リンク追加
                </button>
            </div>

            <div class="space-y-4">
                ${systems.map(sys => `
                    <div class="border border-gray-200 rounded-lg p-4 flex items-center justify-between hover:bg-gray-50">
                        <div class="flex-1">
                            <h3 class="font-bold text-lg text-gray-800">${sys.name}</h3>
                            <a href="${sys.url}" target="_blank" class="text-blue-600 hover:underline text-sm">${sys.url}</a>
                            ${sys.description ? `<p class="text-sm text-gray-600 mt-1">${sys.description}</p>` : ''}
                        </div>
                        <div class="flex items-center space-x-2">
                            <button onclick="editSystem(${sys.id}, '${sys.name.replace(/'/g, "\\'")}', '${sys.url}', '${sys.description || ''}', ${sys.order_index})" 
                                    class="text-blue-600 hover:text-blue-900 px-3 py-2">
                                <i class="fas fa-edit"></i> 編集
                            </button>
                            <button onclick="deleteSystem(${sys.id}, '${sys.name.replace(/'/g, "\\'")})" 
                                    class="text-red-600 hover:text-red-900 px-3 py-2">
                                <i class="fas fa-trash"></i> 削除
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    </div>

    <!-- モーダル用のHTML -->
    <div id="modal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div class="bg-white rounded-lg p-8 max-w-md w-full mx-4">
            <h3 id="modal-title" class="text-2xl font-bold mb-4"></h3>
            <div id="modal-content"></div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script>
        function showModal(title, content) {
            document.getElementById('modal-title').textContent = title;
            document.getElementById('modal-content').innerHTML = content;
            document.getElementById('modal').classList.remove('hidden');
        }

        function hideModal() {
            document.getElementById('modal').classList.add('hidden');
        }

        function showAddUserModal() {
            const content = \`
                <form id="addUserForm" class="space-y-4">
                    <div>
                        <label class="block text-gray-700 font-semibold mb-2">ユーザー名</label>
                        <input type="text" name="username" required class="w-full px-4 py-2 border rounded-lg">
                    </div>
                    <div>
                        <label class="block text-gray-700 font-semibold mb-2">パスワード</label>
                        <input type="password" name="password" required class="w-full px-4 py-2 border rounded-lg">
                    </div>
                    <div>
                        <label class="flex items-center">
                            <input type="checkbox" name="is_admin" class="mr-2">
                            <span class="text-gray-700">管理者権限を付与</span>
                        </label>
                    </div>
                    <div class="flex space-x-4">
                        <button type="submit" class="flex-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg">追加</button>
                        <button type="button" onclick="hideModal()" class="flex-1 bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg">キャンセル</button>
                    </div>
                </form>
            \`;
            showModal('新規ユーザー追加', content);
            
            document.getElementById('addUserForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                const data = {
                    username: formData.get('username'),
                    password: formData.get('password'),
                    is_admin: formData.get('is_admin') ? 1 : 0
                };
                
                try {
                    await axios.post('/api/admin/users', data);
                    alert('ユーザーを追加しました');
                    location.reload();
                } catch (error) {
                    alert('エラー: ' + (error.response?.data?.error || 'ユーザーの追加に失敗しました'));
                }
            });
        }

        async function changePassword(userId, username) {
            const newPassword = prompt(\`\${username} の新しいパスワードを入力してください:\`);
            if (!newPassword) return;
            
            try {
                await axios.put(\`/api/admin/users/\${userId}/password\`, { password: newPassword });
                alert('パスワードを変更しました');
            } catch (error) {
                alert('エラー: ' + (error.response?.data?.error || 'パスワード変更に失敗しました'));
            }
        }

        async function deleteUser(userId, username) {
            if (!confirm(\`\${username} を削除してもよろしいですか？\`)) return;
            
            try {
                await axios.delete(\`/api/admin/users/\${userId}\`);
                alert('ユーザーを削除しました');
                location.reload();
            } catch (error) {
                alert('エラー: ' + (error.response?.data?.error || 'ユーザーの削除に失敗しました'));
            }
        }

        function showAddSystemModal() {
            const content = \`
                <form id="addSystemForm" class="space-y-4">
                    <div>
                        <label class="block text-gray-700 font-semibold mb-2">システム名</label>
                        <input type="text" name="name" required class="w-full px-4 py-2 border rounded-lg">
                    </div>
                    <div>
                        <label class="block text-gray-700 font-semibold mb-2">URL</label>
                        <input type="url" name="url" required class="w-full px-4 py-2 border rounded-lg">
                    </div>
                    <div>
                        <label class="block text-gray-700 font-semibold mb-2">説明（オプション）</label>
                        <input type="text" name="description" class="w-full px-4 py-2 border rounded-lg">
                    </div>
                    <div>
                        <label class="block text-gray-700 font-semibold mb-2">表示順序</label>
                        <input type="number" name="order_index" value="0" class="w-full px-4 py-2 border rounded-lg">
                    </div>
                    <div class="flex space-x-4">
                        <button type="submit" class="flex-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg">追加</button>
                        <button type="button" onclick="hideModal()" class="flex-1 bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg">キャンセル</button>
                    </div>
                </form>
            \`;
            showModal('新規リンク追加', content);
            
            document.getElementById('addSystemForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                const data = Object.fromEntries(formData);
                
                try {
                    await axios.post('/api/admin/systems', data);
                    alert('システムリンクを追加しました');
                    location.reload();
                } catch (error) {
                    alert('エラー: ' + (error.response?.data?.error || 'リンクの追加に失敗しました'));
                }
            });
        }

        function editSystem(id, name, url, description, orderIndex) {
            const content = \`
                <form id="editSystemForm" class="space-y-4">
                    <div>
                        <label class="block text-gray-700 font-semibold mb-2">システム名</label>
                        <input type="text" name="name" value="\${name}" required class="w-full px-4 py-2 border rounded-lg">
                    </div>
                    <div>
                        <label class="block text-gray-700 font-semibold mb-2">URL</label>
                        <input type="url" name="url" value="\${url}" required class="w-full px-4 py-2 border rounded-lg">
                    </div>
                    <div>
                        <label class="block text-gray-700 font-semibold mb-2">説明（オプション）</label>
                        <input type="text" name="description" value="\${description}" class="w-full px-4 py-2 border rounded-lg">
                    </div>
                    <div>
                        <label class="block text-gray-700 font-semibold mb-2">表示順序</label>
                        <input type="number" name="order_index" value="\${orderIndex}" class="w-full px-4 py-2 border rounded-lg">
                    </div>
                    <div class="flex space-x-4">
                        <button type="submit" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg">更新</button>
                        <button type="button" onclick="hideModal()" class="flex-1 bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg">キャンセル</button>
                    </div>
                </form>
            \`;
            showModal('リンク編集', content);
            
            document.getElementById('editSystemForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                const data = Object.fromEntries(formData);
                
                try {
                    await axios.put(\`/api/admin/systems/\${id}\`, data);
                    alert('システムリンクを更新しました');
                    location.reload();
                } catch (error) {
                    alert('エラー: ' + (error.response?.data?.error || 'リンクの更新に失敗しました'));
                }
            });
        }

        async function deleteSystem(id, name) {
            if (!confirm(\`\${name} を削除してもよろしいですか？\`)) return;
            
            try {
                await axios.delete(\`/api/admin/systems/\${id}\`);
                alert('システムリンクを削除しました');
                location.reload();
            } catch (error) {
                alert('エラー: ' + (error.response?.data?.error || 'リンクの削除に失敗しました'));
            }
        }
    </script>
</body>
</html>
  `);
});

// API: ログイン
app.post('/api/login', async (c) => {
  try {
    const { username, password } = await c.req.json();

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return c.json({ error: 'ユーザー名またはパスワードが正しくありません' }, 401);
    }

    const valid = bcrypt.compareSync(password, user.password);
    if (!valid) {
      return c.json({ error: 'ユーザー名またはパスワードが正しくありません' }, 401);
    }

    // JWTトークンの生成
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

    // セッションの保存
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)').run(user.id, token, expiresAt);

    // Cookieの設定
    c.header('Set-Cookie', serialize('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
      path: '/'
    }));

    return c.json({ success: true, username: user.username });
  } catch (error) {
    console.error('Login error:', error);
    return c.json({ error: 'ログイン処理中にエラーが発生しました' }, 500);
  }
});

// API: ユーザー追加（管理者のみ）
app.post('/api/admin/users', authMiddleware, adminMiddleware, async (c) => {
  try {
    const { username, password, is_admin } = await c.req.json();

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return c.json({ error: 'このユーザー名は既に使用されています' }, 400);
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (username, password, is_admin) VALUES (?, ?, ?)').run(username, hashedPassword, is_admin ? 1 : 0);

    return c.json({ success: true, userId: result.lastInsertRowid });
  } catch (error) {
    console.error('Add user error:', error);
    return c.json({ error: 'ユーザー追加中にエラーが発生しました' }, 500);
  }
});

// API: パスワード変更（管理者のみ）
app.put('/api/admin/users/:id/password', authMiddleware, adminMiddleware, async (c) => {
  try {
    const userId = c.req.param('id');
    const { password } = await c.req.json();

    const hashedPassword = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, userId);

    // そのユーザーの全セッションを削除（再ログインを強制）
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);

    return c.json({ success: true });
  } catch (error) {
    console.error('Change password error:', error);
    return c.json({ error: 'パスワード変更中にエラーが発生しました' }, 500);
  }
});

// API: ユーザー削除（管理者のみ）
app.delete('/api/admin/users/:id', authMiddleware, adminMiddleware, async (c) => {
  try {
    const userId = c.req.param('id');

    // adminユーザーは削除不可
    const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
    if (user && user.username === 'admin') {
      return c.json({ error: 'デフォルト管理者は削除できません' }, 400);
    }

    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    return c.json({ success: true });
  } catch (error) {
    console.error('Delete user error:', error);
    return c.json({ error: 'ユーザー削除中にエラーが発生しました' }, 500);
  }
});

// API: システムリンク追加（管理者のみ）
app.post('/api/admin/systems', authMiddleware, adminMiddleware, async (c) => {
  try {
    const { name, url, description, order_index } = await c.req.json();

    const result = db.prepare('INSERT INTO systems (name, url, description, order_index) VALUES (?, ?, ?, ?)').run(name, url, description || null, order_index || 0);

    return c.json({ success: true, systemId: result.lastInsertRowid });
  } catch (error) {
    console.error('Add system error:', error);
    return c.json({ error: 'システムリンク追加中にエラーが発生しました' }, 500);
  }
});

// API: システムリンク更新（管理者のみ）
app.put('/api/admin/systems/:id', authMiddleware, adminMiddleware, async (c) => {
  try {
    const systemId = c.req.param('id');
    const { name, url, description, order_index } = await c.req.json();

    db.prepare('UPDATE systems SET name = ?, url = ?, description = ?, order_index = ? WHERE id = ?').run(name, url, description || null, order_index || 0, systemId);

    return c.json({ success: true });
  } catch (error) {
    console.error('Update system error:', error);
    return c.json({ error: 'システムリンク更新中にエラーが発生しました' }, 500);
  }
});

// API: システムリンク削除（管理者のみ）
app.delete('/api/admin/systems/:id', authMiddleware, adminMiddleware, async (c) => {
  try {
    const systemId = c.req.param('id');
    db.prepare('DELETE FROM systems WHERE id = ?').run(systemId);

    return c.json({ success: true });
  } catch (error) {
    console.error('Delete system error:', error);
    return c.json({ error: 'システムリンク削除中にエラーが発生しました' }, 500);
  }
});

// サーバー起動
console.log('🔧 データベースを初期化しています...');
// db.jsのインポート時に自動的にテーブルとデフォルトデータが作成される

console.log(`🚀 サーバーを起動しています... http://localhost:${PORT}`);
serve({
  fetch: app.fetch,
  port: PORT
});

console.log(`✅ WannaV Dashboard が起動しました！`);
console.log(`📍 URL: http://localhost:${PORT}`);
console.log(`👤 デフォルトアカウント: admin / admin123`);
