import Stripe from 'stripe';
let kv = null; try { ({ kv } = await import('@vercel/kv')); } catch {}

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_KEY) {
  export default function handler(req, res) {
    return res.status(500).send('Missing STRIPE_SECRET_KEY.');
  };
}
const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2024-06-20' });

async function upsertSubscriptionInfo(sub){
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  if (!customerId) return null;
  const info = {
    status: sub.status,
    currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end*1000).toISOString() : null,
    trialEnd: sub.trial_end ? new Date(sub.trial_end*1000).toISOString() : null
  };
  try{ if (kv) await kv.set(`sub:customer:${customerId}`, info); }catch{}
  return info;
}

export default async function handler(req, res){
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  try{
    const { session_id } = req.body || {};
    if (!session_id) return res.status(400).send('Missing session_id');

    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (!session || !session.customer) return res.status(400).send('Invalid session');

    const customerId = typeof session.customer === 'string' ? session.customer : session.customer.id;

    const cookie = [
      `stripe_cid=${encodeURIComponent(customerId)}`,
      'Path=/','HttpOnly','SameSite=Lax','Secure',`Max-Age=${60*60*24*365}`
    ].join('; ');
    res.setHeader('Set-Cookie', cookie);

    let subInfo = null;
    if (session.subscription) {
      const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
      try{ const sub = await stripe.subscriptions.retrieve(subId); subInfo = await upsertSubscriptionInfo(sub); }catch{}
    }
    return res.status(200).json({ ok:true, customerId, sub: subInfo });
  }catch(e){
    console.error('link-session error:', e);
    return res.status(500).send(e?.message || 'Link failed');
  }
}
