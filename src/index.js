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

// ロール権限レベル定義
const ROLE_LEVELS = {
  'admin': 3,
  'leader': 2,
  'crew': 1
};

// 権限チェックヘルパー関数
function hasPermission(userRole, requiredRole) {
  return ROLE_LEVELS[userRole] >= ROLE_LEVELS[requiredRole];
}

function getRoleLabel(role) {
  const labels = {
    'admin': '管理者',
    'leader': 'リーダー',
    'crew': 'クルー'
  };
  return labels[role] || role;
}

// 静的ファイルの提供
app.use('/static/*', serveStatic({ root: './' }));
app.use('/public/*', serveStatic({ root: './' }));

// 認証ミドルウェア
const authMiddleware = async (c, next) => {
  const cookieHeader = c.req.header('cookie') || '';
  const cookies = parse(cookieHeader);
  const token = cookies.auth_token;
  
  console.log(`🔍 認証チェック: Token存在 = ${!!token}`);

  if (!token) {
    console.log('❌ 認証失敗: トークンなし → /loginにリダイレクト');
    return c.redirect('/login');
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log(`✅ JWT検証成功: userId=${decoded.userId}`);
    
    const session = db.prepare("SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')").get(token);
    console.log(`🔍 セッション検索: 見つかった=${!!session}`);
    
    if (!session) {
      console.log('❌ 認証失敗: セッションなしまたは期限切れ → /loginにリダイレクト');
      return c.redirect('/login');
    }

    const user = db.prepare('SELECT id, username, role, must_change_password FROM users WHERE id = ?').get(session.user_id);
    console.log(`🔍 ユーザー検索: 見つかった=${!!user}, username=${user?.username}, role=${user?.role}`);
    
    if (!user) {
      console.log('❌ 認証失敗: ユーザーなし → /loginにリダイレクト');
      return c.redirect('/login');
    }

    // 初回ログイン時のパスワード変更チェック（change-passwordページ以外）
    if (user.must_change_password && !c.req.path.startsWith('/change-password') && !c.req.path.startsWith('/api/change-password')) {
      console.log(`⚠️  ${user.username} は初回パスワード変更が必要 → /change-passwordにリダイレクト`);
      return c.redirect('/change-password');
    }

    console.log(`✅ 認証成功: ${user.username} (ID: ${user.id}, Role: ${user.role})`);
    c.set('user', user);
    await next();
  } catch (error) {
    console.error('❌ 認証エラー:', error.message);
    return c.redirect('/login');
  }
};

// リーダー以上チェックミドルウェア
const leaderMiddleware = async (c, next) => {
  const user = c.get('user');
  if (!user || !hasPermission(user.role, 'leader')) {
    console.log(`❌ 権限不足: ${user?.username} (${user?.role}) はリーダー以上の権限が必要`);
    return c.json({ error: 'リーダー以上の権限が必要です' }, 403);
  }
  await next();
};

// 管理者チェックミドルウェア
const adminMiddleware = async (c, next) => {
  const user = c.get('user');
  if (!user || user.role !== 'admin') {
    console.log(`❌ 権限不足: ${user?.username} (${user?.role}) は管理者権限が必要`);
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
    </div>

    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script>
        // axiosの設定: Cookieを確実に送受信する
        axios.defaults.withCredentials = true;
        
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData);

            console.log('ログイン試行中...');
            
            try {
                const response = await axios.post('/api/login', data);
                console.log('ログイン成功:', response.data);
                
                if (response.data.success) {
                    console.log('ダッシュボードにリダイレクト中...');
                    // 少し待機してからリダイレクト（Cookieが確実に設定されるように）
                    setTimeout(() => {
                        window.location.href = '/';
                    }, 100);
                }
            } catch (error) {
                console.error('ログインエラー:', error);
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

// パスワード変更画面（初回ログイン時）
app.get('/change-password', authMiddleware, (c) => {
  const user = c.get('user');
  
  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>パスワード変更 - WannaV Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
</head>
<body class="bg-gradient-to-br from-orange-600 to-red-500 min-h-screen flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div class="text-center mb-8">
            <div class="inline-block bg-orange-100 p-4 rounded-full mb-4">
                <i class="fas fa-key text-orange-600 text-4xl"></i>
            </div>
            <h1 class="text-3xl font-bold text-gray-800">パスワード変更</h1>
            <p class="text-gray-600 mt-2">初回ログインのため、パスワードを変更してください</p>
            <p class="text-sm text-gray-500 mt-1">ユーザー: <strong>${user.username}</strong></p>
        </div>

        <div id="error" class="hidden bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            <p id="error-message"></p>
        </div>

        <div id="success" class="hidden bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
            <p id="success-message"></p>
        </div>

        <form id="changePasswordForm" class="space-y-6">
            <div>
                <label class="block text-gray-700 font-semibold mb-2">
                    <i class="fas fa-lock mr-2"></i>新しいパスワード
                </label>
                <input type="password" name="newPassword" required minlength="4"
                    class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500">
                <p class="text-xs text-gray-500 mt-1">4文字以上で入力してください</p>
            </div>

            <div>
                <label class="block text-gray-700 font-semibold mb-2">
                    <i class="fas fa-lock mr-2"></i>新しいパスワード（確認）
                </label>
                <input type="password" name="confirmPassword" required minlength="4"
                    class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500">
            </div>

            <button type="submit"
                class="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 px-4 rounded-lg transition duration-200">
                <i class="fas fa-check mr-2"></i>パスワードを変更
            </button>
        </form>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script>
        axios.defaults.withCredentials = true;
        
        document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = {
                newPassword: formData.get('newPassword'),
                confirmPassword: formData.get('confirmPassword')
            };

            const errorDiv = document.getElementById('error');
            const errorMessage = document.getElementById('error-message');
            const successDiv = document.getElementById('success');
            const successMessage = document.getElementById('success-message');

            errorDiv.classList.add('hidden');
            successDiv.classList.add('hidden');

            // パスワード一致チェック
            if (data.newPassword !== data.confirmPassword) {
                errorDiv.classList.remove('hidden');
                errorMessage.textContent = 'パスワードが一致しません';
                return;
            }

            try {
                const response = await axios.post('/api/change-password', { password: data.newPassword });
                
                if (response.data.success) {
                    successDiv.classList.remove('hidden');
                    successMessage.textContent = 'パスワードを変更しました。ダッシュボードに移動します...';
                    setTimeout(() => {
                        window.location.href = '/';
                    }, 1500);
                }
            } catch (error) {
                errorDiv.classList.remove('hidden');
                errorMessage.textContent = error.response?.data?.error || 'パスワード変更に失敗しました';
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
    secure: true,
    sameSite: 'lax',
    maxAge: -1,
    path: '/'
  }));

  return c.redirect('/login');
});

// メインダッシュボード
app.get('/', authMiddleware, (c) => {
  const user = c.get('user');
  const allSystems = db.prepare('SELECT * FROM systems ORDER BY order_index ASC').all();
  
  // ユーザーの権限で表示できるシステムのみフィルタリング
  const systems = allSystems.filter(sys => hasPermission(user.role, sys.required_role || 'crew'));

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
                        <span class="ml-2 px-2 py-1 text-xs font-semibold rounded ${user.role === 'admin' ? 'bg-purple-100 text-purple-800' : user.role === 'leader' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}">
                            ${getRoleLabel(user.role)}
                        </span>
                    </span>
                    ${hasPermission(user.role, 'leader') ? '<a href="/admin" class="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg transition duration-200"><i class="fas fa-cog mr-2"></i>管理</a>' : ''}
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
                    <a href="#" onclick="openSystemWithSSO('${sys.url}', '${sys.name}'); return false;" 
                       class="block bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white rounded-lg p-6 shadow-md transition duration-200 transform hover:scale-105">
                        <div class="flex items-center justify-between">
                            <div class="flex-1">
                                <div class="flex items-center gap-2 mb-2">
                                    <h3 class="text-xl font-bold">
                                        <i class="fas fa-external-link-alt mr-2"></i>${sys.name}
                                    </h3>
                                    <span class="text-xs px-2 py-1 bg-white bg-opacity-30 rounded">
                                        ${getRoleLabel(sys.required_role || 'crew')}以上
                                    </span>
                                </div>
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
    
    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script>
        axios.defaults.withCredentials = true;
        
        async function openSystemWithSSO(targetUrl, systemName) {
            try {
                console.log(\`🔑 SSO トークン取得中: \${systemName}\`);
                
                // SSOトークンを生成
                const response = await axios.post('/api/generate-sso-token', {
                    targetUrl: targetUrl
                });
                
                if (response.data.success) {
                    const token = response.data.token;
                    // トークン付きURLで遷移（スマホ対応）
                    const urlWithToken = \`\${targetUrl}?auth_token=\${token}\`;
                    
                    // デスクトップ: 新しいタブで開く、スマホ: 同じタブで遷移
                    if (window.innerWidth > 768) {
                        // デスクトップ
                        window.open(urlWithToken, '_blank');
                    } else {
                        // スマホ
                        window.location.href = urlWithToken;
                    }
                    console.log(\`✅ \${systemName} を開きました\`);
                }
            } catch (error) {
                console.error('SSO エラー:', error);
                alert('システムへのアクセス中にエラーが発生しました');
            }
        }
    </script>
</body>
</html>
  `);
});

// 管理画面
app.get('/admin', authMiddleware, leaderMiddleware, (c) => {
  const user = c.get('user');
  const users = db.prepare('SELECT id, username, role, must_change_password, created_at FROM users').all();
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
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">権限</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">パスワード変更要求</th>
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
                                    <span class="px-2 py-1 rounded ${u.role === 'admin' ? 'bg-purple-100 text-purple-800' : u.role === 'leader' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}">
                                        ${getRoleLabel(u.role)}
                                    </span>
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm">
                                    ${u.must_change_password ? '<span class="px-2 py-1 bg-orange-100 text-orange-800 rounded">要変更</span>' : '<span class="text-gray-500">-</span>'}
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${new Date(u.created_at).toLocaleString('ja-JP')}</td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                                    <button onclick="changePassword(${u.id}, '${u.username}')" class="text-blue-600 hover:text-blue-900">
                                        <i class="fas fa-key"></i> パスワード変更
                                    </button>
                                    ${user.role === 'admin' && u.username !== 'admin' ? `<button onclick="changeRole(${u.id}, '${u.username}', '${u.role}')" class="text-purple-600 hover:text-purple-900"><i class="fas fa-user-shield"></i> 権限変更</button>` : ''}
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
                            <button onclick="editSystem(${sys.id}, '${sys.name.replace(/'/g, "\\'")}', '${sys.url}', '${sys.description || ''}', ${sys.order_index}, '${sys.required_role || 'crew'}')" 
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
                        <label class="block text-gray-700 font-semibold mb-2">権限</label>
                        <select name="role" required class="w-full px-4 py-2 border rounded-lg">
                            <option value="crew">クルー（一般）</option>
                            <option value="leader">リーダー（上位）</option>
                            <option value="admin">管理者（最上位）</option>
                        </select>
                    </div>
                    <div class="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800">
                        <i class="fas fa-info-circle mr-2"></i>
                        初期パスワードは <strong>1111</strong> です。初回ログイン時にパスワード変更が要求されます。
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
                    role: formData.get('role')
                };
                
                try {
                    await axios.post('/api/admin/users', data);
                    alert('ユーザーを追加しました（初期パスワード: 1111）');
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

        function changeRole(userId, username, currentRole) {
            const roleLabels = { admin: '管理者', leader: 'リーダー', crew: 'クルー' };
            const content = \`
                <div class="mb-4 p-3 bg-gray-50 rounded-lg text-sm text-gray-700">
                    <i class="fas fa-user mr-2"></i>対象ユーザー: <strong>\${username}</strong>
                    <span class="ml-2 px-2 py-0.5 rounded text-xs font-semibold \${currentRole === 'admin' ? 'bg-purple-100 text-purple-800' : currentRole === 'leader' ? 'bg-blue-100 text-blue-800' : 'bg-gray-200 text-gray-700'}">
                        現在: \${roleLabels[currentRole]}
                    </span>
                </div>
                <form id="changeRoleForm" class="space-y-4">
                    <div>
                        <label class="block text-gray-700 font-semibold mb-2">
                            <i class="fas fa-user-shield mr-2 text-purple-600"></i>新しい権限
                        </label>
                        <div class="space-y-2">
                            <label class="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-purple-50 transition \${currentRole === 'admin' ? 'border-purple-400 bg-purple-50' : 'border-gray-200'}">
                                <input type="radio" name="role" value="admin" \${currentRole === 'admin' ? 'checked' : ''} class="accent-purple-600">
                                <span class="px-2 py-0.5 bg-purple-100 text-purple-800 rounded text-xs font-semibold">管理者</span>
                                <span class="text-sm text-gray-600">全機能 + 権限変更が可能</span>
                            </label>
                            <label class="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-blue-50 transition \${currentRole === 'leader' ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}">
                                <input type="radio" name="role" value="leader" \${currentRole === 'leader' ? 'checked' : ''} class="accent-blue-600">
                                <span class="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs font-semibold">リーダー</span>
                                <span class="text-sm text-gray-600">ユーザー管理 + リンク管理が可能</span>
                            </label>
                            <label class="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition \${currentRole === 'crew' ? 'border-gray-400 bg-gray-50' : 'border-gray-200'}">
                                <input type="radio" name="role" value="crew" \${currentRole === 'crew' ? 'checked' : ''} class="accent-gray-600">
                                <span class="px-2 py-0.5 bg-gray-200 text-gray-700 rounded text-xs font-semibold">クルー</span>
                                <span class="text-sm text-gray-600">ダッシュボード閲覧のみ</span>
                            </label>
                        </div>
                    </div>
                    <div class="flex space-x-3 pt-2">
                        <button type="submit" class="flex-1 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg font-semibold transition">
                            <i class="fas fa-check mr-2"></i>変更する
                        </button>
                        <button type="button" onclick="hideModal()" class="flex-1 bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg font-semibold transition">
                            キャンセル
                        </button>
                    </div>
                </form>
            \`;
            showModal('権限変更', content);

            document.getElementById('changeRoleForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const newRole = e.target.querySelector('input[name="role"]:checked')?.value;
                if (!newRole) return;
                if (newRole === currentRole) {
                    alert('現在と同じ権限です。別の権限を選択してください。');
                    return;
                }
                try {
                    await axios.put(\`/api/admin/users/\${userId}/role\`, { role: newRole });
                    alert(\`\${username} の権限を「\${roleLabels[newRole]}」に変更しました\`);
                    location.reload();
                } catch (error) {
                    alert('エラー: ' + (error.response?.data?.error || '権限変更に失敗しました'));
                }
            });
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
                        <label class="block text-gray-700 font-semibold mb-2">必要権限</label>
                        <select name="required_role" required class="w-full px-4 py-2 border rounded-lg">
                            <option value="crew">クルー以上</option>
                            <option value="leader">リーダー以上</option>
                            <option value="admin">管理者のみ</option>
                        </select>
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

        function editSystem(id, name, url, description, orderIndex, requiredRole) {
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
                        <label class="block text-gray-700 font-semibold mb-2">必要権限</label>
                        <select name="required_role" required class="w-full px-4 py-2 border rounded-lg">
                            <option value="crew" \${requiredRole === 'crew' ? 'selected' : ''}>クルー以上</option>
                            <option value="leader" \${requiredRole === 'leader' ? 'selected' : ''}>リーダー以上</option>
                            <option value="admin" \${requiredRole === 'admin' ? 'selected' : ''}>管理者のみ</option>
                        </select>
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
    console.log(`🔐 ログイン試行: ユーザー名=${username}`);

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      console.log(`❌ ログイン失敗: ユーザーが存在しません (${username})`);
      return c.json({ error: 'ユーザー名またはパスワードが正しくありません' }, 401);
    }

    console.log(`✅ ユーザー発見: ${username} (ID: ${user.id})`);
    
    const valid = bcrypt.compareSync(password, user.password);
    if (!valid) {
      console.log(`❌ ログイン失敗: パスワードが一致しません (${username})`);
      return c.json({ error: 'ユーザー名またはパスワードが正しくありません' }, 401);
    }

    console.log(`✅ パスワード認証成功: ${username}`);

    // JWTトークンの生成
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    console.log(`✅ JWTトークン生成完了: ${username}`);

    // セッションの保存
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)').run(user.id, token, expiresAt);
    console.log(`✅ セッション保存完了: ${username}`);

    // Cookieの設定
    const cookieOptions = {
      httpOnly: true,
      secure: true, // RenderはHTTPSなので常にtrue
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
      path: '/'
    };
    
    const cookieHeader = serialize('auth_token', token, cookieOptions);
    c.header('Set-Cookie', cookieHeader);
    
    console.log('🍪 認証Cookie設定完了');
    console.log(`✅ ログイン成功: ${username}`);
    
    return c.json({ success: true, username: user.username });
  } catch (error) {
    console.error('❌ Login error:', error);
    return c.json({ error: 'ログイン処理中にエラーが発生しました' }, 500);
  }
});

// API: 初回パスワード変更
app.post('/api/change-password', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const { password } = await c.req.json();

    if (!password || password.length < 4) {
      return c.json({ error: 'パスワードは4文字以上で入力してください' }, 400);
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?').run(hashedPassword, user.id);

    console.log(`✅ ${user.username} のパスワードを変更しました`);

    return c.json({ success: true });
  } catch (error) {
    console.error('❌ Password change error:', error);
    return c.json({ error: 'パスワード変更中にエラーが発生しました' }, 500);
  }
});

// API: SSO用トークン生成
app.post('/api/generate-sso-token', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const { targetUrl } = await c.req.json();

    // SSO用の一時トークンを生成（有効期限5分）
    const ssoToken = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        role: user.role,
        targetUrl: targetUrl,
        type: 'sso'
      },
      JWT_SECRET,
      { expiresIn: '1h' }  // 1時間に延長
    );

    console.log(`🔑 SSO トークン生成: ${user.username} → ${targetUrl}`);

    return c.json({ success: true, token: ssoToken });
  } catch (error) {
    console.error('❌ SSO token generation error:', error);
    return c.json({ error: 'トークン生成中にエラーが発生しました' }, 500);
  }
});

// API: ユーザー追加（リーダー以上）
app.post('/api/admin/users', authMiddleware, leaderMiddleware, async (c) => {
  try {
    const { username, role } = await c.req.json();
    const password = '1111'; // 初期パスワードは1111

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return c.json({ error: 'このユーザー名は既に使用されています' }, 400);
    }

    // roleの検証
    if (!['admin', 'leader', 'crew'].includes(role)) {
      return c.json({ error: '無効な権限です' }, 400);
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    // admin以外は初回パスワード変更を要求
    const mustChangePassword = username !== 'admin' ? 1 : 0;
    
    const result = db.prepare('INSERT INTO users (username, password, role, must_change_password) VALUES (?, ?, ?, ?)').run(username, hashedPassword, role, mustChangePassword);

    console.log(`✅ 新規ユーザー作成: ${username} (role: ${role}, 初期パスワード: 1111)`);

    return c.json({ success: true, userId: result.lastInsertRowid });
  } catch (error) {
    console.error('Add user error:', error);
    return c.json({ error: 'ユーザー追加中にエラーが発生しました' }, 500);
  }
});

// API: パスワード変更（管理者のみ）
app.put('/api/admin/users/:id/password', authMiddleware, leaderMiddleware, async (c) => {
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
app.delete('/api/admin/users/:id', authMiddleware, leaderMiddleware, async (c) => {
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

// API: ユーザー権限変更（管理者のみ）
app.put('/api/admin/users/:id/role', authMiddleware, adminMiddleware, async (c) => {
  try {
    const userId = c.req.param('id');
    const { role } = await c.req.json();

    // roleの検証
    if (!['admin', 'leader', 'crew'].includes(role)) {
      return c.json({ error: '無効な権限です' }, 400);
    }

    // 対象ユーザーを確認
    const targetUser = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
    if (!targetUser) {
      return c.json({ error: 'ユーザーが見つかりません' }, 404);
    }

    // adminユーザー自身の権限は変更不可
    if (targetUser.username === 'admin') {
      return c.json({ error: 'デフォルト管理者の権限は変更できません' }, 400);
    }

    // 自分自身の権限変更は不可
    const currentUser = c.get('user');
    if (String(currentUser.id) === String(userId)) {
      return c.json({ error: '自分自身の権限は変更できません' }, 400);
    }

    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);

    // 権限変更後は既存セッションを無効化（再ログインを促す）
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);

    console.log(`✅ ${currentUser.username} が ${targetUser.username} の権限を「${role}」に変更しました`);

    return c.json({ success: true });
  } catch (error) {
    console.error('Change role error:', error);
    return c.json({ error: '権限変更中にエラーが発生しました' }, 500);
  }
});

// API: システムリンク追加（リーダー以上）
app.post('/api/admin/systems', authMiddleware, leaderMiddleware, async (c) => {
  try {
    const { name, url, description, order_index, required_role } = await c.req.json();

    // required_roleの検証
    if (required_role && !['admin', 'leader', 'crew'].includes(required_role)) {
      return c.json({ error: '無効な必要権限です' }, 400);
    }

    const result = db.prepare('INSERT INTO systems (name, url, description, order_index, required_role) VALUES (?, ?, ?, ?, ?)').run(name, url, description || null, order_index || 0, required_role || 'crew');

    return c.json({ success: true, systemId: result.lastInsertRowid });
  } catch (error) {
    console.error('Add system error:', error);
    return c.json({ error: 'システムリンク追加中にエラーが発生しました' }, 500);
  }
});

// API: システムリンク更新（リーダー以上）
app.put('/api/admin/systems/:id', authMiddleware, leaderMiddleware, async (c) => {
  try {
    const systemId = c.req.param('id');
    const { name, url, description, order_index, required_role } = await c.req.json();

    // required_roleの検証
    if (required_role && !['admin', 'leader', 'crew'].includes(required_role)) {
      return c.json({ error: '無効な必要権限です' }, 400);
    }

    db.prepare('UPDATE systems SET name = ?, url = ?, description = ?, order_index = ?, required_role = ? WHERE id = ?').run(name, url, description || null, order_index || 0, required_role || 'crew', systemId);

    return c.json({ success: true });
  } catch (error) {
    console.error('Update system error:', error);
    return c.json({ error: 'システムリンク更新中にエラーが発生しました' }, 500);
  }
});

// API: システムリンク削除（管理者のみ）
app.delete('/api/admin/systems/:id', authMiddleware, leaderMiddleware, async (c) => {
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
