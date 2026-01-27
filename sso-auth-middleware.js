/**
 * WannaV Dashboard SSO認証ミドルウェア
 * 
 * 使い方:
 * 1. このファイルをプロジェクトに配置
 * 2. メインファイルで以下のようにインポート:
 *    const ssoAuth = require('./sso-auth-middleware');
 * 3. すべてのルートの前にミドルウェアを追加:
 *    app.use(ssoAuth);
 */

const jwt = require('jsonwebtoken');

// WannaV Dashboardと同じJWT_SECRETを使用
const JWT_SECRET = process.env.JWT_SECRET || 'wannav-secret-key-change-in-production';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://wannav-main.onrender.com';

function ssoAuthMiddleware(req, res, next) {
  // 認証トークンをチェック
  const tokenFromQuery = req.query.auth_token;
  const tokenFromCookie = req.cookies?.wannav_sso;

  const token = tokenFromQuery || tokenFromCookie;

  // トークンがない場合はダッシュボードにリダイレクト
  if (!token) {
    console.log('❌ SSO トークンなし → ダッシュボードにリダイレクト');
    return res.redirect(DASHBOARD_URL);
  }

  try {
    // トークンを検証
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // SSOトークンかチェック
    if (decoded.type !== 'sso') {
      console.log('❌ 無効なトークンタイプ');
      return res.redirect(DASHBOARD_URL);
    }

    console.log(`✅ SSO 認証成功: ${decoded.username} (${decoded.role})`);

    // ユーザー情報をrequestに追加
    req.user = {
      id: decoded.userId,
      username: decoded.username,
      role: decoded.role
    };

    // クエリパラメータからトークンを取得した場合、Cookieに保存
    if (tokenFromQuery) {
      res.cookie('wannav_sso', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60 * 60 * 1000, // 1時間
        sameSite: 'lax'
      });
      
      // トークンをURLから削除してリダイレクト
      const urlWithoutToken = req.originalUrl.split('?')[0];
      return res.redirect(urlWithoutToken);
    }

    next();
  } catch (error) {
    console.error('❌ SSO トークン検証エラー:', error.message);
    
    // トークンが期限切れの場合、Cookieをクリア
    res.clearCookie('wannav_sso');
    
    return res.redirect(DASHBOARD_URL);
  }
}

module.exports = ssoAuthMiddleware;
