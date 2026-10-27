/**
 * storage.js —— localStorage 持久化（纯前端、私有、免后端）
 *
 * 存储结构：历史已确认转账记录数组。
 * 每条记录：{ id, payee, account, amount, time, note, riskScore, riskLevel, points, createdAt }
 */

const HISTORY_KEY = 'transfer_guard_history_v1';

/** 生成短 id */
export function genId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 读取历史转账记录 */
export function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.warn('读取本地历史记录失败，返回空列表', err);
    return [];
  }
}

/** 整体覆盖保存 */
export function saveHistory(history) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    return true;
  } catch (err) {
    console.error('保存本地历史记录失败', err);
    return false;
  }
}

/** 追加一条历史记录（返回新数组） */
export function addHistoryItem(history, item) {
  const next = [item, ...history];
  saveHistory(next);
  return next;
}

/** 删除指定 id 的记录 */
export function removeHistoryItem(history, id) {
  const next = history.filter((h) => h.id !== id);
  saveHistory(next);
  return next;
}

/** 清空全部历史 */
export function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
}

/** 载入示例数据（用于首次体验，可在设置中一键清空） */
export function seedDemoData() {
  const demos = [
    {
      id: 'demo-1',
      payee: '张伟',
      account: '6222 0200 **** 1234',
      amount: 1800,
      time: '2026-09-12T10:15',
      note: '房租',
      riskScore: 0,
      riskLevel: '低风险',
      points: [],
      createdAt: '2026-09-12T10:15:00',
    },
    {
      id: 'demo-2',
      payee: '张伟',
      account: '6222 0200 **** 1234',
      amount: 1800,
      time: '2026-10-01T09:30',
      note: '房租',
      riskScore: 0,
      riskLevel: '低风险',
      points: [],
      createdAt: '2026-10-01T09:30:00',
    },
    {
      id: 'demo-3',
      payee: '李娜',
      account: '6228 **** 5678',
      amount: 350,
      time: '2026-10-05T20:45',
      note: '聚餐AA',
      riskScore: 0,
      riskLevel: '低风险',
      points: [],
      createdAt: '2026-10-05T20:45:00',
    },
    {
      id: 'demo-4',
      payee: '王强',
      account: '6217 **** 8888',
      amount: 5000,
      time: '2026-10-20T12:00',
      note: '货款',
      riskScore: 0,
      riskLevel: '低风险',
      points: [],
      createdAt: '2026-10-20T12:00:00',
    },
  ];
  saveHistory(demos);
  return demos;
}
