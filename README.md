# Relevo

Relevo reúne los proyectos, objetivos y entregas de un equipo de software. La laptop sirve el frontend de React, TypeScript y Tailwind desde el mismo proceso de Go que atiende la API. SQLite guarda los datos en `datos/`, dentro de TRACKER.

## Abrir la aplicación

Desde la laptop, abre [Relevo local](http://127.0.0.1:8741). Tus compañeros entran por el enlace HTTPS del túnel. Cualquier persona con ese enlace puede registrarse y, tras iniciar sesión, ver los proyectos, integrantes y actividad del equipo. Comparte el enlace con las personas a las que quieras dar ese acceso.

Abre PowerShell en TRACKER. Este comando muestra el enlace público vigente.

```powershell
docker compose logs --no-color enlace | Select-String 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -Last 1
```

En cualquier sistema puedes leerlo con `docker compose logs enlace`. Un túnel rápido genera otra dirección cuando vuelve a iniciarse. Mantén la laptop encendida, conectada a Internet y con Docker activo mientras el equipo necesite acceso. [Documentación de los túneles rápidos](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

## Usar el tablero

1. **Registra a cada trabajador.** Cada persona abre el enlace desde su perfil del navegador, elige un nombre único y una contraseña de al menos 10 caracteres. En **Equipo** puede consultar su ID. El primer registro genera el ID a partir de un secreto aleatorio de ese perfil. Cada perfil se vincula a una cuenta. Para recuperar la misma cuenta en otro dispositivo, en una URL nueva o después de borrar las cookies, usa **Iniciar sesión** con el nombre o ID y la contraseña.
2. **Crea un proyecto.** Pulsa el **+** de la barra lateral. Introduce nombre, fecha de entrega, un repositorio HTTPS de GitHub o GitLab y al menos un objetivo. Para cada objetivo elige su nombre, responsables registrados y urgencia. GitLab admite subgrupos.
3. **Acuerda la asignación.** Cualquier integrante puede añadir un objetivo a un proyecto activo. Cada responsable ajeno recibe una solicitud en **Notificaciones** y puede aceptarla o rechazarla. Las asignaciones propias se aceptan al guardarlas. Si todos rechazan el objetivo, cualquier integrante puede reasignarlo.
4. **Confirma el trabajo.** En **Mis objetivos** o en el proyecto, marca la casilla de una asignación aceptada e introduce tu propia contraseña. El servidor verifica tu identidad y tu asignación. En un objetivo compartido, cada participante confirma su parte. Las solicitudes abiertas deben resolverse para cerrar el objetivo.
5. **Consulta las entregas.** **Historial → Trabajo confirmado** muestra cada confirmación con persona, proyecto y hora local. **Proyectos completados** reúne los proyectos que ya cerraron todos sus objetivos. El historial individual también incluye las confirmaciones de proyectos aún activos.

La barra lateral ordena los proyectos por fecha de creación, entrega u objetivos pendientes en ambos sentidos. Los filtros de responsables y urgencias admiten selección múltiple. La actividad de asignación, aceptación, rechazo y confirmación llega a todo el equipo dentro de la app. La pestaña visible consulta los cambios cada 12 segundos y al recuperar el foco. **Apariencia** guarda por cuenta los temas Papel, Grafito y Océano.

## Encender o trasladar el servidor

En Windows usa Docker Desktop en modo de contenedores Linux. En Linux usa Docker Engine con Compose. En la laptop de destino, abre una terminal en la carpeta TRACKER. Con estos comandos puedes construir la imagen, iniciar el servidor y consultar el enlace temporal.

```sh
docker compose --profile publico up -d --build
docker compose ps
docker compose logs enlace
```

El archivo `relevo-linux-amd64.tar` contiene la imagen de la aplicación compilada para procesadores Intel o AMD de 64 bits. Los siguientes comandos cargan la imagen en la laptop y evitan compilarla allí.

```sh
docker image load -i relevo-linux-amd64.tar
docker compose --profile publico up -d --no-build
```

Si la laptop usa ARM de 64 bits, construye desde el código con el primer comando. Compose descargará el conector oficial de Cloudflare para la arquitectura del equipo. Para uso exclusivamente local, inicia solo la aplicación con `docker compose up -d app`. El puerto local predeterminado es 8741 y se cambia con `APP_PORT` en un archivo `.env`. Docker inicia los contenedores de nuevo al arrancar su motor si estaban en ejecución. [Referencia de Docker Compose](https://docs.docker.com/reference/compose-file/services/)

En Linux, asegúrate de que la cuenta que ejecuta la aplicación pueda escribir en `datos/`. El valor predeterminado es UID y GID 1000. Si el propietario tiene otros identificadores, crea `datos` con ese usuario y configura `RELEVO_UID` y `RELEVO_GID` en `.env` con los resultados de `id -u` e `id -g`.

## Configurar una dirección permanente

El perfil `estable` permite mantener el mismo enlace cuando se reinicia la laptop. Necesitas una cuenta de Cloudflare y un dominio que administres allí. El perfil `publico` está pensado para pruebas. [Configurar un túnel de Cloudflare](https://developers.cloudflare.com/tunnel/get-started/)

1. Crea un túnel administrado desde el panel de Cloudflare. Copia únicamente su token en un archivo privado llamado `tunnel-token.txt` en TRACKER. También puedes indicar otra ruta con `RELEVO_TOKEN_FILE` en `.env`. El proyecto excluye el token de Git y del contexto de construcción. [Token desde archivo](https://developers.cloudflare.com/tunnel/reference/run-parameters/#token-file)
2. En TRACKER ejecuta `docker compose --profile estable up -d dominio`. En la configuración del túnel, asocia tu subdominio con el servicio HTTP `http://app:8080`.
3. Abre tu subdominio HTTPS y comprueba el acceso. Después puedes retirar el enlace temporal con `docker compose --profile publico stop enlace`.

## Respaldo y traslado de datos

Detén las escrituras con `docker compose stop app` antes de copiar. Conserva la carpeta completa `datos/`, incluidos los archivos auxiliares de SQLite si aparecen. Para trasladar el servidor, copia TRACKER junto con ese respaldo a la laptop de destino. Reinicia con `docker compose start app` en el equipo que deba servir los datos. Si el enlace cambia, los trabajadores recuperan sus cuentas con **Iniciar sesión**.

## Código y pruebas

- `server/` contiene la API Go, el esquema SQLite y las pruebas de integración.
- `web/src/` contiene los componentes React, la navegación y los estilos editables. Los colores de los temas están en `style.css`.
- `compose.yaml` configura el servidor, el almacenamiento y los túneles.
- `Dockerfile` compila el cliente, ejecuta las pruebas de Go y crea la imagen final.

También puedes repetir las pruebas directamente en Docker.

```sh
docker build --target go-build --progress plain .
docker compose build app
```

Las pruebas crean una base temporal y tres identidades. Verifican consentimiento, contraseña, trabajo compartido, reintentos, reasignaciones, fechas de confirmación, preferencias por persona y persistencia del archivo de proyectos.

