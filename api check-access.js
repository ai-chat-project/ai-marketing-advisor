import Stripe from 'stripe';
let kv = null; try { ({ kv } = await import('@vercel/kv')); } catch {}

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || null;
const stripe = STRIPE_KEY ? new Stripe(STRIPE_KEY, { apiVersion: '2024-06-20' }) : null;

function parseCookie(req, name){
  const cookieHeader = req.headers.cookie || '';
  const m = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name.replace(/[-[\\]/{}()*+?.\\\\^$|]/g,'\\$&') + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

async function readFromKV(customerId){
  if (!kv) return null;
  try{
    const v = await kv.get(`sub:customer:${customerId}`);
    if (!v) return null;
    return (typeof v==='string') ? JSON.parse(v) : v;
  }catch{ return null; }
}

async function readFromStripe(customerId){
  if (!stripe) return null;
  try{
    const subs = await stripe.subscriptions.list({ customer: customerId, status:'all', limit:10 });
    if (!subs?.data?.length) return null;
    const s = subs.data.find(x=>x.status==='active'||x.status==='trialing') || subs.data[0];
    const info = {
      status: s.status,
      currentPeriodEnd: s.current_period_end ? new Date(s.current_period_end*1000).toISOString() : null,
      trialEnd: s.trial_end ? new Date(s.trial_end*1000).toISOString() : null
    };
    try{ if (kv) await kv.set(`sub:customer:${customerId}`, info); }catch{}
    return info;
  }catch{ return null; }
}

export default async function handler(req, res){
  try{
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.set
