# 📱 WhatsApp Terminal CLI

Terminal optimizado para WhatsApp Web con interfaz de línea de comandos, diseñado para uso eficiente en servidores y entornos sin interfaz gráfica.

## ✨ Características

- 🚀 **Interfaz CLI completa**: Navegación intuitiva desde la terminal
- 🔍 **Búsqueda de chats**: Busca chats por nombre o número de teléfono
- 🔔 **Notificaciones en tiempo real**: Recibe notificaciones de mensajes nuevos mientras estás en el menú
- 📊 **Contadores de mensajes no leídos**: Visualiza cuántos mensajes sin leer tiene cada chat
- 🎨 **Formato de mensajes estilo WhatsApp**: Fechas y horas formateadas inteligentemente (hoy, ayer, esta semana, etc.)
- 💾 **Gestión optimizada de memoria**: Cache inteligente que solo carga los últimos 20 chats
- 🔕 **Modo "No Molestar"**: Activa/desactiva las notificaciones de mensajes nuevos
- 📅 **Zona horaria de Perú**: Todas las fechas y horas se muestran en hora de Perú (America/Lima)
- 🎯 **Comandos rápidos**: Atajos para navegar y gestionar chats fácilmente
- 🔒 **Autenticación persistente**: La sesión se guarda automáticamente, no necesitas escanear el QR cada vez

## 📋 Requisitos

- **Node.js**: Versión 24.0.0 o superior
- **npm**: Gestor de paquetes de Node.js
- **Sistema operativo**: Linux, macOS o Windows (con WSL recomendado para Windows)

## 🚀 Instalación

### 1. Clonar o descargar el repositorio

```bash
git clone <url-del-repositorio>
cd Wasat-terminal
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Ejecutar la aplicación

```bash
npm start
```

### 4. Primera configuración

La primera vez que ejecutes la aplicación:

1. Se mostrará un código QR en la terminal
2. Abre WhatsApp en tu teléfono
3. Ve a **Configuración > Dispositivos vinculados > Vincular un dispositivo**
4. Escanea el código QR que aparece en la terminal
5. ¡Listo! La sesión se guardará automáticamente

**Nota**: En ejecuciones posteriores, la sesión se restaurará automáticamente y no necesitarás escanear el QR nuevamente.

## 📖 Uso

### Menú Principal

Al iniciar la aplicación, verás un menú con las siguientes opciones:

```
Elige una opción:
1. Listar los últimos 20 chats
2. Seleccionar un chat para chatear
3. Buscar chat
4. No Molestar (Activo/Inactivo)
5. Salir
```

#### Opción 1: Listar chats
Muestra los últimos 20 chats ordenados por fecha de último mensaje, con indicadores de mensajes no leídos.

#### Opción 2: Seleccionar chat
Ingresa el número del chat (0-19) para abrirlo y comenzar a chatear.

#### Opción 3: Buscar chat
Busca chats por nombre o número de teléfono. Los resultados se muestran numerados para selección rápida.

#### Opción 4: No Molestar
Activa o desactiva las notificaciones de mensajes nuevos mientras estás en el menú principal.

#### Opción 5: Salir
Cierra la aplicación de forma segura.

### Dentro de un Chat

Una vez dentro de un chat, puedes:

- **Enviar mensajes**: Escribe tu mensaje y presiona Enter
- **Ver historial**: Se muestran automáticamente los últimos 10 mensajes
- **Recibir mensajes en tiempo real**: Los mensajes nuevos aparecen automáticamente

### Comandos Disponibles

Dentro de un chat, puedes usar los siguientes comandos (precedidos por `/`):

| Comando | Descripción | Ejemplo |
|---------|-------------|---------|
| `/ayuda` o `/help` | Muestra la ayuda de comandos | `/ayuda` |
| `/historial N` o `/hist N` | Ver últimos N mensajes (1-100) | `/historial 50` |
| `/limpiar` o `/clear` | Limpia la pantalla | `/limpiar` |
| `/info` | Muestra información del contacto | `/info` |
| `/mas` | Carga 20 mensajes más del historial | `/mas` |
| `/salir`, `/exit` o `/menu` | Volver al menú principal | `/salir` |

### Atajos Rápidos

También puedes usar estos atajos sin el prefijo `/`:

- `<`, `salir`, `..` → Volver al menú principal
- `mas` → Cargar 20 mensajes más

## 🔧 Configuración Avanzada

### Gestión de Sesión

La sesión de WhatsApp se guarda automáticamente en el directorio `.wwebjs_auth/`. 

**Para cerrar sesión y eliminar la autenticación guardada:**

```bash
rm -rf .wwebjs_auth/session-client1
```

La próxima vez que ejecutes la aplicación, necesitarás escanear el QR nuevamente.

### Optimizaciones de Memoria

La aplicación está optimizada para usar poca memoria:

- Solo carga los últimos 20 chats en memoria
- Cache inteligente de mensajes
- Limpieza automática de recursos no utilizados
- Límite de historial configurable (por defecto: 10 mensajes)

### Variables de Entorno (Opcional)

Si necesitas configurar variables de entorno, puedes crear un archivo `.env`:

```env
# Ejemplo de variables de entorno (si se implementan en el futuro)
NODE_ENV=production
```

## 📝 Notas Importantes

### Seguridad

- ⚠️ **No compartas tu sesión**: El directorio `.wwebjs_auth/` contiene información sensible de autenticación
- 🔒 **Protege tu servidor**: Si ejecutas esto en un servidor, asegúrate de tener permisos adecuados
- 📁 **Backup**: Si haces backup, excluye el directorio `.wwebjs_auth/` o protégelo adecuadamente

### Limitaciones

- Los mensajes multimedia (imágenes, videos, audios) se muestran como indicadores, no se descargan
- El historial está limitado a 100 mensajes por comando
- Solo se muestran los últimos 20 chats en el menú principal

### Zona Horaria

Todas las fechas y horas se muestran en **hora de Perú (America/Lima)** con formato de 24 horas.

### Formato de Mensajes

Los mensajes se muestran con el siguiente formato:

```
[HH:MM] Remitente: Contenido del mensaje
```

- Mensajes propios aparecen en **azul**
- Mensajes recibidos aparecen en **blanco**
- La hora aparece en **gris**

## 🐛 Solución de Problemas

### El QR no aparece

- Asegúrate de tener una conexión a internet estable
- Verifica que no haya un firewall bloqueando las conexiones
- Intenta eliminar el directorio `.wwebjs_auth/` y volver a iniciar

### Error de autenticación

```bash
# Elimina la sesión guardada y vuelve a escanear el QR
rm -rf .wwebjs_auth/session-client1
npm start
```

### La aplicación se cuelga

Presiona `Ctrl+C` para salir de forma segura. La aplicación maneja las señales de interrupción correctamente.

### Mensajes no aparecen

- Verifica que el modo "No Molestar" no esté activado
- Asegúrate de estar dentro del chat correcto
- Revisa tu conexión a internet

## 📦 Dependencias

- **whatsapp-web.js**: Cliente de WhatsApp Web para Node.js
- **qrcode-terminal**: Generación de códigos QR en terminal
- **chalk**: Colores para la terminal
- **puppeteer**: Automatización del navegador (requerido por whatsapp-web.js)

## 🔄 Actualizaciones

Para actualizar las dependencias:

```bash
npm update
```

## 📄 Licencia

ISC

## 👥 Contribuciones

Las contribuciones son bienvenidas. Por favor:

1. Haz un fork del proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## ⚠️ Disclaimer

Este proyecto no está afiliado, respaldado ni patrocinado por WhatsApp Inc. WhatsApp es una marca registrada de WhatsApp Inc. Este proyecto utiliza la API no oficial de WhatsApp Web y puede estar sujeto a cambios o restricciones por parte de WhatsApp.

## 📞 Soporte

Si encuentras algún problema o tienes sugerencias, por favor abre un issue en el repositorio.

---

**Versión**: 2.0.0  
**Última actualización**: 2025
