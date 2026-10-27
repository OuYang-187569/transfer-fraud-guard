/**
 * engine.test.js —— 风险引擎单元测试
 *
 * 覆盖：习惯画像计算（§4.1）、风险评分规则（§4.2）、边界条件与校验。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcProfile,
  evaluateTransaction,
  getRiskLevel,
  isNightTime,
  matchKeywords,
  formatTimeRange,
  formatHour,
  RISK_RULES,
  MAX_RISK_SCORE,
} from '../src/js/engine.js';

// ---------- 工具 ----------
const tx = (payee, amount, time, note = '') => ({ payee, amount, time, note });
const history = (list) => list.map((h) => tx(...h));

// ---------- 习惯画像（§4.1） ----------

test('空历史：画像为空，均值/最高/时间区间为 null', () => {
  const p = calcProfile([]);
  assert.equal(p.sampleCount, 0);
  assert.deepEqual(p.whitelist, []);
  assert.equal(p.amountMean, null);
  assert.equal(p.amountMax, null);
  assert.equal(p.commonRange, null);
  assert.equal(p.timeRange, null);
  assert.equal(p.nightCount, 0);
});

test('白名单：历史交易 ≥2 次的收款人进入白名单，1 次的不进入', () => {
  const p = calcProfile(history([
    ['张伟', 1000, '2026-01-01T10:00'],
    ['张伟', 2000, '2026-02-01T10:00'],
    ['张伟', 1500, '2026-03-01T10:00'],
    ['李娜', 500, '2026-01-10T10:00'],
  ]));
  assert.deepEqual(p.whitelist, [{ name: '张伟', count: 3 }]);
});

test('金额统计：均值、最高值、常见区间（均值±标准差）', () => {
  const p = calcProfile(history([
    ['A', 1000, '2026-01-01T10:00'],
    ['A', 2000, '2026-01-02T10:00'],
    ['A', 3000, '2026-01-03T10:00'],
  ]));
  assert.equal(p.amountMean, 2000);
  assert.equal(p.amountMax, 3000);
  assert.ok(Math.abs(p.amountStd - 816.5) < 0.1);
  assert.deepEqual(p.commonRange, [1183.5, 2816.5]);
});

test('常用时间段：取中央 80% 区间', () => {
  const times = [];
  for (let h = 9; h <= 18; h += 1) times.push(`2026-01-01T${String(h).padStart(2, '0')}:00`);
  const p = calcProfile(times.map((t) => ({ payee: 'A', amount: 100, time: t })));
  assert.deepEqual(p.timeRange, { startHour: 10, endHour: 17 });
});

test('深夜交易统计：23:00-06:00 计为深夜', () => {
  const p = calcProfile(history([
    ['A', 100, '2026-01-01T23:30'],
    ['B', 200, '2026-01-02T05:00'],
    ['C', 300, '2026-01-03T12:00'],
  ]));
  assert.equal(p.nightCount, 2);
});

test('时段格式化', () => {
  assert.equal(formatHour(9), '09:00');
  assert.equal(formatTimeRange({ startHour: 9, endHour: 21 }), '09:00 - 21:00');
  assert.equal(formatTimeRange(null), null);
});

// ---------- 非常规时段（§4.2 规则2） ----------

test('非常规时段边界：23:00 起、06:00 止（不含 06:00）', () => {
  assert.equal(isNightTime('2026-01-01T23:00'), true);
  assert.equal(isNightTime('2026-01-01T22:59'), false);
  assert.equal(isNightTime('2026-01-02T05:59'), true);
  assert.equal(isNightTime('2026-01-02T06:00'), false);
  assert.equal(isNightTime('2026-01-02T12:00'), false);
});

// ---------- 风险评分（§4.2） ----------

test('评分权重合计等于满分 100', () => {
  const total = RISK_RULES.STRANGER_PAYEE + RISK_RULES.NIGHT_TRANSACTION +
    RISK_RULES.HUGE_AMOUNT + RISK_RULES.SUSPICIOUS_NOTE;
  assert.equal(total, MAX_RISK_SCORE);
});

test('规则1：陌生收款人（非白名单）加 30 分；白名单收款人不加分', () => {
  const hist = history([
    ['张伟', 1000, '2026-01-01T10:00'],
    ['张伟', 1000, '2026-02-01T10:00'], // 张伟达到白名单（2次）
  ]);
  const profile = calcProfile(hist);

  const stranger = evaluateTransaction(tx('李娜', 800, '2026-03-01T10:00'), profile, hist);
  assert.equal(stranger.score, 30);
  assert.ok(stranger.points.some((p) => p.includes('不在常用白名单')));

  const familiar = evaluateTransaction(tx('张伟', 1000, '2026-03-01T10:00'), profile, hist);
  assert.equal(familiar.score, 0);
});

test('规则1：历史仅 1 次的收款人仍未达白名单门槛', () => {
  const hist = history([['张伟', 1000, '2026-01-01T10:00']]);
  const profile = calcProfile(hist);
  const r = evaluateTransaction(tx('张伟', 1000, '2026-02-01T10:00'), profile, hist);
  assert.equal(r.payeeCount, 1);
  assert.equal(r.score, 30);
});

test('规则2：深夜交易加 25 分，白天不加', () => {
  const r1 = evaluateTransaction(tx('新', 100, '2026-01-01T23:30'), calcProfile([]), []);
  assert.equal(r1.score, 55); // 陌生30 + 深夜25
  const r2 = evaluateTransaction(tx('新', 100, '2026-01-01T12:00'), calcProfile([]), []);
  assert.equal(r2.score, 30);
});

test('规则3：金额超过均值 3 倍或历史最高值 1.5 倍 → 加 25 分', () => {
  const hist = history([
    ['A', 1000, '2026-01-01T10:00'],
    ['A', 2000, '2026-01-02T10:00'], // mean=1500, max=2000
  ]);
  const profile = calcProfile(hist);

  // 超过均值 3 倍（4500）
  const r1 = evaluateTransaction(tx('B', 4501, '2026-03-01T10:00'), profile, hist);
  assert.equal(r1.score, 55); // 陌生30 + 超大25
  assert.ok(r1.points.some((p) => p.includes('金额异常偏大')));

  // 超过历史最高值 1.5 倍（3000），未达均值3倍
  const r2 = evaluateTransaction(tx('B', 3001, '2026-03-01T10:00'), profile, hist);
  assert.equal(r2.score, 55);
});

test('规则3边界：超过历史最高但未达 1.5 倍 → 仅提示不加分', () => {
  const hist = history([
    ['A', 1000, '2026-01-01T10:00'],
    ['A', 2000, '2026-01-02T10:00'],
  ]);
  const profile = calcProfile(hist);
  const r = evaluateTransaction(tx('B', 2001, '2026-03-01T10:00'), profile, hist);
  assert.equal(r.score, 30); // 仅陌生
  assert.ok(r.points.some((p) => p.includes('新的历史纪录')));
});

test('规则3：无历史数据时不比对金额，仅提示', () => {
  const r = evaluateTransaction(tx('新', 99999, '2026-01-01T12:00'), calcProfile([]), []);
  assert.equal(r.score, 30); // 仅陌生
  assert.ok(r.points.some((p) => p.includes('暂无历史转账记录')));
});

test('补充规则：附言含敏感词加 20 分', () => {
  const r = evaluateTransaction(tx('新', 100, '2026-01-01T12:00', '对方让我交保证金解冻'), calcProfile([]), []);
  assert.equal(r.score, 50); // 陌生30 + 敏感词20
  assert.ok(r.points.some((p) => p.includes('疑似诈骗敏感词')));
});

test('补充规则：正常附言不加分', () => {
  const r = evaluateTransaction(tx('张伟', 100, '2026-01-01T12:00', '房租'), calcProfile(history([['张伟', 100, '2026-01-01T12:00'], ['张伟', 100, '2026-01-02T12:00']])), history([['张伟', 100, '2026-01-01T12:00'], ['张伟', 100, '2026-01-02T12:00']]));
  assert.equal(r.score, 0);
});

test('分数封顶 100', () => {
  const r = evaluateTransaction(
    tx('陌生人', 99999, '2026-01-01T23:30', '保证金退款刷单验证码'),
    calcProfile(history([['A', 100, '2026-01-01T10:00']])),
    history([['A', 100, '2026-01-01T10:00']]),
  );
  // 陌生30 + 深夜25 + 超大25 + 敏感词20 = 100
  assert.equal(r.score, 100);
});

// ---------- 风险等级 ----------

test('风险等级阈值：0-29 低，30-69 中，70-100 高', () => {
  assert.equal(getRiskLevel(0).level, '低风险');
  assert.equal(getRiskLevel(29).level, '低风险');
  assert.equal(getRiskLevel(30).level, '中风险');
  assert.equal(getRiskLevel(69).level, '中风险');
  assert.equal(getRiskLevel(70).level, '高风险');
  assert.equal(getRiskLevel(100).level, '高风险');
});

test('evaluateTransaction 返回等级与风险点', () => {
  const r = evaluateTransaction(tx('新', 50000, '2026-01-01T23:00', '保证金'), calcProfile(history([['A', 100, '2026-01-01T10:00']])), history([['A', 100, '2026-01-01T10:00']]));
  assert.equal(r.level, '高风险');
  assert.ok(r.points.length >= 3);
});

// ---------- 入参校验 ----------

test('入参校验：缺收款人 / 金额非法 / 金额<=0 返回 error', () => {
  const emptyProfile = calcProfile([]);
  assert.ok(evaluateTransaction(tx('', 100, '2026-01-01T12:00'), emptyProfile, []).error);
  assert.ok(evaluateTransaction(tx('张三', 'abc', '2026-01-01T12:00'), emptyProfile, []).error);
  assert.ok(evaluateTransaction(tx('张三', 0, '2026-01-01T12:00'), emptyProfile, []).error);
  assert.ok(evaluateTransaction(tx('张三', -5, '2026-01-01T12:00'), emptyProfile, []).error);
});

// ---------- 敏感词匹配 ----------

test('敏感词匹配：命中与未命中', () => {
  assert.deepEqual(matchKeywords('交保证金'), ['保证金']);
  assert.ok(matchKeywords('先交押金再退款').length >= 1);
  assert.deepEqual(matchKeywords('房租还款'), []);
  assert.deepEqual(matchKeywords(''), []);
});
