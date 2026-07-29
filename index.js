// Vercel solo despliega como función serverless lo que está dentro de /api.
// Reexportamos el handler que ya exporta server.js, sin duplicar lógica.
module.exports = require('../server.js');
