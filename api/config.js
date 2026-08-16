// Esta clave y URL son seguras de exponer al navegador: la clave
// "publishable"/"anon" de Supabase no da acceso a nada por sí sola en este
// proyecto (RLS bloquea todas las tablas), y para Storage cada subida
// requiere además un token firmado de un solo uso que genera nuestro
// backend ya autenticado — sin ese token, esta clave no permite subir ni
// leer nada del bucket.
module.exports = (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_PUBLISHABLE_KEY || null,
    bucket: 'attachments',
  });
};
