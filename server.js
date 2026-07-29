const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'cambiar-esta-clave-en-produccion';
const users = {
  'chofer@rutalog.ar': { password: '123456', name: 'Martín Pérez', role: 'driver' },
  'admin@rutalog.ar': { password: '123456', name: 'Lucía Gómez', role: 'admin' }
};
let route = {
  id: 'R-284', zone: 'Zona Centro', driver: 'Martín Pérez', finalized: false,
  orders: [
    { id:'PED-1042', customer:'Almacén San Martín', address:'Av. San Martín 1280', items:[['Bebida isotónica 500ml',12],['Agua mineral 1.5L',8]], status:'Pendiente' },
    { id:'PED-1043', customer:'Kiosco La Esquina', address:'Belgrano 842', items:[['Gaseosa cola 2.25L',6],['Jugo naranja 1L',10]], status:'Pendiente' },
    { id:'PED-1044', customer:'Mercado Central', address:'Rivadavia 220', items:[['Agua mineral 500ml',24],['Energizante 473ml',12]], status:'Pendiente' },
    { id:'PED-1045', customer:'Autoservicio Norte', address:'Mitre 1564', items:[['Gaseosa lima-limón 2.25L',6],['Tónica 1.5L',8]], status:'Pendiente' }
  ]
};
const b64url = value => Buffer.from(value).toString('base64url');
function token(payload) { const head=b64url(JSON.stringify({alg:'HS256',typ:'JWT'})); const body=b64url(JSON.stringify(payload)); const sig=crypto.createHmac('sha256',SECRET).update(`${head}.${body}`).digest('base64url'); return `${head}.${body}.${sig}`; }
function verify(value) { try { const [h,p,s]=value.split('.'); const expected=crypto.createHmac('sha256',SECRET).update(`${h}.${p}`).digest('base64url'); if(!crypto.timingSafeEqual(Buffer.from(s),Buffer.from(expected))) return null; const data=JSON.parse(Buffer.from(p,'base64url').toString()); return data.exp>Date.now()/1000?data:null; } catch { return null; } }
function json(res,status,data) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(data)); }
function body(req) { return new Promise((resolve,reject)=>{ let raw=''; req.on('data',chunk=>raw+=chunk); req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{});}catch(e){reject(e);}}); }); }
function auth(req, res, roles) { const value=(req.headers.authorization||'').replace('Bearer ',''); const user=verify(value); if(!user || (roles && !roles.includes(user.role))) { json(res,403,{error:'No autorizado'}); return null; } return user; }
function serveFile(res, file) { const safe=path.basename(file || 'index.html'); const target=path.join(__dirname, safe); const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}; fs.readFile(target,(err,data)=>{ if(err) return json(res,404,{error:'No encontrado'}); res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream'}); res.end(data); }); }

http.createServer(async (req,res)=>{
  try {
    const url=new URL(req.url,`http://${req.headers.host}`); const method=req.method;
    if(method==='POST' && url.pathname==='/api/auth/login') { const {email,password}=await body(req); const user=users[email?.toLowerCase()]; if(!user || user.password!==password) return json(res,401,{error:'Credenciales inválidas'}); return json(res,200,{token:token({sub:email,role:user.role,exp:Math.floor(Date.now()/1000)+28800}),user:{name:user.name,role:user.role}}); }
    if(method==='GET' && url.pathname==='/api/routes/current') { if(!auth(req,res,['driver'])) return; return json(res,200,route); }
    if(method==='PUT' && url.pathname.startsWith('/api/orders/')) { if(!auth(req,res,['driver'])) return; const order=route.orders.find(o=>o.id===url.pathname.split('/').pop()); const {status,notes=''}=await body(req); if(!order) return json(res,404,{error:'Pedido inexistente'}); if(!['Completa','Parcial'].includes(status)) return json(res,422,{error:'Estado inválido'}); order.status=status; order.notes=notes; order.updatedAt=new Date().toISOString(); return json(res,200,order); }
    if(method==='POST' && url.pathname==='/api/routes/current/finalize') { if(!auth(req,res,['driver'])) return; if(route.orders.some(o=>o.status==='Pendiente')) return json(res,422,{error:'Existen pedidos pendientes'}); route.finalized=true; route.finalizedAt=new Date().toISOString(); return json(res,200,route); }
    if(method==='GET' && url.pathname==='/api/admin/operations') { if(!auth(req,res,['admin'])) return; return json(res,200,{routes:[route]}); }
    if(method==='GET') return serveFile(res,url.pathname==='/'?'index.html':url.pathname.slice(1));
    json(res,404,{error:'No encontrado'});
  } catch (error) { json(res,400,{error:'Solicitud inválida'}); }
}).listen(PORT,()=>console.log(`RutaLog disponible en http://localhost:${PORT}`));
