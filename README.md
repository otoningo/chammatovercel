# Nodo (Vercel + Supabase)

Misma app de mensajería privada 1 a 1, adaptada para correr sin servidor
propio: el frontend y las funciones serverless viven en **Vercel** (gratis,
HTTPS y dominio incluidos), y los datos en **Supabase** (Postgres gratis).

## Qué cambió respecto a la versión de servidor propio

| | Versión VM (Oracle/Google Cloud) | Versión Vercel |
|---|---|---|
| Mensajes en tiempo real | WebSocket, instantáneo | Sondeo autenticado cada 2.5s |
| Expulsión por sesión duplicada | Instantánea (el servidor cierra el socket) | En el siguiente sondeo, hasta 2.5s |
| Almacenamiento | Archivos JSON en el servidor | Tablas en Supabase (Postgres) |
| Dominio / HTTPS | Hay que configurarlo tú (DuckDNS + Caddy) | Lo da Vercel automático |
| Servidor que administrar | Sí, una VM | Ninguno |

La sesión única, el cierre automático al salir, y las notificaciones push
genéricas funcionan igual de estrictos que en la versión de servidor
propio — solo cambia el mecanismo por debajo.

## 1. Crear el proyecto en Supabase

1. Entra a [supabase.com](https://supabase.com), crea una cuenta y un
   proyecto nuevo (plan gratis).
2. Ve a **SQL Editor > New query**, pega el contenido de `sql/schema.sql`
   de este proyecto, y dale a **Run**. Eso crea las 4 tablas que necesita
   la app.
3. Ve a **Project Settings > API** y copia dos valores:
   - **Project URL** → esto es `SUPABASE_URL`
   - **service_role key** (no la "anon public") → esto es
     `SUPABASE_SERVICE_ROLE_KEY`. **Es secreta**: nunca la pongas en código
     que corra en el navegador, solo como variable de entorno en Vercel.

## 2. Generar las claves de notificaciones push

En tu computadora, dentro de la carpeta de este proyecto:

```bash
npm install
npm run vapid
```

Te va a imprimir `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY`. Guárdalas, las
necesitas en el siguiente paso.

## 3. Configurar las variables de entorno en Vercel

En tu proyecto de Vercel (el que ya creaste, `chammato`): **Settings >
Environment Variables**, y agrega estas 5:

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:tu-correo@ejemplo.com
```

## 4. Reemplazar el código del proyecto

Borra lo que subiste antes y sube el contenido de esta carpeta en su
lugar (todo lo que está en la raíz: `index.html`, `app.js`, `styles.css`,
`sw.js`, `manifest.json`, `icons/`, `api/`, `lib/`, `package.json`).

Si conectaste el proyecto a un repositorio de GitHub, simplemente
reemplaza los archivos en el repo y haz push — Vercel vuelve a desplegar
solo. Si lo subiste directo (CLI o arrastrando la carpeta), vuelve a
desplegar de la misma forma con esta carpeta nueva.

## 5. Crear las 2 cuentas

Esto se hace desde tu computadora, no desde Vercel — no hay registro
público a propósito. En la carpeta del proyecto, crea un archivo `.env`
(usa `.env.example` de plantilla) con las mismas `SUPABASE_URL` y
`SUPABASE_SERVICE_ROLE_KEY` que pusiste en Vercel, y corre:

```bash
npm run seed
```

Sigue las instrucciones (usuario + contraseña). Ejecútalo **dos veces**,
una por cada persona.

## 6. Probar

Entra a `https://chammato.vercel.app` desde dos dispositivos o navegadores
distintos:

- Inicia sesión con la primera cuenta en uno.
- Inicia sesión con la segunda cuenta en el otro.
- Escribe algo — en unos 2-3 segundos debería aparecer del otro lado.
- Inicia sesión con la misma cuenta en un tercer lugar y confirma que el
  primero se cierra solo con el aviso.
- Cierra la pestaña y vuelve a entrar: debería pedir contraseña de nuevo.

## Cosas a tener en cuenta con esta versión

- **El "tiempo real" no es instantáneo**: hay hasta ~2.5 segundos de
  espera entre que alguien escribe y el otro lo ve (por el sondeo). Para
  un chat de 2 personas normalmente no se nota, pero no es tan inmediato
  como la versión con WebSocket.
- **Plan gratis de Supabase**: incluye una base de datos que se pausa
  automáticamente tras 7 días sin actividad (se reactiva sola en la
  siguiente petición, tarda unos segundos en "despertar"). Para 2 personas
  usándolo normalmente no debería pasar, pero si un día tarda un poco en
  responder la primera vez, es por eso.
- **Nunca expongas la `SUPABASE_SERVICE_ROLE_KEY`** fuera de las variables
  de entorno de Vercel — con esa clave se puede leer y escribir cualquier
  tabla sin restricción.
