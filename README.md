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

## Estructura del sitio

El dominio tiene dos partes separadas:

- **`/`** — una página de inicio neutral, sin login ni formularios (solo
  contenido estático). El código está en `index.html` (raíz del proyecto).
  Cámbiala por lo que quieras mostrar ahí — es HTML/CSS plano, sin lógica.
- **`/conocenos`** — la aplicación de mensajería real (login de verdad, sin
  atajos ni señuelos). Todo su código vive en la carpeta `conocenos/`.

Ambas comparten el mismo backend en `/api/*` — las funciones no cambiaron
de lugar ni de comportamiento, solo cambió dónde vive el frontend que las
llama.

Si vienes de una versión anterior donde `index.html`, `app.js`, `styles.css`,
etc. estaban sueltos en la raíz del proyecto: ahora esos mismos archivos
viven dentro de `chat/`, y hay una `index.html` nueva en la raíz que antes
no existía (la página de inicio). Sube el proyecto completo, no solo los
archivos sueltos, para que la estructura de carpetas quede bien en Vercel.

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

## 7. Actualización: presencia, escribiendo, entregado/leído, edición

Si ya tenías el proyecto desplegado desde antes, hay un paso extra antes de
subir este código nuevo:

1. En Supabase, **SQL Editor > New query**, pega el contenido de
   `sql/migration_2_presence.sql` y dale **Run**. Agrega las columnas que
   faltan sin tocar tus datos existentes.
2. Sube el código de esta carpeta (reemplaza todos los archivos) y
   redespliega en Vercel como siempre.

Lo que se agregó:

- **Doble check**: un check gris cuando se envió, doble check gris cuando
  el otro dispositivo lo recibió (hizo polling), doble check en color de
  acento cuando la otra persona lo tuvo en pantalla con la pestaña
  enfocada.
- **En línea / última vez**: en la barra de arriba, junto al nombre del
  otro usuario. "En línea" se calcula porque su app hizo un sondeo hace
  menos de 8 segundos; si no, muestra la hora (o fecha) de la última vez
  que sí lo hizo.
- **Escribiendo…**: aparece debajo del chat cuando el otro usuario ha
  tecleado en los últimos segundos.
- **Editar mensajes**: click sobre uno de tus propios mensajes para
  editarlo. Solo puedes editar los tuyos — el servidor lo verifica, no es
  solo cosmético. Queda marcado como "editado".
- **Manejo de fallas más robusto**: si el sondeo falla varias veces
  seguidas (por ejemplo si Supabase está caído un momento, o hay un
  problema de red), ahora aparece un aviso visible de "no se pudo
  conectar, reintentando…" en vez de quedarse congelado en silencio como
  antes — que es lo que probablemente pasó cuando dejaron de verse
  mensajes nuevos.

### Sobre el bug de "los mensajes dejaron de aparecer"

No tengo forma de ver tu proyecto en vivo para confirmar la causa exacta,
pero las dos explicaciones más probables son:

1. **Un fallo de red o de Supabase se quedaba silencioso.** El código
   anterior, si el `fetch` fallaba, simplemente no actualizaba nada y no
   avisaba — parecía que la app estaba "colgada" aunque en realidad seguía
   viva. Ya quedó resuelto con el aviso visible y los reintentos con
   espera creciente.
2. **El proyecto de Supabase se pausó por inactividad.** El plan gratis
   pausa la base de datos tras 7 días sin ninguna petición — si pasó un
   tiempo sin usar el chat, se pausa sola y tarda unos segundos en
   reactivarse con la siguiente petición. Con uso normal casi nunca
   debería pasar.

Si vuelve a pasar con esta versión, ahora vas a ver el aviso en pantalla en
vez de silencio total — eso ya es información útil para diagnosticarlo.

## 8. Lo que NO se hizo en esta ronda

De la lista que pediste, esto quedó fuera a propósito porque cada uno es un
proyecto grande por separado:

- **Notas de voz, imágenes y archivos.** Requiere subir/guardar archivos
  binarios (Supabase Storage sirve para esto, es gratis hasta cierto
  límite) y rehacer la burbuja de mensaje para mostrar audio/imagen en vez
  de solo texto.
- **Llamadas.** Esto es un cambio de arquitectura fuerte — necesita
  WebRTC más un servidor de señalización, algo que Vercel serverless no
  soporta de forma nativa (haría falta un servicio de terceros tipo
  Daily.co o LiveKit, con su propio plan gratis limitado).
- **Cifrado extremo a extremo.** Descartado por decisión tuya — con HTTPS
  el tráfico ya va cifrado en tránsito, que es la protección real que
  importa aquí.

Si quieres seguir con alguno de estos, dímelo y lo armamos como el
siguiente paso.

## 9. Actualización: imágenes, archivos, notas de voz y llamadas

Si ya tenías el proyecto desplegado, hace falta un poco de configuración
nueva antes de subir este código:

### 9.1. Migración de base de datos

En Supabase → SQL Editor → pega el contenido de
`sql/migration_3_attachments_calls.sql` → **Run**. Esto:
- Agrega la columna de adjuntos a `messages`.
- Crea el bucket de Storage `attachments` (privado).
- Crea la tabla `call_signals` para la señalización de llamadas.

Si por alguna razón el bucket no aparece en **Storage** después de correr
la migración (a veces Supabase prefiere que se cree desde el dashboard),
créalo a mano: **Storage → New bucket**, nómbralo `attachments`, y déjalo
**sin marcar** "Public bucket".

### 9.2. Una variable de entorno nueva

Necesitas agregar `SUPABASE_PUBLISHABLE_KEY` (la clave "publishable" que
viste en Settings → API — la del apartado de arriba, no la secreta) tanto
en Vercel como en tu `.env` local. Es segura de exponer al navegador: el
cliente la usa solo para subir archivos, y cada subida además requiere un
token firmado de un solo uso que genera nuestro backend ya autenticado —
sin ese token, esta clave no permite subir ni leer nada.

### 9.3. Subir el código y redesplegar

Reemplaza todos los archivos con los de esta carpeta y vuelve a desplegar
en Vercel, como las veces anteriores.

### Qué se agregó

- **Imágenes y archivos**: botón 📎 en el chat. Sube directo del navegador
  a Supabase Storage (no pasa por el límite de tamaño de las funciones de
  Vercel), y el chat muestra miniatura para imágenes o una tarjeta de
  descarga para el resto.
- **Notas de voz**: botón 🎙️, graba con el micrófono del navegador
  (`MediaRecorder`), se sube igual que un archivo y se reproduce inline
  con controles de audio.
- **Llamadas de audio/video**: botón 📞. Usa WebRTC de verdad (la llamada
  en sí va directo entre los dos dispositivos, no pasa por el servidor),
  con la negociación inicial (quién llama a quién, intercambio de
  direcciones de red) viajando por sondeo sobre la misma base de datos —
  no hace falta un servidor de señalización aparte.

### Limitaciones de las llamadas a tener en cuenta

- **Solo usa STUN público** (el de Google), no hay servidor **TURN**. Eso
  significa que si alguno de los dos está detrás de una red muy
  restrictiva (redes corporativas, ciertos tipos de NAT), es posible que
  la llamada no logre conectar directamente. Para la mayoría de redes
  domésticas y de datos móviles debería funcionar bien. Si te pasa,
  avísame y agregamos un TURN gratuito de terceros como siguiente paso.
- **La negociación viaja por sondeo** (cada ~2 segundos), así que
  establecer la llamada puede tardar unos segundos más que en apps
  comerciales — una vez conectada, el audio/video ya no depende de eso.
- Sin pruebas automatizadas de extremo a extremo para esta parte (WebRTC y
  grabación de audio necesitan un navegador real, no se pueden simular
  desde este entorno) — sí quedaron probadas con una batería de pruebas la
  lógica del servidor (subida de adjuntos, permisos, señalización). Te
  recomiendo probar primero con algo simple —mandar una foto, y una
  llamada corta entre dos dispositivos reales— antes de darlo por
  completamente estable.


