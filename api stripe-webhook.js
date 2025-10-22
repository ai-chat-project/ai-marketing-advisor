import Stripe from 'stripe';
let kv = null;
try { ({ kv } = await import('@vercel/kv')); } catch {}

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_KEY) {
  export default function handler(req, res) {
    return res.status(500).send('Missing STRIPE_SECRET_KEY');
  };
}
const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2024-06-20' });

// keep raw body (Next.js API compatible; ignored by pure Vercel functions but safe)
export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks=[]; req.on('data',c=>chunks.push(c)); req.on('end',()=>resolve(Buffer.concat(chunks))); req.on('error',reject);
  });
}

async function upsertFromSubscription(sub) {
  if (!kv) return;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  if (!customerId) return;
  const info = {
    status: sub.status,
    currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
    trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null
  };
  try { await kv.set(`sub:customer:${customerId}`, info); } catch {}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(200).json({ ok: true, note: 'No STRIPE_WEBHOOK_SECRET set' });

  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).send('Missing stripe-signature header');

  let event;
  try {
    const raw = await readRawBody(req);
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session?.subscription) {
          const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
          try { const sub = await stripe.subscriptions.retrieve(subId); await upsertFromSubscription(sub); } catch {}
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await upsertFromSubscription(sub);
        break;
      }
    }
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('stripe-webhook handler failed:', e);
    return res.status(500).send(e?.message || 'Webhook handler failed');
  }
}
