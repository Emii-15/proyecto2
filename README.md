# RutaLog

Aplicación logística con frontend estático en Vercel, API serverless en Vercel y datos en Supabase.

## Configuración

1. En Supabase, abre **SQL Editor** y ejecuta [`supabase/schema.sql`](supabase/schema.sql).
2. Copia `.env.example` como `.env` y completa los valores desde **Project Settings > API** de Supabase.
3. En Vercel, importa el repositorio y crea esas mismas variables en los entornos **Production**, **Preview** y **Development**:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `JWT_SECRET`
4. Despliega sin definir *Build Command* ni *Output Directory*. Vercel detecta automáticamente los estáticos y `api/[...path].js`.

La clave `SUPABASE_SERVICE_ROLE_KEY` solo se utiliza en la función serverless; no debe estar en el navegador, el repositorio ni un archivo versionado. Si alguna clave fue expuesta, regenerala en Supabase antes de desplegar.

## Desarrollo local

Requiere Node.js 20 o superior.

```powershell
Copy-Item .env.example .env
# Completar .env y luego:
node --env-file=.env server.js
```

Abrir `http://localhost:3000`. Para revisar la sintaxis:

```powershell
npm run check
```

## Credenciales demo

- Chofer: `chofer@rutalog.ar` / `123456`
- Administración: `admin@rutalog.ar` / `123456`

Las credenciales de demostración se cargan mediante el esquema SQL. Antes de usar el sistema con usuarios reales, reemplazá el inicio de sesión demo por Supabase Auth y eliminá la columna de contraseñas de texto plano.

## Endpoints

| Método | Ruta | Rol |
| --- | --- | --- |
| POST | `/api/auth/login` | Público |
| GET | `/api/routes/current` | `driver` |
| PUT | `/api/orders/:id` | `driver` |
| POST | `/api/routes/current/finalize` | `driver` |
| GET | `/api/admin/operations` | `admin` |
