/**
 * chatbot.test.js —— 悬浮 AI 反诈助手单元测试
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { getBotReply, buildContextSummary, FRAUD_KB, SAFE_TIPS } from '../src/js/chatbot.js';

test('空输入返回引导语', () => {
  const r = getBotReply('', {});
  assert.ok(r.text.length > 0);
  assert.deepEqual(r.matched, []);
});

test('知识库：冒充客服/保证金类问题命中对应分类', () => {
  const r = getBotReply('对方自称客服让我转账保证金，安全吗？', {});
  assert.ok(r.matched.includes('冒充客服 / 保证金诈骗'));
  assert.ok(r.text.includes('96110'));
});

test('知识库：刷单返利类问题命中', () => {
  const r = getBotReply('刷单返利兼职靠谱吗？', {});
  assert.ok(r.matched.includes('刷单 / 返利 / 兼职诈骗'));
  assert.ok(r.text.includes('垫付'));
});

test('知识库：未命中时给出通用建议', () => {
  const r = getBotReply('今天天气怎么样？', {});
  assert.deepEqual(r.matched, []);
  assert.ok(r.text.includes('未匹配到特定诈骗类型'));
  assert.ok(r.text.includes(SAFE_TIPS));
});

test('上下文联动：高风险交易输出警告', () => {
  const ctx = {
    payee: '张伟',
    amount: 50000,
    time: '2026-10-01T23:30',
    note: '保证金',
    riskScore: 95,
    riskLevel: '高风险',
    points: ['深夜非常规时段交易'],
  };
  const r = getBotReply('这笔转账能继续吗？', ctx);
  assert.ok(r.text.includes('高风险'));
  assert.ok(r.text.includes('收款人：张伟'));
  assert.ok(r.text.includes('金额：50000 元'));
  assert.ok(r.text.includes('已识别风险点'));
});

test('上下文摘要：空上下文提示未带入', () => {
  const s = buildContextSummary({});
  assert.ok(s.includes('未填写或未带入'));
});

test('上下文摘要：包含收款人/金额/时间/风险点', () => {
  const s = buildContextSummary({
    payee: '李娜', amount: 350, time: '2026-10-05T20:45', riskScore: 30, riskLevel: '中风险',
    points: ['收款人不在常用白名单'],
  });
  assert.ok(s.includes('收款人：李娜'));
  assert.ok(s.includes('金额：350 元'));
  assert.ok(s.includes('时间：2026-10-05 20:45'));
  assert.ok(s.includes('30 分'));
});

test('知识库分类数量与关键词非空', () => {
  assert.ok(FRAUD_KB.length >= 8);
  for (const cat of FRAUD_KB) {
    assert.ok(cat.title && cat.advice.length > 20, `分类 ${cat.id} 缺少建议`);
    assert.ok(cat.keywords.length >= 2, `分类 ${cat.id} 关键词过少`);
  }
});
