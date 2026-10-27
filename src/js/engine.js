/**
 * engine.js —— 风险评分与习惯画像核心逻辑（纯函数，无副作用）
 *
 * 浏览器端与 Node 测试共用同一份实现。
 * 规则来源：需求文档 §4 业务规则与核心逻辑
 *  - §4.1 习惯画像计算规则（白名单 / 金额区间 / 常用时间段）
 *  - §4.2 风险评分与等级判定规则（陌生收款人 +30、异常时段 +25、超大金额 +25）
 *  - 补充规则：为补全 0-100 分制，增加「附言含疑似诈骗敏感词 +20」（见 README 假设说明）
 */

// ---------- 常量（可调参数，测试依赖这些值） ----------

/** 白名单门槛：历史转账次数达到该值及以上的收款账户自动计入白名单 */
export const WHITELIST_MIN_COUNT = 2;
/** 非常规时段起点（含）：23:00 */
export const NIGHT_START_HOUR = 23;
/** 非常规时段终点（不含）：06:00 */
export const NIGHT_END_HOUR = 6;
/** 金额异常判定阈值：单笔金额 > 历史单笔最大值 × 该值 → 判定金额异常（§4.1） */
export const AMOUNT_ABNORMAL_RATIO = 1.5;
/** 超大金额阈值：单笔金额 > 日常均值 × 该值 或 > 历史最高值 → 加分（§4.2） */
export const HUGE_AMOUNT_MEAN_RATIO = 3;
/** 风险分上限 */
export const MAX_RISK_SCORE = 100;

/** 风险评分权重（满分 100） */
export const RISK_RULES = Object.freeze({
  /** 陌生收款人（非白名单账户） */
  STRANGER_PAYEE: 30,
  /** 异常时段交易（23:00 - 06:00） */
  NIGHT_TRANSACTION: 25,
  /** 超大金额异常（超过日常均值 3 倍或历史最高值） */
  HUGE_AMOUNT: 25,
  /** 转账附言含疑似诈骗敏感词 */
  SUSPICIOUS_NOTE: 20,
});

/** 风险等级划分 */
export const RISK_LEVELS = Object.freeze([
  { level: '低风险', min: 0, max: 29 },
  { level: '中风险', min: 30, max: 69 },
  { level: '高风险', min: 70, max: 100 },
]);

/** 疑似诈骗敏感词库（用于附言检测与 AI 助手知识库联动） */
export const SENSITIVE_KEYWORDS = Object.freeze([
  '保证金', '解冻', '刷单', '返利', '佣金', '兼职', '垫付', '代付', '押金',
  '验证码', '安全账户', '手续费', '注销', '理赔', '退款', '运费险',
  '中奖', '抽奖', '贷款', '工本费', '刷流水', '征信', '内幕', '稳赚',
  '高收益', '投资理财', '网恋', '紧急转账', '别告诉家人',
]);

// ---------- 工具函数 ----------

/** 从 ISO 时间字符串中取出小时（本地时区） */
export function getHour(isoTime) {
  const d = new Date(isoTime);
  if (Number.isNaN(d.getTime())) return -1;
  return d.getHours();
}

/** 是否处于非常规时段（23:00 - 次日 06:00） */
export function isNightTime(isoTime) {
  const h = getHour(isoTime);
  return h >= NIGHT_START_HOUR || h < NIGHT_END_HOUR;
}

/** 取最近出现的风险等级对象 */
export function getRiskLevel(score) {
  const s = Math.max(0, Math.min(MAX_RISK_SCORE, score));
  return RISK_LEVELS.find((r) => s >= r.min && s <= r.max) || RISK_LEVELS[0];
}

/** 保留两位小数 */
export function round2(n) {
  return Math.round(n * 100) / 100;
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((acc, v) => acc + (v - m) ** 2, 0) / arr.length);
}

/**
 * 计算常用时间段：取历史交易小时序列的中央 80% 区间（十分位 ~ 九十分位），
 * 作为"常用时间段"展示（如 09:00 - 21:00）。样本不足时退化为 [最早, 最晚]。
 */
function centralTimeRange(hours) {
  const sorted = [...hours].sort((a, b) => a - b);
  const n = sorted.length;
  const loIdx = Math.floor(n * 0.1);
  const hiIdx = Math.max(loIdx, Math.ceil(n * 0.9) - 1);
  return { startHour: sorted[loIdx], endHour: sorted[hiIdx] };
}

/** 将小时数格式化为 "HH:00" */
export function formatHour(h) {
  return `${String(h).padStart(2, '0')}:00`;
}

/** 将时间段对象格式化为 "09:00 - 21:00" */
export function formatTimeRange(range) {
  if (!range) return null;
  return `${formatHour(range.startHour)} - ${formatHour(range.endHour)}`;
}

/** 从附言中提取命中的敏感词 */
export function matchKeywords(note = '') {
  if (!note) return [];
  return SENSITIVE_KEYWORDS.filter((kw) => note.includes(kw));
}

// ---------- 习惯画像计算（§4.1） ----------

/**
 * 根据历史转账记录计算个人习惯画像。
 * @param {Array<{payee:string, amount:number, time:string}>} history
 * @returns {{
 *   whitelist: Array<{name:string, count:number}>,
 *   amountMean: number|null, amountMax: number|null, amountStd: number,
 *   commonRange: [number, number]|null,
 *   timeRange: {startHour:number, endHour:number}|null,
 *   sampleCount: number, nightCount: number
 * }}
 */
export function calcProfile(history = []) {
  const valid = history.filter(
    (tx) => tx && typeof tx.amount === 'number' && tx.amount > 0 && tx.time,
  );

  const counts = new Map(); // 收款人 -> 次数
  const amounts = [];
  const hours = [];

  for (const tx of valid) {
    counts.set(tx.payee, (counts.get(tx.payee) || 0) + 1);
    amounts.push(tx.amount);
    const h = getHour(tx.time);
    if (h >= 0) hours.push(h);
  }

  // 1. 常用收款人白名单：历史交易 ≥ 2 次
  const whitelist = [...counts.entries()]
    .filter(([, count]) => count >= WHITELIST_MIN_COUNT)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const sampleCount = valid.length;
  const amountMean = sampleCount ? round2(mean(amounts)) : null;
  const amountMax = sampleCount ? Math.max(...amounts) : null;
  const amountStd = sampleCount > 1 ? round2(stddev(amounts)) : 0;

  // 2. 常规金额区间：均值 ± 标准差（下界不小于 0）
  const commonRange =
    amountMean == null
      ? null
      : [round2(Math.max(0, amountMean - amountStd)), round2(amountMean + amountStd)];

  // 3. 常用时间段
  const timeRange = sampleCount ? centralTimeRange(hours) : null;

  // 附加统计：深夜交易次数
  const nightCount = valid.filter((tx) => isNightTime(tx.time)).length;

  return {
    whitelist,
    amountMean,
    amountMax,
    amountStd,
    commonRange,
    timeRange,
    sampleCount,
    nightCount,
  };
}

// ---------- 单笔交易风险评估（§4.2） ----------

/**
 * 对一笔新交易进行风险评分（0-100）。
 * @param {{payee:string, account?:string, amount:number, time:string, note?:string}} tx
 * @param {ReturnType<typeof calcProfile>} profile 由 history 计算出的画像
 * @param {Array} history 历史已确认转账（不含当前这笔）
 * @returns {{score:number, level:string, points:string[], payeeCount:number, error?:string}}
 */
export function evaluateTransaction(tx, profile, history = []) {
  if (!tx || !tx.payee || typeof tx.amount !== 'number' || !tx.time) {
    return {
      error: '交易信息不完整（收款人、金额、交易时间均为必填）',
      score: 0,
      level: '低风险',
      points: [],
      payeeCount: 0,
    };
  }
  if (tx.amount <= 0) {
    return { error: '转账金额必须大于 0', score: 0, level: '低风险', points: [], payeeCount: 0 };
  }

  const points = [];
  let score = 0;

  // 规则1：陌生收款人（非白名单账户）+30
  const payeeCount = history.filter((h) => h && h.payee === tx.payee).length;
  if (payeeCount < WHITELIST_MIN_COUNT) {
    score += RISK_RULES.STRANGER_PAYEE;
    points.push(
      `收款人「${tx.payee}」不在常用白名单（历史交易不足 ${WHITELIST_MIN_COUNT} 次，当前 ${payeeCount} 次）`,
    );
  }

  // 规则2：异常时段交易（23:00 - 06:00）+25
  if (isNightTime(tx.time)) {
    score += RISK_RULES.NIGHT_TRANSACTION;
    points.push('深夜非常规时段交易（23:00 - 次日 06:00）');
  }

  // 规则3：超大金额异常（§4.2：超过日常均值3倍；§4.1：超过历史最高值1.5倍）→ +25
  // 无历史数据时无法比对，跳过金额规则，仅作提示。
  if (profile && profile.amountMean != null && profile.amountMax != null) {
    const huge =
      tx.amount > HUGE_AMOUNT_MEAN_RATIO * profile.amountMean ||
      tx.amount > AMOUNT_ABNORMAL_RATIO * profile.amountMax;
    if (huge) {
      score += RISK_RULES.HUGE_AMOUNT;
      points.push(
        `金额异常偏大（超过日常均值 ${HUGE_AMOUNT_MEAN_RATIO} 倍，或超过历史最高值 ${profile.amountMax} 元的 ${AMOUNT_ABNORMAL_RATIO} 倍）`,
      );
    } else if (tx.amount > profile.amountMax) {
      // 超过历史最高值但未达 1.5 倍：提示为金额新高（不加分）
      points.push(`金额超过历史最高值（${profile.amountMax} 元），为新的历史纪录，请确认用途`);
    }
  } else if (!profile || profile.sampleCount === 0) {
    points.push('暂无历史转账记录，暂无法比对金额习惯与收款人画像');
  }

  // 补充规则：附言含疑似诈骗敏感词 +20
  const hitKeywords = matchKeywords(tx.note);
  if (hitKeywords.length > 0) {
    score += RISK_RULES.SUSPICIOUS_NOTE;
    points.push(`转账附言含疑似诈骗敏感词：「${hitKeywords.join('、')}」`);
  }

  score = Math.min(MAX_RISK_SCORE, score);

  return {
    score,
    level: getRiskLevel(score).level,
    points,
    payeeCount,
  };
}
