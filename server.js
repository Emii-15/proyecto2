// Forzando recarga de dependencias en Vercel - 2026 (Sin módulos externos pesados)

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'cambiar-esta-clave-en-produccion';

// Configuración para conectar a Supabase mediante su API REST nativa integrada
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vassruceqqjyejbiomza.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';

// Función auxiliar para hacer peticiones directas a Supabase sin requerir la librería 'pg'
async function dbQuery(table, queryParams = '') {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${queryParams}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) throw new Error('Error en la consulta a Supabase');
  return await response.json();
}

async function dbMutate(table, method, bodyData, queryParams = '') {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${queryParams}`, {
    method: method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(bodyData)
  });
  if (!response.ok) throw new Error('Error en la mutación a Supabase');
  return await response.json();
}

const b64url = value => Buffer.from(value).toString('base64url');
function token(payload) { const head=b64url(JSON.stringify({alg:'HS256',typ:'JWT'})); const body=b64url(JSON.stringify(payload)); const sig=crypto.createHmac('sha256',SECRET).update(`${head}.${body}`).digest('base64url'); return `${head}.${body}.${sig}`; }
function verify(value) { try { const [h,p,s]=value.split('.'); const expected=crypto.createHmac('sha256',SECRET).update(`${h}.${p}`).digest('base64url'); if(!crypto.timingSafeEqual(Buffer.from(s),Buffer.from(expected))) return null; const data=JSON.parse(Buffer.from(p,'base64url').toString()); return data.exp>Date.now()/1000?data:null; } catch { return null; } }
function json(res,status,data) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(data)); }
function body(req) { return new Promise((resolve,reject)=>{ let raw=''; req.on('data',chunk=>raw+=chunk); req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{});}catch(e){reject(e);}}); }); }
function auth(req, res, roles) { const value=(req.headers.authorization||'').replace('Bearer ',''); const user=verify(value); if(!user || (roles && !roles.includes(user.role))) { json(res,403,{error:'No autorizado'}); return null; } return user; }

function serveFile(res, file) {
  const cleanFile = file.startsWith('/') ? file.slice(1) : file;
  const safe = path.basename(cleanFile || 'index.html');
  // Usamos __dirname para asegurar que busque los archivos junto a server.js en Vercel
  const target = path.join(__dirname, safe === '' ? 'index.html' : safe);
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  
  fs.readFile(target, (err, data) => {
    if (err) {
      // Fallback a index.html para soportar rutas de SPA si fuera necesario
      fs.readFile(path.join(__dirname, 'index.html'), (err2, data2) => {
        if (err2) return json(res, 404, { error: 'No encontrado' });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data2);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req,res)=>{
  try {
    const url=new URL(req.url,`http://${req.headers.host}`); const method=req.method;

    // LOGIN
    if(method==='POST' && url.pathname==='/api/auth/login') { 
      const {email,password}=await body(req); 
      const users = await dbQuery('users', `email=eq.${encodeURIComponent(email?.toLowerCase())}&limit=1`);
      const user = users[0];
      if(!user || user.password !== password) return json(res,401,{error:'Credenciales inválidas'}); 
      return json(res,200,{token:token({sub:email,role:user.role,exp:Math.floor(Date.now()/1000)+28800}),user:{name:user.name,role:user.role}});
    }

    // RUTA ACTUAL (DRIVER)
    if(method==='GET' && url.pathname==='/api/routes/current') { 
      if(!auth(req,res,['driver'])) return; 
      const routes = await dbQuery('routes', 'limit=1');
      const routeData = routes[0];
      const ordersRows = await dbQuery('orders', `route_id=eq.${routeData.id}`);
      
      const orders = ordersRows.map(o => ({
        id: o.order_code,
        customer: o.customer,
        address: o.address,
        status: o.status,
        notes: o.notes,
        items: [['Bebida isotónica 500ml', 12], ['Agua mineral 1.5L', 8]]
      }));

      return json(res,200, {
        id: routeData.route_code,
        zone: routeData.zone,
        driver: routeData.driver_name,
        finalized: routeData.finalized,
        orders
      });
    }

    // ACTUALIZAR PEDIDO (DRIVER)
    if(method==='PUT' && url.pathname.startsWith('/api/orders/')) { 
      if(!auth(req,res,['driver'])) return; 
      const orderCode = url.pathname.split('/').pop();
      const {status,notes=''}=await body(req); 
      if(!['Completa','Parcial'].includes(status)) return json(res,422,{error:'Estado inválido'});
      
      const updated = await dbMutate('orders', 'PATCH', { status, notes, updated_at: new Date().toISOString() }, `order_code=eq.${orderCode}`);
      if(!updated || updated.length === 0) return json(res,404,{error:'Pedido inexistente'});
      
      const o = updated[0];
      return json(res,200, { id: o.order_code, customer: o.customer, address: o.address, status: o.status, notes: o.notes });
    }

    // FINALIZAR RUTA (DRIVER)
    if(method==='POST' && url.pathname==='/api/routes/current/finalize') { 
      if(!auth(req,res,['driver'])) return; 
      const pendingCheck = await dbQuery('orders', 'status=eq.Pendiente');
      if(pendingCheck.length > 0) return json(res,422,{error:'Existen pedidos pendientes'});
      
      const routes = await dbQuery('routes', 'limit=1');
      const routeData = routes[0];
      const updatedRoute = await dbMutate('routes', 'PATCH', { finalized: true, finalized_at: new Date().toISOString() }, `id=eq.${routeData.id}`);
      return json(res,200, updatedRoute[0]);
    }

    // OPERACIONES ADMIN
    if(method==='GET' && url.pathname==='/api/admin/operations') { 
      if(!auth(req,res,['admin'])) return; 
      const routes = await dbQuery('routes', 'limit=1');
      const routeData = routes[0];
      const ordersRows = await dbQuery('orders', `route_id=eq.${routeData.id}`);
      
      const orders = ordersRows.map(o => ({
        id: o.order_code,
        customer: o.customer,
        address: o.address,
        status: o.status,
        notes: o.notes
      }));

      return json(res,200, {
        routes: [{
          id: routeData.route_code,
          zone: routeData.zone,
          driver: routeData.driver_name,
          finalized: routeData.finalized,
          orders
        }]
      });
    }

    if(method==='GET') {
      return serveFile(res, url.pathname);
    }
    
    json(res,404,{error:'No encontrado'});
  } catch (error) { 
    console.error(error);
    json(res,400,{error:'Solicitud inválida o error en base de datos'}); 
  }
});

// Si estamos en local, levantamos el servidor tradicional
if (!process.env.VERCEL) {
  server.listen(PORT, () => console.log(`RutaLog con Supabase disponible en http://localhost:${PORT}`));
}

// Adaptador limpio para Vercel
module.exports = (req, res) => {
  server.emit('request', req, res);
};
