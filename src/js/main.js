/**
 * main.js —— 应用入口与 UI 交互层
 *
 * 状态：history（历史已确认转账）+ 由 history 计算出的 profile。
 * 数据全部保存在浏览器 localStorage，纯前端运行，无需后端。
 */

import {
  calcProfile,
  evaluateTransaction,
  getRiskLevel,
  formatTimeRange,
} from './engine.js';
import {
  loadHistory,
  addHistoryItem,
  removeHistoryItem,
  clearHistory,
  seedDemoData,
  genId,
} from './storage.js';
import { getBotReply, buildContextSummary } from './chatbot.js';

// ---------- 工具 ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const fmtMoney = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  minimumFractionDigits: 2,
});

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function toLocalInputValue(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtTime(t) {
  return t ? String(t).replace('T', ' ').slice(0, 16) : '—';
}

// ---------- 全局状态 ----------
let history = loadHistory();
let profile = calcProfile(history);
let pendingTx = null;      // 待确认的转账（风险评估弹窗数据）
let chatContext = null;    // 助手上下文

// ---------- Toast ----------
let toastTimer = null;
function showToast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

// ---------- 渲染：习惯画像 ----------
function renderProfile() {
  // 迷你画像（转账主页侧栏）
  const wl = profile.whitelist.map((w) => `${w.name}×${w.count}`).join('、') || '学习中';
  $('#mini-whitelist').textContent = wl;
  $('#mini-mean').textContent = profile.amountMean == null ? '—' : fmtMoney.format(profile.amountMean);
  $('#mini-sample').textContent = `${profile.sampleCount} 笔`;

  // 完整画像（历史页）
  const wlBox = $('#profile-whitelist');
  wlBox.innerHTML = profile.whitelist.length
    ? profile.whitelist.map((w) => `<span class="chip">${escapeHtml(w.name)} <em>×${w.count}</em></span>`).join('')
    : '<span class="empty">学习中（历史交易 ≥2 次自动加入）</span>';

  const amtBox = $('#profile-amount');
  if (profile.amountMean == null) {
    amtBox.innerHTML = '<p class="stat-big">—</p><p class="stat-sub">暂无历史记录，先新增基准记录或转账</p>';
  } else {
    const range = profile.commonRange
      ? `${fmtMoney.format(profile.commonRange[0])} ~ ${fmtMoney.format(profile.commonRange[1])}`
      : '—';
    amtBox.innerHTML = `
      <p class="stat-big">${range}</p>
      <p class="stat-sub">均值 ${fmtMoney.format(profile.amountMean)} · 历史最高 ${fmtMoney.format(profile.amountMax)}</p>`;
  }

  const timeBox = $('#profile-time');
  const timeRangeText = profile.timeRange ? formatTimeRange(profile.timeRange) : '—';
  timeBox.innerHTML = `
    <p class="stat-big">${escapeHtml(timeRangeText)}</p>
    <p class="stat-sub">深夜交易（23:00-06:00）${profile.nightCount} 笔</p>`;

  $('#profile-sample').innerHTML = `
    <p class="stat-big">${profile.sampleCount} 笔</p>
    <p class="stat-sub">记录越多，画像越准确</p>`;
}

// ---------- 渲染：历史明细 ----------
function riskBadge(level) {
  const cls = level === '高风险' ? 'high' : level === '中风险' ? 'mid' : 'low';
  return `<span class="badge ${cls}">${escapeHtml(level)}</span>`;
}

function renderHistory() {
  const tbody = $('#history-body');
  if (!history.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">暂无历史记录，可手动新增基准记录或载入示例数据。</td></tr>';
    return;
  }
  tbody.innerHTML = history
    .map(
      (h) => `
      <tr>
        <td>${escapeHtml(fmtTime(h.time))}</td>
        <td>${escapeHtml(h.payee)}</td>
        <td>${escapeHtml(h.account || '—')}</td>
        <td class="num">${fmtMoney.format(h.amount)}</td>
        <td>${riskBadge(h.riskLevel || '低风险')}</td>
        <td class="num">${h.riskScore ?? 0}</td>
        <td><button class="del-btn" data-del="${escapeHtml(h.id)}" title="删除">删除</button></td>
      </tr>`,
    )
    .join('');
}

function refresh() {
  history = loadHistory();
  profile = calcProfile(history);
  renderProfile();
  renderHistory();
}

// ---------- 风险评估弹窗 ----------
function openRiskModal(result, tx) {
  const { score, level, points } = result;
  pendingTx = { tx, result };

  $('#modal-tx-summary').innerHTML = `
    <dt>收款人</dt><dd>${escapeHtml(tx.payee)}</dd>
    <dt>金额</dt><dd>${fmtMoney.format(tx.amount)}</dd>
    <dt>交易时间</dt><dd>${escapeHtml(fmtTime(tx.time))}</dd>`;

  $('#modal-score').textContent = score;
  $('#modal-fill').style.width = `${score}%`;
  const levelEl = $('#modal-level');
  levelEl.textContent = level;
  levelEl.style.color = level === '高风险' ? 'var(--red)' : level === '中风险' ? 'var(--orange)' : 'var(--green)';
  $('#modal-score').style.color = levelEl.style.color;

  const box = $('#modal-points');
  box.innerHTML = points.length
    ? points.map((p) => `<li>${escapeHtml(p)}</li>`).join('')
    : '<li class="safe">未发现明显可疑风险点，可继续操作，仍需保持警惕。</li>';

  $('#modal-root').hidden = false;
}

function closeModal() {
  $('#modal-root').hidden = true;
  pendingTx = null;
}

// ---------- 悬浮 AI 反诈助手 ----------
function appendMsg(role, text) {
  const body = $('#chat-body');
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.textContent = text;
  body.appendChild(el);
  body.scrollTop = body.scrollHeight;
}

function openChat(context = null) {
  chatContext = context;
  const ctxBox = $('#chat-context');
  if (context && (context.payee || context.amount)) {
    ctxBox.hidden = false;
    ctxBox.innerHTML = `
      <div class="chat-context-head"><span>已带入转账上下文</span>
      <button class="chat-clear-ctx" id="chat-clear-ctx">清除</button></div>
      <pre>${escapeHtml(buildContextSummary(context))}</pre>`;
  } else {
    ctxBox.hidden = true;
    ctxBox.innerHTML = '';
  }
  $('#chat-panel').hidden = false;
  if (context && (context.payee || context.amount)) {
    appendMsg('bot', '已带入当前转账上下文。请问您想确认什么？例如：「对方让我先付保证金，安全吗？」');
  }
  $('#chat-input').focus();
}

function closeChat() {
  $('#chat-panel').hidden = true;
}

function sendChat() {
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  appendMsg('user', text);
  input.value = '';
  const typing = document.createElement('div');
  typing.className = 'chat-typing';
  typing.textContent = '反诈助手分析中…';
  $('#chat-body').appendChild(typing);
  setTimeout(() => {
    typing.remove();
    const reply = getBotReply(text, chatContext);
    appendMsg('bot', reply.text);
  }, 350);
}

// ---------- 事件绑定 ----------
function bindEvents() {
  // 顶部 Tab 切换
  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      $('#view-transfer').classList.toggle('active', btn.dataset.view === 'transfer');
      $('#view-history').classList.toggle('active', btn.dataset.view === 'history');
      refresh();
    });
  });
  // 侧栏 / 页内跳转
  $$('[data-goto]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const view = link.dataset.goto;
      $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
      $('#view-transfer').classList.toggle('active', view === 'transfer');
      $('#view-history').classList.toggle('active', view === 'history');
      refresh();
    });
  });

  // 新建转账 → 风险评估
  $('#transfer-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const payee = $('#f-payee').value.trim();
    const account = $('#f-account').value.trim();
    const amount = Number($('#f-amount').value);
    const time = $('#f-time').value;
    const note = $('#f-note').value.trim();

    if (!payee) return showToast('请填写收款人姓名');
    if (!Number.isFinite(amount) || amount <= 0) return showToast('转账金额必须大于 0');
    if (!time) return showToast('请选择交易时间');

    const tx = { payee, account, amount, time, note };
    const result = evaluateTransaction(tx, profile, history);
    if (result.error) return showToast(result.error);
    openRiskModal(result, tx);
  });

  // 弹窗操作
  $('#btn-cancel').addEventListener('click', () => {
    closeModal();
    showToast('已取消本次转账');
  });
  $('#btn-confirm').addEventListener('click', () => {
    if (!pendingTx) return;
    const { tx, result } = pendingTx;
    const item = {
      id: genId(),
      ...tx,
      riskScore: result.score,
      riskLevel: result.level,
      points: result.points,
      createdAt: new Date().toISOString(),
    };
    history = addHistoryItem(history, item);
    closeModal();
    refresh();
    showToast(`已确认（模拟）转账 ${fmtMoney.format(tx.amount)} 给 ${tx.payee}`);
  });
  $('#btn-consult').addEventListener('click', () => {
    if (!pendingTx) return;
    const { tx, result } = pendingTx;
    closeModal();
    openChat({ ...tx, riskScore: result.score, riskLevel: result.level, points: result.points });
  });
  $$('[data-close-modal]').forEach((el) =>
    el.addEventListener('click', () => { closeModal(); }),
  );

  // 悬浮助手
  $('#chat-fab').addEventListener('click', () => {
    const payee = $('#f-payee').value.trim();
    const amount = Number($('#f-amount').value);
    const time = $('#f-time').value;
    const note = $('#f-note').value.trim();
    const context =
      payee || Number.isFinite(amount) || time || note
        ? { payee, amount: Number.isFinite(amount) ? amount : undefined, time, note }
        : null;
    if (!$('#chat-panel').hidden) { closeChat(); return; }
    openChat(context);
  });
  $('#chat-close').addEventListener('click', closeChat);
  $('#chat-send').addEventListener('click', sendChat);
  $('#chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  // 清除上下文（事件委托到 document）
  document.addEventListener('click', (e) => {
    if (e.target.id === 'chat-clear-ctx') {
      chatContext = null;
      $('#chat-context').hidden = true;
      $('#chat-context').innerHTML = '';
      appendMsg('bot', '已清除转账上下文，您可以继续自由咨询。');
    }
  });

  // 历史明细：删除
  $('#history-body').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    history = removeHistoryItem(history, btn.dataset.del);
    refresh();
    showToast('已删除该条记录');
  });

  // 手动新增基准记录
  $('#add-record-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const payee = $('#r-payee').value.trim();
    const account = $('#r-account').value.trim();
    const amount = Number($('#r-amount').value);
    const time = $('#r-time').value;
    const note = $('#r-note').value.trim();
    if (!payee) return showToast('请填写收款人姓名');
    if (!Number.isFinite(amount) || amount <= 0) return showToast('金额必须大于 0');
    if (!time) return showToast('请选择时间');
    const item = {
      id: genId(),
      payee, account, amount, time, note,
      riskScore: 0, riskLevel: '低风险', points: [],
      createdAt: new Date().toISOString(),
    };
    history = addHistoryItem(history, item);
    e.target.reset();
    $('#r-time').value = toLocalInputValue();
    refresh();
    showToast('已新增历史基准记录');
  });

  // 示例数据 / 清空
  $('#btn-seed').addEventListener('click', () => {
    if (!confirm('将覆盖当前历史记录并载入示例数据，确定吗？')) return;
    seedDemoData();
    refresh();
    showToast('已载入示例数据');
  });
  $('#btn-clear').addEventListener('click', () => {
    if (!confirm('确定清空全部历史记录吗？此操作不可恢复。')) return;
    clearHistory();
    refresh();
    showToast('已清空历史记录');
  });

  // 打开反诈助手（侧栏按钮）
  $('#btn-open-chat').addEventListener('click', () => {
    if ($('#chat-panel').hidden) openChat(null);
  });
}

// ---------- 启动 ----------
function init() {
  $('#f-time').value = toLocalInputValue();
  $('#r-time').value = toLocalInputValue();
  bindEvents();
  refresh();
}

init();
