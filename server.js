require('dotenv').config();

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'cambiar-esta-clave-en-produccion';

const pool = new Pool({
  connectionString: 'postgresql://postgres.vassruceqqjyejbiomza:Ubel152018Frieren123@aws-0-us-east-2.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

const b64url = value => Buffer.from(value).toString('base64url');
function token(payload) { const head=b64url(JSON.stringify({alg:'HS256',typ:'JWT'})); const body=b64url(JSON.stringify(payload)); const sig=crypto.createHmac('sha256',SECRET).update(`${head}.${body}`).digest('base64url'); return `${head}.${body}.${sig}`; }
function verify(value) { try { const [h,p,s]=value.split('.'); const expected=crypto.createHmac('sha256',SECRET).update(`${h}.${p}`).digest('base64url'); if(!crypto.timingSafeEqual(Buffer.from(s),Buffer.from(expected))) return null; const data=JSON.parse(Buffer.from(p,'base64url').toString()); return data.exp>Date.now()/1000?data:null; } catch { return null; } }
function json(res,status,data) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(data)); }
function body(req) { return new Promise((resolve,reject)=>{ let raw=''; req.on('data',chunk=>raw+=chunk); req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{});}catch(e){reject(e);}}); }); }
function auth(req, res, roles) { const value=(req.headers.authorization||'').replace('Bearer ',''); const user=verify(value); if(!user || (roles && !roles.includes(user.role))) { json(res,403,{error:'No autorizado'}); return null; } return user; }
function serveFile(res, file) { const safe=path.basename(file || 'index.html'); const target=path.join(__dirname, safe); const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}; fs.readFile(target,(err,data)=>{ if(err) return json(res,404,{error:'No encontrado'}); res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream'}); res.end(data); }); }

const server = http.createServer(async (req,res)=>{
  try {
    const url=new URL(req.url,`http://${req.headers.host}`); const method=req.method;

    // LOGIN
    if(method==='POST' && url.pathname==='/api/auth/login') { 
      const {email,password}=await body(req); 
      const client = await pool.connect();
      try {
        const result = await client.query('SELECT * FROM users WHERE email = $1', [email?.toLowerCase()]);
        const user = result.rows[0];
        if(!user || user.password !== password) return json(res,401,{error:'Credenciales inválidas'}); 
        return json(res,200,{token:token({sub:email,role:user.role,exp:Math.floor(Date.now()/1000)+28800}),user:{name:user.name,role:user.role}});
      } finally {
        client.release();
      }
    }

    // RUTA ACTUAL (DRIVER)
    if(method==='GET' && url.pathname==='/api/routes/current') { 
      if(!auth(req,res,['driver'])) return; 
      const client = await pool.connect();
      try {
        const routeRes = await client.query('SELECT * FROM routes LIMIT 1');
        const routeData = routeRes.rows[0];
        const ordersRes = await client.query('SELECT order_code as id, customer, address, status, notes FROM orders WHERE route_id = $1', [routeData.id]);
        
        const orders = ordersRes.rows.map(o => ({
          ...o,
          items: [['Bebida isotónica 500ml', 12], ['Agua mineral 1.5L', 8]]
        }));

        return json(res,200, {
          id: routeData.route_code,
          zone: routeData.zone,
          driver: routeData.driver_name,
          finalized: routeData.finalized,
          orders
        });
      } finally {
        client.release();
      }
    }

    // ACTUALIZAR PEDIDO (DRIVER)
    if(method==='PUT' && url.pathname.startsWith('/api/orders/')) { 
      if(!auth(req,res,['driver'])) return; 
      const orderCode = url.pathname.split('/').pop();
      const {status,notes=''}=await body(req); 
      if(!['Completa','Parcial'].includes(status)) return json(res,422,{error:'Estado inválido'});
      
      const client = await pool.connect();
      try {
        const updateRes = await client.query(
          'UPDATE orders SET status = $1, notes = $2, updated_at = NOW() WHERE order_code = $3 RETURNING order_code as id, customer, address, status, notes',
          [status, notes, orderCode]
        );
        if(updateRes.rows.length === 0) return json(res,404,{error:'Pedido inexistente'});
        return json(res,200, updateRes.rows[0]);
      } finally {
        client.release();
      }
    }

    // FINALIZAR RUTA (DRIVER)
    if(method==='POST' && url.pathname==='/api/routes/current/finalize') { 
      if(!auth(req,res,['driver'])) return; 
      const client = await pool.connect();
      try {
        const pendingCheck = await client.query("SELECT * FROM orders WHERE status = 'Pendiente'");
        if(pendingCheck.rows.length > 0) return json(res,422,{error:'Existen pedidos pendientes'});
        
        const updateRoute = await client.query('UPDATE routes SET finalized = true, finalized_at = NOW() RETURNING *');
        return json(res,200, updateRoute.rows[0]);
      } finally {
        client.release();
      }
    }

    // OPERACIONES ADMIN
    if(method==='GET' && url.pathname==='/api/admin/operations') { 
      if(!auth(req,res,['admin'])) return; 
      const client = await pool.connect();
      try {
        const routeRes = await client.query('SELECT * FROM routes LIMIT 1');
        const routeData = routeRes.rows[0];
        const ordersRes = await client.query('SELECT order_code as id, customer, address, status, notes FROM orders WHERE route_id = $1', [routeData.id]);
        
        return json(res,200, {
          routes: [{
            id: routeData.route_code,
            zone: routeData.zone,
            driver: routeData.driver_name,
            finalized: routeData.finalized,
            orders: ordersRes.rows
          }]
        });
      } finally {
        client.release();
      }
    }

    if(method==='GET') return serveFile(res,url.pathname==='/'?'index.html':url.pathname.slice(1));
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
