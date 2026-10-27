/**
 * chatbot.js —— 悬浮 AI 反诈助手（规则化离线知识库，无外部依赖）
 *
 * 结合当前转账上下文 + 反诈知识库，给出可执行的分析与防骗建议。
 * 输出为确定性结果，便于单元测试；如需接入真实大模型 API，
 * 只需替换 getBotReply 的实现（见 README「AI 助手说明」）。
 */

/** 反诈知识库：分类关键词命中表 */
export const FRAUD_KB = Object.freeze([
  {
    id: 'customer-service',
    title: '冒充客服 / 保证金诈骗',
    keywords: ['客服', '保证金', '解冻', '安全账户', '注销', '会员'],
    advice:
      '凡自称平台客服，要求缴纳"保证金""解冻费""手续费"或转入"安全账户"的，均为诈骗。请通过官方 App / 官方客服电话核实，切勿按对方指引转账。',
  },
  {
    id: 'refund',
    title: '退款 / 理赔诈骗',
    keywords: ['退款', '理赔', '运费险', '快递丢失', '理赔金', '退款链接'],
    advice:
      '退款理赔应走平台原路退回，不会要求你先转账、先付"手续费"或下载会议软件开启屏幕共享。任何"多退你钱，请退回差额"都是话术。',
  },
  {
    id: 'brushing',
    title: '刷单 / 返利 / 兼职诈骗',
    keywords: ['刷单', '返利', '兼职', '佣金', '点赞', '垫付', '代付'],
    advice:
      '刷单返利、点赞返佣、垫付任务均为诈骗。对方会先用小额返利骗取信任，再以"连单""卡单""需要垫付"为由让你越转越多。',
  },
  {
    id: 'investment',
    title: '投资理财 / 杀猪盘',
    keywords: ['投资', '理财', '稳赚', '内幕', '高收益', '网恋', '男友', '女友', '平台'],
    advice:
      '"稳赚不赔""内幕消息"的理财平台多为杀猪盘。网络结识的"恋人/导师"诱导转账入金，提现时必然以各种理由要求继续充值。',
  },
  {
    id: 'public-security',
    title: '冒充公检法',
    keywords: ['公安', '检察院', '法院', '通缉', '洗钱', '资金核查', '配合调查'],
    advice:
      '公检法机关不会通过电话、QQ、微信办案，更不会要求转账到"安全账户"自证清白。接到此类电话请直接挂断并拨打 96110 核实。',
  },
  {
    id: 'loan',
    title: '贷款 / 征信诈骗',
    keywords: ['贷款', '征信', '刷流水', '工本费', '贷款平台'],
    advice:
      '正规贷款放款前不会收取任何费用。凡以"刷流水""征信修复""工本费"为由要求先转账的，均为诈骗。',
  },
  {
    id: 'code',
    title: '验证码 / 密码窃取',
    keywords: ['验证码', '密码', '银行卡号', '密码重置'],
    advice:
      '验证码、支付密码、银行卡密码绝不能告诉任何人，包括自称银行或平台客服的人员。索要验证码 = 诈骗。',
  },
  {
    id: 'lottery',
    title: '中奖 / 抽奖诈骗',
    keywords: ['中奖', '抽奖', '奖品', '税费', '公证费'],
    advice:
      '以"中奖需先缴税费/公证费/保证金"为由要求先转账的，均为诈骗。正规中奖不会要求先行付款。',
  },
  {
    id: 'account',
    title: '出借账户 / 跑分洗钱',
    keywords: ['出借', '出租', '银行卡', '跑分', '帮人转账', '帮忙收款'],
    advice:
      '出借、出租银行卡或帮忙收款转账可能涉嫌帮助信息网络犯罪活动罪（帮信罪）。切勿为"好处费"出借账户。',
  },
]);

/** 通用兜底建议 */
export const DEFAULT_ADVICE =
  '未匹配到特定诈骗类型。请保持警惕：先核实对方真实身份与用途，确认是否为本人熟悉且可信的交易对象。';

/** 通用安全提示 */
export const SAFE_TIPS =
  '安全提示：① 绝不向任何人透露短信验证码；② 通过官方渠道核实身份，不要点击对方发来的链接；③ 大额转账前先与家人/96110 核实；④ 遇疑似诈骗请立即拨打 96110 反诈专线。';

/** 格式化交易时间展示 */
function formatTime(isoTime) {
  if (!isoTime) return '';
  return String(isoTime).replace('T', ' ');
}

/** 构建当前转账上下文的摘要文本 */
export function buildContextSummary(ctx = {}) {
  const parts = [];
  if (ctx.payee) parts.push(`收款人：${ctx.payee}`);
  if (typeof ctx.amount === 'number' && ctx.amount > 0) parts.push(`金额：${ctx.amount} 元`);
  if (ctx.time) parts.push(`时间：${formatTime(ctx.time)}`);
  if (ctx.note) parts.push(`附言：${ctx.note}`);
  if (ctx.riskScore != null) {
    parts.push(`当前风险评估：${ctx.riskScore} 分 / ${ctx.riskLevel || '—'}`);
  }
  if (Array.isArray(ctx.points) && ctx.points.length) {
    parts.push(`已识别风险点：${ctx.points.join('；')}`);
  }
  return parts.length ? `【当前转账上下文】\n${parts.join('\n')}` : '【当前转账上下文】未填写或未带入';
}

/**
 * 生成 AI 助手的回复。
 * @param {string} input 用户输入
 * @param {object} [context] 转账上下文 {payee, amount, time, note, riskScore, riskLevel, points}
 * @returns {{text:string, matched:string[]}}
 */
export function getBotReply(input, context = {}) {
  const text = (input || '').trim();
  if (!text) {
    return {
      text: '您好，我是反诈小助手。您可以咨询任何与转账安全相关的问题，也可以点击「一键咨询」带入当前转账信息。',
      matched: [],
    };
  }

  const matched = FRAUD_KB.filter((cat) => cat.keywords.some((kw) => text.includes(kw)));

  const contextPart = buildContextSummary(context);

  const advicePart = matched.length
    ? matched.map((cat) => `【${cat.title}】\n${cat.advice}`).join('\n\n')
    : DEFAULT_ADVICE;

  const warning =
    typeof context.riskScore === 'number' && context.riskScore >= 70
      ? '⚠️ 注意：当前交易已被评估为【高风险】，强烈建议先核实、暂缓转账。\n\n'
      : '';

  return {
    text: [warning, contextPart, advicePart, SAFE_TIPS].filter(Boolean).join('\n\n'),
    matched: matched.map((cat) => cat.title),
  };
}
