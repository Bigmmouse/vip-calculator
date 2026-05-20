const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");

const app = express();
const PORT = 3456;

// 托管前端静态文件
app.use(express.static(path.join(__dirname, "..", "frontend")));
app.use(cors());
app.use(express.json());

// ============ 工具函数 ============

// 密码哈希 (PBKDF2)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
  return salt + ":" + hash;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const computed = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
  return hash === computed;
}

// 生成 token
function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

// ============ 注册 ============
app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.json({ success: false, message: "请输入用户名和密码" });
  }
  if (username.length < 2 || username.length > 20) {
    return res.json({ success: false, message: "用户名长度 2-20 个字符" });
  }
  if (password.length < 4) {
    return res.json({ success: false, message: "密码至少 4 位" });
  }

  try {
    const [existing] = await db.query("SELECT id FROM users WHERE username = ?", [username]);
    if (existing.length > 0) {
      return res.json({ success: false, message: "用户名已存在" });
    }

    const passwordHash = hashPassword(password);
    const token = generateToken();

    await db.query(
      "INSERT INTO users (username, password_hash, token) VALUES (?, ?, ?)",
      [username, passwordHash, token]
    );

    res.json({ success: true, token, username, message: "注册成功" });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.json({ success: false, message: "注册失败: " + err.message });
  }
});

// ============ 登录 ============
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.json({ success: false, message: "请输入用户名和密码" });
  }

  try {
    const [rows] = await db.query("SELECT * FROM users WHERE username = ?", [username]);
    if (rows.length === 0) {
      return res.json({ success: false, message: "用户名或密码错误" });
    }

    const user = rows[0];
    if (!verifyPassword(password, user.password_hash)) {
      return res.json({ success: false, message: "用户名或密码错误" });
    }

    // 更新 token
    const token = generateToken();
    await db.query("UPDATE users SET token = ? WHERE id = ?", [token, user.id]);

    res.json({
      success: true,
      token,
      username: user.username,
      isVip: user.is_vip === 1,
      message: "登录成功"
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.json({ success: false, message: "登录失败: " + err.message });
  }
});

// ============ 通过 token 获取用户 ============
app.get("/api/me", async (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.json({ user: null });

  try {
    const [rows] = await db.query("SELECT id, username, is_vip FROM users WHERE token = ?", [token]);
    if (rows.length === 0) return res.json({ user: null });
    const user = rows[0];
    res.json({ user: { id: user.id, username: user.username, isVip: user.is_vip === 1 } });
  } catch {
    res.json({ user: null });
  }
});

// ============ 中间件：获取登录用户 ============
async function getUserFromToken(req) {
  const token = req.headers.authorization;
  if (!token) return null;
  const [rows] = await db.query("SELECT id, username, is_vip FROM users WHERE token = ?", [token]);
  return rows.length > 0 ? rows[0] : null;
}

// ============ 计算接口 ============
app.post("/api/calculate", async (req, res) => {
  const { a, b, op } = req.body;

  if (a === undefined || b === undefined || !op) {
    return res.json({ success: false, message: "参数不完整" });
  }

  const numA = parseFloat(a);
  const numB = parseFloat(b);

  if (isNaN(numA) || isNaN(numB)) {
    return res.json({ success: false, message: "请输入有效数字" });
  }

  // 乘除需要会员
  if (op === "*" || op === "/") {
    const user = await getUserFromToken(req);
    if (!user || user.is_vip !== 1) {
      return res.json({
        success: false,
        vip: true,
        message: "乘除运算需要会员身份，请先登录并兑换会员码"
      });
    }
  }

  let result;
  switch (op) {
    case "+": result = numA + numB; break;
    case "-": result = numA - numB; break;
    case "*": result = numA * numB; break;
    case "/":
      if (numB === 0) return res.json({ success: false, message: "除数不能为零" });
      result = numA / numB;
      break;
    default:
      return res.json({ success: false, message: "不支持的运算符" });
  }

  res.json({ success: true, result });
});

// ============ 兑换会员 ============
app.post("/api/redeem", async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.json({ success: false, message: "请输入兑换码" });
  }

  const user = await getUserFromToken(req);
  if (!user) {
    return res.json({ success: false, needLogin: true, message: "请先登录后再兑换" });
  }

  // 先查这个用户是否已兑换过
  if (user.is_vip === 1) {
    return res.json({ success: true, message: "您已是会员，无需重复兑换" });
  }

  const codeStr = code.trim().toUpperCase();

  const [rows] = await db.query(
    "SELECT id FROM redemption_codes WHERE code = ? AND used = 0",
    [codeStr]
  );

  if (rows.length === 0) {
    return res.json({ success: false, message: "兑换码无效或已被使用" });
  }

  // 标记兑换码已使用 + 用户升为 VIP
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      "UPDATE redemption_codes SET used = 1, session_id = ?, user_id = ?, used_at = NOW() WHERE id = ?",
      [req.headers.authorization || "", user.id, rows[0].id]
    );
    await conn.query("UPDATE users SET is_vip = 1 WHERE id = ?", [user.id]);
    await conn.commit();
    res.json({ success: true, message: "🎉 恭喜您成为会员！现在可以使用乘除运算了" });
  } catch {
    await conn.rollback();
    res.json({ success: false, message: "兑换失败，请重试" });
  } finally {
    conn.release();
  }
});

// ============ 检查会员状态 ============
app.get("/api/check-member", async (req, res) => {
  const user = await getUserFromToken(req);
  res.json({ isMember: user ? user.is_vip === 1 : false, user: user ? { username: user.username } : null });
});

app.listen(PORT, () => {
  console.log(`✅ 计算器已启动: http://localhost:${PORT}`);
});


