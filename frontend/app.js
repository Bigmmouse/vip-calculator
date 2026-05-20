const API = "/api";

// ============ Auth State ============
let token = localStorage.getItem("calc_token");
let username = localStorage.getItem("calc_username");
let isMember = false;

// ============ Calculator State ============
let currentInput = "0";
let firstNum = null;
let pendingOp = null;
let waitingForSecond = false;

// ============ DOM ============
const displayExpr = document.getElementById("displayExpr");
const displayResult = document.getElementById("displayResult");
const authPanel = document.getElementById("authPanel");
const userPanel = document.getElementById("userPanel");
const displayUser = document.getElementById("displayUser");
const authUser = document.getElementById("authUser");
const authPass = document.getElementById("authPass");
const authBtn = document.getElementById("authBtn");
const tabLogin = document.getElementById("tabLogin");
const tabRegister = document.getElementById("tabRegister");
const vipStatus = document.getElementById("vipStatus");
const redeemInput = document.getElementById("redeemInput");
const redeemBtn = document.getElementById("redeemBtn");
const logoutBtn = document.getElementById("logoutBtn");

let isLoginMode = true;

// ============ Toast ============
function showToast(msg, isError = false) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.style.background = isError ? "#d63031" : "#27ae60";
  t.className = "toast show";
  setTimeout(() => (t.className = "toast"), 2500);
}

// ============ Auth API calls ============

async function doAuth() {
  const user = authUser.value.trim();
  const pass = authPass.value.trim();
  if (!user || !pass) { showToast("请输入用户名和密码", true); return; }

  authBtn.disabled = true;
  authBtn.textContent = "…";

  const endpoint = isLoginMode ? "/login" : "/register";
  try {
    const res = await fetch(API + endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user, password: pass }),
    });
    const data = await res.json();

    if (data.success) {
      token = data.token;
      username = data.username;
      localStorage.setItem("calc_token", token);
      localStorage.setItem("calc_username", username);
      isMember = data.isVip || false;
      showToast(data.message);
      switchToUserPanel();
      authUser.value = "";
      authPass.value = "";
    } else {
      showToast(data.message, true);
    }
  } catch {
    showToast("网络错误", true);
  } finally {
    authBtn.disabled = false;
    authBtn.textContent = isLoginMode ? "登录" : "注册";
  }
}

function switchToUserPanel() {
  authPanel.style.display = "none";
  userPanel.style.display = "block";
  displayUser.textContent = username;
  updateVIPUI();
}

function switchToAuthPanel() {
  authPanel.style.display = "block";
  userPanel.style.display = "none";
  token = null;
  username = null;
  isMember = false;
  localStorage.removeItem("calc_token");
  localStorage.removeItem("calc_username");
  doClear();
  updateVIPButtons();
}

function doLogout() {
  switchToAuthPanel();
  showToast("已退出登录");
}

// ============ VIP UI ============
function updateVIPButtons() {
  document.querySelectorAll(".btn-vip").forEach((btn) => {
    btn.classList.toggle("unlocked", isMember);
  });
}

function updateVIPUI() {
  if (isMember) {
    vipStatus.className = "vip-status active";
    vipStatus.innerHTML = "\uD83D\uDC51 当前：<span class=\"vip-badge\">VIP 会员</span> 已解锁乘除";
    redeemBtn.disabled = true;
    redeemBtn.textContent = "已会员";
  } else {
    vipStatus.className = "vip-status inactive";
    vipStatus.innerHTML = "\uD83D\uDC8E 当前：普通用户（乘除需会员）";
    redeemBtn.disabled = false;
    redeemBtn.textContent = "兑换会员";
  }
  updateVIPButtons();
}

async function checkMember() {
  if (!token) return false;
  try {
    const res = await fetch(API + "/check-member", {
      headers: { Authorization: token },
    });
    const data = await res.json();
    isMember = data.isMember;
    updateVIPUI();
    return data.isMember;
  } catch {
    return false;
  }
}

async function doRedeem() {
  const code = redeemInput.value.trim();
  if (!code) { showToast("请输入兑换码", true); return; }
  redeemBtn.disabled = true;
  redeemBtn.textContent = "…";
  try {
    const res = await fetch(API + "/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message);
      isMember = true;
      updateVIPUI();
      redeemInput.value = "";
    } else {
      if (data.needLogin) {
        switchToAuthPanel();
      }
      showToast(data.message, true);
    }
  } catch {
    showToast("网络错误", true);
  } finally {
    if (!isMember) {
      redeemBtn.disabled = false;
      redeemBtn.textContent = "兑换会员";
    }
  }
}

// ============ Calculator Logic ============

function inputDigit(digit) {
  if (waitingForSecond) {
    currentInput = digit === "." ? "0." : digit;
    waitingForSecond = false;
  } else {
    if (digit === ".") {
      if (currentInput.includes(".")) return;
      currentInput += ".";
    } else {
      if (currentInput === "0") {
        currentInput = digit;
      } else {
        currentInput += digit;
      }
    }
  }
  updateDisplay();
}

function inputOp(op) {
  if ((op === "*" || op === "/") && !isMember) {
    if (!token) {
      showToast("请先登录后再使用乘除运算", true);
    } else {
      showToast("乘除运算需要会员身份，请先兑换会员码", true);
    }
    return;
  }
  if (firstNum !== null && pendingOp && !waitingForSecond) {
    doCalc(pendingOp, true);
  }
  firstNum = parseFloat(currentInput);
  pendingOp = op;
  waitingForSecond = true;
  updateDisplay();
}

async function doCalc(op, silent = false) {
  const a = firstNum;
  const b = parseFloat(currentInput);
  if (isNaN(a) || isNaN(b)) { setDisplayError("无效数字"); return; }
  if (op === "/" && b === 0) { setDisplayError("不能除以 0"); return; }

  if (!silent) displayResult.textContent = "…";

  try {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = token;

    const res = await fetch(API + "/calculate", {
      method: "POST",
      headers,
      body: JSON.stringify({ a, b, op }),
    });
    const data = await res.json();

    if (data.success) {
      currentInput = String(data.result);
      firstNum = null;
      pendingOp = null;
      waitingForSecond = false;
      updateDisplay();
    } else if (data.vip) {
      setDisplayError("\uD83D\uDD12 需会员");
      showToast(data.message, true);
    } else {
      setDisplayError("错误");
      showToast(data.message, true);
    }
  } catch {
    setDisplayError("\u26A0\uFE0F 网络错误");
    showToast("无法连接后端服务", true);
  }
}

function doEquals() {
  if (firstNum === null || !pendingOp) return;
  doCalc(pendingOp);
}

function doClear() {
  currentInput = "0";
  firstNum = null;
  pendingOp = null;
  waitingForSecond = false;
  updateDisplay();
}

function doBackspace() {
  if (waitingForSecond) return;
  if (currentInput.length > 1) {
    currentInput = currentInput.slice(0, -1);
    if (currentInput === "-" || currentInput === "") currentInput = "0";
  } else {
    currentInput = "0";
  }
  updateDisplay();
}

function setDisplayError(msg) {
  displayResult.textContent = msg;
  displayResult.className = "result error";
}

function updateDisplay() {
  displayResult.textContent = currentInput;
  displayResult.className = "result";
  let expr = "";
  if (firstNum !== null && pendingOp) {
    const opMap = { "+": "+", "-": "\u2212", "*": "\u00D7", "/": "\u00F7" };
    expr = firstNum + " " + opMap[pendingOp];
    if (waitingForSecond) expr += " ";
  }
  displayExpr.textContent = expr;
}

// ============ 初始化 ============

async function init() {
  doClear();

  if (token) {
    // 尝试用已有 token 恢复登录
    try {
      const res = await fetch(API + "/me", { headers: { Authorization: token } });
      const data = await res.json();
      if (data.user) {
        username = data.user.username;
        isMember = data.user.isVip;
        switchToUserPanel();
      } else {
        // token 过期
        switchToAuthPanel();
      }
    } catch {
      switchToAuthPanel();
    }
  } else {
    switchToAuthPanel();
  }
}

// ============ 事件绑定 ============

document.querySelectorAll("[data-num]").forEach((btn) => {
  btn.addEventListener("click", () => inputDigit(btn.dataset.num));
});
document.querySelectorAll("[data-op]").forEach((btn) => {
  btn.addEventListener("click", () => inputOp(btn.dataset.op));
});
document.querySelectorAll("[data-action=calc]").forEach((btn) => {
  btn.addEventListener("click", doEquals);
});
document.querySelectorAll("[data-action=clear]").forEach((btn) => {
  btn.addEventListener("click", doClear);
});
document.querySelectorAll("[data-action=backspace]").forEach((btn) => {
  btn.addEventListener("click", doBackspace);
});

// Auth 切换
tabLogin.addEventListener("click", () => {
  isLoginMode = true;
  tabLogin.classList.add("active");
  tabRegister.classList.remove("active");
  authBtn.textContent = "登录";
});
tabRegister.addEventListener("click", () => {
  isLoginMode = false;
  tabRegister.classList.add("active");
  tabLogin.classList.remove("active");
  authBtn.textContent = "注册";
});
authBtn.addEventListener("click", doAuth);
[authUser, authPass].forEach((el) => {
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doAuth();
  });
});

logoutBtn.addEventListener("click", doLogout);
redeemBtn.addEventListener("click", doRedeem);
redeemInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") doRedeem();
});

// 键盘支持
document.addEventListener("keydown", (e) => {
  if (document.activeElement.tagName === "INPUT") return;
  const key = e.key;
  if (/^[\d.]$/.test(key)) { inputDigit(key); return; }
  if (key === "+") { inputOp("+"); return; }
  if (key === "-") { inputOp("-"); return; }
  if (key === "*") { inputOp("*"); return; }
  if (key === "/") { inputOp("/"); return; }
  if (key === "Enter" || key === "=") { e.preventDefault(); doEquals(); return; }
  if (key === "Escape" || key === "c" || key === "C") { doClear(); return; }
  if (key === "Backspace") { doBackspace(); return; }
});

init();


