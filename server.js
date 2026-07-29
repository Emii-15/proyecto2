// server.js - API Exclusiva (Los estáticos los sirve Vercel automáticamente)

const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function assertConfiguration() {
  if (!SECRET || !SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Missing JWT_SECRET, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY');
  }
}

async function supabase(table, { method = 'GET', query = '', body } = {}) {
  assertConfiguration();
  const credentials = SUPABASE_KEY.startsWith('sb_secret_')
    ? { apikey: SUPABASE_KEY }
    : { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method,
    headers: {
      ...credentials,
      'Content-Type': 'application/json',
      ...(method !== 'GET' ? { Prefer: 'return=representation' } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!response.ok) throw new Error(`Supabase responded ${response.status} while accessing ${table}`);
  return response.json();
}

const b64url = value => Buffer.from(value).toString('base64url');
function token(payload) {
  assertConfiguration();
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = b64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', SECRET).update(`${header}.${data}`).digest('base64url');
  return `${header}.${data}.${signature}`;
}
function verify(value) {
  try {
    const [header, data, signature] = value.split('.');
    const expected = crypto.createHmac('sha256', SECRET).update(`${header}.${data}`).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    return payload.exp > Date.now() / 1000 ? payload : null;
  } catch { return null; }
}
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); } });
  });
}
function auth(req, res, roles) {
  const value = (req.headers.authorization || '').replace('Bearer ', '');
  const user = verify(value);
  if (!user || !roles.includes(user.role)) {
    json(res, 403, { error: 'No autorizado' });
    return null;
  }
  return user;
}
function mapOrder(order) {
  return {
    id: order.order_code,
    customer: order.customer,
    address: order.address,
    status: order.status,
    notes: order.notes,
    items: [['Bebida isotónica 500ml', 12], ['Agua mineral 1.5L', 8]]
  };
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.end();

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;
    const method = req.method;

    if (!path.startsWith('/api/')) {
      if (process.env.VERCEL) return json(res, 404, { error: 'API route not found' });
      const fs = require('fs');
      const filePath = path === '/' ? 'index.html' : path.slice(1);
      const safePath = !filePath.includes('..') && /^[a-zA-Z0-9._/-]+$/.test(filePath) ? filePath : '';
      const target = safePath ? require('path').join(process.cwd(), safePath) : '';
      if (!target || !fs.existsSync(target) || fs.statSync(target).isDirectory()) return json(res, 404, { error: 'Not found' });
      const extension = require('path').extname(target);
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
      res.writeHead(200, { 'Content-Type': types[extension] || 'application/octet-stream' });
      return res.end(fs.readFileSync(target));
    }

    if (method === 'POST' && path === '/api/auth/login') {
      const { email, password } = await readBody(req);
      const users = await supabase('users', { query: `email=eq.${encodeURIComponent(String(email || '').toLowerCase())}&limit=1` });
      const user = users[0];
      if (!user || user.password !== password) return json(res, 401, { error: 'Credenciales inválidas' });
      return json(res, 200, {
        token: token({ sub: user.email, role: user.role, exp: Math.floor(Date.now() / 1000) + 28800 }),
        user: { name: user.name, role: user.role }
      });
    }

    if (method === 'GET' && path === '/api/routes/current') {
      if (!auth(req, res, ['driver'])) return;
      const route = (await supabase('routes', { query: 'limit=1' }))[0];
      if (!route) return json(res, 404, { error: 'Ruta no encontrada' });
      const orders = await supabase('orders', { query: `route_id=eq.${route.id}&order=order_code.asc` });
      return json(res, 200, { id: route.route_code, zone: route.zone, driver: route.driver_name, finalized: route.finalized, orders: orders.map(mapOrder) });
    }

    if (method === 'PUT' && path.startsWith('/api/orders/')) {
      if (!auth(req, res, ['driver'])) return;
      const orderCode = decodeURIComponent(path.split('/').pop());
      const { status, notes = '' } = await readBody(req);
      if (!['Completa', 'Parcial'].includes(status)) return json(res, 422, { error: 'Estado inválido' });
      const updated = await supabase('orders', {
        method: 'PATCH', query: `order_code=eq.${encodeURIComponent(orderCode)}`,
        body: { status, notes, updated_at: new Date().toISOString() }
      });
      if (!updated[0]) return json(res, 404, { error: 'Pedido inexistente' });
      return json(res, 200, mapOrder(updated[0]));
    }

    if (method === 'POST' && path === '/api/routes/current/finalize') {
      if (!auth(req, res, ['driver'])) return;
      const route = (await supabase('routes', { query: 'limit=1' }))[0];
      if (!route) return json(res, 404, { error: 'Ruta no encontrada' });
      const pending = await supabase('orders', { query: `route_id=eq.${route.id}&status=eq.Pendiente` });
      if (pending.length) return json(res, 422, { error: 'Existen pedidos pendientes' });
      const updated = await supabase('routes', { method: 'PATCH', query: `id=eq.${route.id}`, body: { finalized: true, finalized_at: new Date().toISOString() } });
      return json(res, 200, updated[0]);
    }

    if (method === 'GET' && path === '/api/admin/operations') {
      if (!auth(req, res, ['admin'])) return;
      const route = (await supabase('routes', { query: 'limit=1' }))[0];
      if (!route) return json(res, 404, { error: 'Ruta no encontrada' });
      const orders = await supabase('orders', { query: `route_id=eq.${route.id}&order=order_code.asc` });
      return json(res, 200, { routes: [{ id: route.route_code, zone: route.zone, driver: route.driver_name, finalized: route.finalized, orders: orders.map(mapOrder) }] });
    }
    return json(res, 404, { error: 'Endpoint API no encontrado' });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: error.message || 'Error interno del servidor' });
  }
}

if (!process.env.VERCEL && require.main === module) {
  http.createServer(handler).listen(PORT, () => console.log(`RutaLog running on http://localhost:${PORT}`));
}

module.exports = handler;

