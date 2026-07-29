# RutaLog

Prototipo funcional de una aplicación logística móvil con una sola API y dos perfiles obtenidos desde el JWT.

## Ejecutar

Requiere Node.js 18 o superior. Desde esta carpeta:

```powershell
node server.js
```

Abrir `http://localhost:3000`.

Credenciales de demo:

- Chofer: `chofer@rutalog.ar` / `123456`
- Administración: `admin@rutalog.ar` / `123456`

## Flujo implementado

- El inicio de sesión retorna un JWT firmado con el rol (`driver` o `admin`).
- El chofer consulta su ruta R-284, registra entregas completas o parciales y añade observaciones.
- La finalización sólo se habilita cuando no quedan pedidos pendientes.
- Administración consume el mismo backend y puede consultar el resultado de cada pedido.

## Endpoints

| Método | Ruta | Rol |
| --- | --- | --- |
| POST | `/api/auth/login` | Público |
| GET | `/api/routes/current` | `driver` |
| PUT | `/api/orders/:id` | `driver` |
| POST | `/api/routes/current/finalize` | `driver` |
| GET | `/api/admin/operations` | `admin` |

Para producción, definir `JWT_SECRET`, sustituir el almacenamiento en memoria por una base de datos y mover las credenciales a un proveedor de identidad.
