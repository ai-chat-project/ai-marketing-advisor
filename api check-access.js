import Stripe from 'stripe';
let kv = null;
try { ({ kv } = await import('@vercel/kv')); } catch {}

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || null;
const stripe = STRIPE_KEY ? new Stripe(STRIPE_KEY, { apiVersion: '2024-06-20' }) : null;

function parseCookie(req, name) {
  const cookieHeader = req.headers.cookie || '';
  const m = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name.replace(/[-[\\]/{}()*+?.\\\\^$|]/g,'\\$&') + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

async function readFromKV(customerId) {
  if (!kv) return null;
  try {
    const v = await kv.get(`sub:customer:${customerId}`);
    if (!v) return null;
    if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
    if (typeof v === 'object') return v;
    return null;
  } catch { return null; }
}

async function readFromStripe(customerId) {
  if (!stripe) return null;
  try {
    const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
    if (!subs?.data?.length) return null;
    const s = subs.data.find(x => x.status === 'active' || x.status === 'trialing') || subs.data[0];
    const info = {
      status: s.status,
      currentPeriodEnd: s.current_period_end ? new Date(s.current_period_end * 1000).toISOString() : null,
      trialEnd: s.trial_end ? new Date(s.trial_end * 1000).toISOString() : null
    };
    try { if (kv) await kv.set(`sub:customer:${customerId}`, info); } catch {}
    return info;
  } catch { return null; }
}

export default async function handler(req, res) {
  try {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');

    const customerId = parseCookie(req, 'stripe_cid');
    if (!customerId) return res.status(200).json({ hasAccess: false });

    let info = await readFromKV(customerId);
    if (!info) info = await readFromStripe(customerId);
    if (!info) return res.status(200).json({ hasAccess: false });

    const now = Date.now();
    const statusOk = ['active','trialing'].includes(info.status);
    const withinPeriod = info.currentPeriodEnd ? new Date(info.currentPeriodEnd).getTime() > now : false;
    const withinTrial  = info.trialEnd ? new Date(info.trialEnd).getTime() > now : false;

    const hasAccess = statusOk && (withinPeriod || withinTrial);
    return res.status(200).json({ hasAccess, status: info.status||null, currentPeriodEnd: info.currentPeriodEnd||null, trialEnd: info.trialEnd||null });
  } catch {
    return res.status(200).json({ hasAccess: false });
  }
}
