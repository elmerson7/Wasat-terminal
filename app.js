import whatsappWeb from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import readline from 'readline';
import chalk from 'chalk';

const { Client, LocalAuth } = whatsappWeb;

// Configuración del cliente con optimizaciones de memoria
const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'client1' }),
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--disable-extensions'
        ]
    }
});

// Interfaz de línea de comandos
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Estado de la aplicación - optimizado para memoria
const state = {
    // Solo almacenar IDs y datos mínimos de chats
    chatCache: new Map(), // Map<index, chatId>
    chatMetadata: new Map(), // Map<chatId, {name, timestamp}>
    currentChatId: null,
    doNotDisturb: true,
    messageHistoryLimit: 10,
    isInChatLoop: false,
    isInMenu: true  // Nuevo: rastrear si estamos en el menú
};

// Array para almacenar notificaciones recientes
const notifications = [];
const MAX_NOTIFICATIONS = 10;

/**
 * Obtiene el nombre del chat de forma eficiente
 */
function getChatName(chat) {
    return chat.name || chat.formattedTitle || chat.id.user || 'Sin nombre';
}

/**
 * Formatea la fecha completa (para estados de contacto) - Hora de Perú (24 horas)
 */
function formatDate(timestamp) {
    const date = new Date(timestamp * 1000);
    return `${date.toLocaleDateString('es-PE', { timeZone: 'America/Lima' })} ${date.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Lima' })}`;
}

/**
 * Formatea la hora de los mensajes con formato inteligente (estilo WhatsApp) - Hora de Perú
 */
function formatTime(timestamp) {
    const msgDate = new Date(timestamp * 1000);
    const now = new Date();
    
    // Obtener fechas en zona horaria de Perú
    const msgDatePeru = new Date(msgDate.toLocaleString('en-US', { timeZone: 'America/Lima' }));
    const nowPeru = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
    
    const today = new Date(nowPeru.getFullYear(), nowPeru.getMonth(), nowPeru.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const msgDay = new Date(msgDatePeru.getFullYear(), msgDatePeru.getMonth(), msgDatePeru.getDate());
    
    const timeStr = msgDate.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Lima' });
    
    // Si es hoy, solo mostrar hora
    if (msgDay.getTime() === today.getTime()) {
        return timeStr;
    }
    
    // Si es ayer
    if (msgDay.getTime() === yesterday.getTime()) {
        return `Ayer ${timeStr}`;
    }
    
    // Si es esta semana (últimos 7 días)
    const daysDiff = Math.floor((today - msgDay) / (1000 * 60 * 60 * 24));
    if (daysDiff <= 7) {
        const dayName = msgDate.toLocaleDateString('es-PE', { weekday: 'short', timeZone: 'America/Lima' });
        return `${dayName} ${timeStr}`;
    }
    
    // Si es del mismo año, mostrar día/mes
    if (msgDatePeru.getFullYear() === nowPeru.getFullYear()) {
        return `${msgDate.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', timeZone: 'America/Lima' })} ${timeStr}`;
    }
    
    // Si es de otro año, mostrar día/mes/año
    return `${msgDate.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Lima' })} ${timeStr}`;
}

/**
 * Formatea un mensaje con el estilo tipo WhatsApp
 */
function formatMessage(msg, chatName) {
    const time = formatTime(msg.timestamp);
    const from = msg.fromMe ? 'Yo' : chatName;
    let content = msg.body || '';

    if (msg.hasMedia) {
        content = getMediaDescription(msg);
    }

    // Aplicar colores: mensajes propios en azul, recibidos en blanco
    const senderColor = msg.fromMe ? chalk.blue : chalk.white;
    const timeColor = chalk.gray;
    
    console.log(`${timeColor(`[${time}]`)} ${senderColor(from)}: ${content}`);
}

/**
 * Obtiene descripción del contenido multimedia
 */
function getMediaDescription(msg) {
    const sentOrReceived = msg.fromMe ? 'enviado' : 'recibido';
    const mediaTypes = {
        image: 'Imagen',
        video: 'Video',
        audio: 'Audio',
        sticker: 'Sticker',
        document: 'Documento'
    };
    
    const type = mediaTypes[msg.type] || 'Media';
    return chalk.green(`[${type} ${sentOrReceived}]`);
}

/**
 * Actualiza un chat específico cuando recibe un mensaje nuevo
 */
async function updateChatOnNewMessage(chatId) {
    try {
        // Obtener el chat actualizado
        const chats = await client.getChats();
        const updatedChat = chats.find(c => c.id._serialized === chatId);
        
        if (!updatedChat) return;

        // Actualizar metadata
        const existingMetadata = state.chatMetadata.get(chatId);
        const isCurrentChat = state.currentChatId === chatId;
        
        // Si estamos dentro de este chat, no incrementar contador (ya lo estamos viendo)
        // Si no estamos en este chat, incrementar contador de no leídos
        let unreadCount = existingMetadata?.unreadCount || 0;
        if (!isCurrentChat) {
            unreadCount += 1;
        }
        
        state.chatMetadata.set(chatId, {
            name: getChatName(updatedChat),
            timestamp: updatedChat.timestamp || Date.now() / 1000,
            unread: unreadCount > 0,
            unreadCount: unreadCount
        });
        
        // Reordenar y actualizar cache
        await refreshChatList();
        
        // NO mostrar la lista automáticamente aquí
        // Se mostrará desde el handler de mensajes si es necesario
    } catch (error) {
        // Ignorar errores silenciosamente
    }
}

/**
 * Limpia metadata de chats que ya no están en los top 20
 * Evita memory leaks en sesiones largas
 */
function periodicMemoryCleanup() {
    try {
        // Obtener IDs de chats que están actualmente en cache (top 20)
        const activeChatIds = new Set(Array.from(state.chatCache.values()));
        
        // Eliminar metadata de chats que ya no están en los top 20
        const idsToRemove = [];
        for (const [chatId] of state.chatMetadata.entries()) {
            if (!activeChatIds.has(chatId)) {
                idsToRemove.push(chatId);
            }
        }
        
        // Eliminar metadata obsoleta
        idsToRemove.forEach(id => {
            state.chatMetadata.delete(id);
        });
        
        // Log opcional para debugging (comentar en producción)
        // if (idsToRemove.length > 0) {
        //     console.log(`[Memory Cleanup] Eliminadas ${idsToRemove.length} entradas de metadata obsoletas`);
        // }
    } catch (error) {
        // Ignorar errores en limpieza
    }
}

/**
 * Refresca la lista de chats internamente (sin mostrar)
 */
async function refreshChatList() {
    try {
        const allChats = await client.getChats();
        const sortedChats = allChats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        const last20Chats = sortedChats.slice(0, 20);
        
        // Limpiar y actualizar cache
        state.chatCache.clear();
        last20Chats.forEach((chat, index) => {
            const chatId = chat.id._serialized;
            state.chatCache.set(index, chatId);
            // Preservar metadata existente o crear nuevo
            if (!state.chatMetadata.has(chatId)) {
                // Inicializar con contador en 0 (se actualizará cuando lleguen mensajes)
                state.chatMetadata.set(chatId, {
                    name: getChatName(chat),
                    timestamp: chat.timestamp || 0,
                    unread: false,
                    unreadCount: 0
                });
            } else {
                // Actualizar solo el nombre y timestamp, preservar unreadCount
                const existingMetadata = state.chatMetadata.get(chatId);
                existingMetadata.name = getChatName(chat);
                existingMetadata.timestamp = chat.timestamp || 0;
                state.chatMetadata.set(chatId, existingMetadata);
            }
        });
        
        // Limpiar metadata de chats que ya no están en los top 20
        periodicMemoryCleanup();
    } catch (error) {
        // Ignorar errores
    }
}

/**
 * Muestra la lista de chats en pantalla (sin saltos de línea al inicio)
 */
async function displayChatList() {
    console.log('═══════════════════════════════════════════════════');
    console.log('Últimos 20 chats:');
    
    for (let i = 0; i < 20; i++) {
        const chatId = state.chatCache.get(i);
        if (chatId) {
            const metadata = state.chatMetadata.get(chatId);
            if (metadata) {
                // Mostrar contador y 🔔 si tiene mensajes no leídos
                let indicator = '';
                if (metadata.unreadCount > 0) {
                    indicator = ` (${metadata.unreadCount}) 🔔`;
                }
                console.log(`${i}: ${metadata.name}${indicator}`);
            }
        }
    }
    
    console.log('═══════════════════════════════════════════════════');
}

/**
 * Muestra las notificaciones recientes
 * Solo se muestra si "No Molestar" está desactivado
 */
function displayNotifications() {
    // Solo mostrar el área de notificaciones si "No Molestar" está desactivado
    if (state.doNotDisturb) {
        return; // No mostrar nada si está activo
    }
    
    console.log('\n[Área de notificaciones]');
    if (notifications.length === 0) {
        console.log('(Sin notificaciones nuevas)');
    } else {
        // Mostrar las últimas notificaciones (máximo MAX_NOTIFICATIONS)
        const recentNotifications = notifications.slice(-MAX_NOTIFICATIONS);
        recentNotifications.forEach(notif => {
            console.log(notif.message);
        });
    }
    console.log('───────────────────────────────────────────────────\n');
}

/**
 * Agrega una notificación al array
 * @param {string} chatId - ID del chat que envió el mensaje
 * @param {string} message - Mensaje de notificación formateado
 */
function addNotification(chatId, message) {
    notifications.push({ chatId, message });
    // Mantener solo las últimas MAX_NOTIFICATIONS
    if (notifications.length > MAX_NOTIFICATIONS) {
        notifications.shift();
    }
}

/**
 * Dibuja la vista completa del menú (lista + notificaciones + opciones)
 */
async function drawMenuView() {
    await displayChatList();
    displayNotifications();
}

/**
 * Redibuja la vista completa del menú limpiando la pantalla primero
 * @param {boolean} showMenuOptions - Si es true, retorna también el texto del menú para usar con rl.question()
 */
async function refreshMenuView(showMenuOptions = false) {
    // Limpiar pantalla completamente
    console.clear();
    // Redibujar todo desde cero
    await drawMenuView();
    // Si se solicita, retornar el texto del menú (no escribirlo directamente)
    if (showMenuOptions) {
        return chalk.blue(
            `Elige una opción:\n` +
            `1. Listar los últimos 20 chats\n` +
            `2. Seleccionar un chat para chatear\n` +
            `3. No Molestar (${state.doNotDisturb ? 'Activo' : 'Inactivo'})\n` +
            `4. Salir\n> `
        );
    }
    return '';
}

/**
 * Limpia las notificaciones
 */
function clearNotifications() {
    notifications.length = 0;
}

/**
 * Elimina las notificaciones de un chat específico
 * @param {string} chatId - ID del chat cuyas notificaciones se eliminarán
 */
function removeNotificationsByChatId(chatId) {
    const initialLength = notifications.length;
    // Filtrar las notificaciones, manteniendo solo las que NO son del chatId especificado
    for (let i = notifications.length - 1; i >= 0; i--) {
        if (notifications[i].chatId === chatId) {
            notifications.splice(i, 1);
        }
    }
}

/**
 * Carga y cachea solo los últimos 20 chats con datos mínimos
 */
async function loadChats() {
    await refreshChatList();
    // Actualizar contadores de mensajes no leídos
    await updateUnreadCounts();
    // Limpiar pantalla y redibujar todo desde cero
    await refreshMenuView(false);
}

/**
 * Actualiza los contadores de mensajes no leídos para todos los chats en cache
 */
async function updateUnreadCounts() {
    try {
        const chats = await client.getChats();
        for (let i = 0; i < 20; i++) {
            const chatId = state.chatCache.get(i);
            if (chatId) {
                const chat = chats.find(c => c.id._serialized === chatId);
                if (chat) {
                    try {
                        const unreadCount = await chat.getUnreadCount();
                        const metadata = state.chatMetadata.get(chatId);
                        if (metadata) {
                            // Solo actualizar si no estamos dentro de ese chat
                            if (state.currentChatId !== chatId) {
                                metadata.unreadCount = unreadCount;
                                metadata.unread = unreadCount > 0;
                                state.chatMetadata.set(chatId, metadata);
                            }
                        }
                    } catch (error) {
                        // Ignorar errores al obtener contador
                    }
                }
            }
        }
    } catch (error) {
        // Ignorar errores
    }
}

/**
 * Obtiene un chat por su índice del cache
 */
async function getChatByIndex(index) {
    const chatId = state.chatCache.get(Number(index));
    if (!chatId) {
        return null;
    }
    
    try {
        const chats = await client.getChats();
        return chats.find(chat => chat.id._serialized === chatId) || null;
    } catch (error) {
        console.error('Error al obtener chat:', error.message);
        return null;
    }
}

/**
 * Muestra el historial del chat de forma optimizada
 */
async function showChatHistory(chat) {
    try {
        const messages = await chat.fetchMessages({ limit: state.messageHistoryLimit });
        
        const chatName = getChatName(chat);
        console.log('\n═══════════════════════════════════════════════════');
        console.log(`Chat con: ${chatName}`);
        console.log('═══════════════════════════════════════════════════\n');
        
        // Procesar mensajes en orden cronológico: más antiguos arriba, más recientes abajo
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            formatMessage(msg, chatName);
        }
        
        // Solo una línea separadora después del historial cargado
        console.log('───────────────────────────────────────────────────\n');
        
        // Limpiar referencias después de mostrar
        messages.length = 0;
    } catch (error) {
        console.error('Error al cargar historial:', error.message);
    }
}

/**
 * Muestra el estado del contacto
 */
async function showContactStatus(chat) {
    try {
        const presence = await chat.getPresence();
        const status = presence.isOnline 
            ? 'En línea' 
            : `Visto por última vez el ${presence.lastSeen ? formatDate(presence.lastSeen) : 'desconocido'}`;
        console.log(`Estado del contacto: ${status}`);
    } catch (error) {
        console.log('No se pudo obtener el estado del contacto.');
    }
}

/**
 * Muestra información completa del contacto
 */
async function showContactInfo(chat) {
    const chatName = getChatName(chat);
    console.log('\n═══════════════════════════════════════════════════');
    console.log('Información del contacto:');
    console.log(`  Nombre: ${chatName}`);
    console.log(`  ID: ${chat.id.user || 'N/A'}`);
    
    try {
        const presence = await chat.getPresence();
        const status = presence.isOnline 
            ? 'En línea' 
            : `Visto por última vez: ${presence.lastSeen ? formatDate(presence.lastSeen) : 'desconocido'}`;
        console.log(`  Estado: ${status}`);
    } catch (error) {
        console.log('  Estado: No disponible');
    }
    
    try {
        const unreadCount = await chat.getUnreadCount();
        if (unreadCount > 0) {
            console.log(`  Mensajes no leídos: ${unreadCount}`);
        }
    } catch (error) {
        // Ignorar errores
    }
    
    console.log('═══════════════════════════════════════════════════\n');
}

/**
 * Muestra la ayuda de comandos disponibles
 */
function showHelp() {
    console.log('\n═══════════════════════════════════════════════════');
    console.log('Comandos disponibles:');
    console.log('  /ayuda, /help        - Mostrar esta ayuda');
    console.log('  /historial N, /hist N - Ver últimos N mensajes (ej: /historial 50)');
    console.log('  /limpiar, /clear     - Limpiar pantalla');
    console.log('  /info                 - Información del contacto');
    console.log('  /mas                  - Cargar 20 mensajes más');
    console.log('  /salir, /exit, /menu - Volver al menú principal');
    console.log('\nAtajos rápidos:');
    console.log('  <, salir, ..         - Volver al menú principal');
    console.log('═══════════════════════════════════════════════════\n');
}

/**
 * Bucle principal para enviar mensajes en un chat
 */
function chatLoop(chat) {
    if (state.isInChatLoop) {
        return; // Evitar múltiples loops simultáneos
    }
    
    state.isInChatLoop = true;
    state.currentChatId = chat.id._serialized;
    state.isInMenu = false; // Establecer a false cuando entras a un chat
    
    // Marcar el chat como leído cuando entras y resetear contador
    const chatId = chat.id._serialized;
    const metadata = state.chatMetadata.get(chatId);
    if (metadata) {
        metadata.unread = false;
        metadata.unreadCount = 0;
        state.chatMetadata.set(chatId, metadata);
    }
    
    // Eliminar las notificaciones de este chat específico al entrar
    removeNotificationsByChatId(chatId);
    
    const promptMessage = () => {
        rl.question('> ', async (message) => {
            // Limpiar inmediatamente la línea del prompt que readline mostró
            readline.moveCursor(process.stdout, 0, -1);
            readline.clearLine(process.stdout, 0);
            
            const input = message.trim();
            
            if (!input) {
                promptMessage();
                return;
            }
            
            // Manejar comandos que empiezan con /
            if (input.startsWith('/')) {
                const [command, ...args] = input.slice(1).toLowerCase().split(' ');
                const arg = args.join(' ');
                
                switch (command) {
                    case 'ayuda':
                    case 'help':
                        showHelp();
                        promptMessage();
                        return;
                    
                    case 'historial':
                    case 'hist':
                        const limit = parseInt(arg) || 20;
                        if (limit > 0 && limit <= 100) {
                            state.messageHistoryLimit = limit;
                            await showChatHistory(chat);
                        } else {
                            console.log('El límite debe estar entre 1 y 100.');
                        }
                        promptMessage();
                        return;
                    
                    case 'limpiar':
                    case 'clear':
                        console.clear();
                        // Mostrar el encabezado del chat nuevamente
                        const chatName = getChatName(chat);
                        console.log('\n═══════════════════════════════════════════════════');
                        console.log(`Chat con: ${chatName}`);
                        console.log('═══════════════════════════════════════════════════\n');
                        promptMessage();
                        return;
                    
                    case 'info':
                        await showContactInfo(chat);
                        promptMessage();
                        return;
                    
                    case 'mas':
                        state.messageHistoryLimit += 20;
                        await showChatHistory(chat);
                        promptMessage();
                        return;
                    
                    case 'salir':
                    case 'exit':
                    case 'menu':
                        state.currentChatId = null;
                        state.isInChatLoop = false;
                        console.log('\nVolviendo al menú principal...\n');
                        showMenu();
                        return;
                    
                    default:
                        console.log(`Comando desconocido: /${command}. Usa /ayuda para ver comandos disponibles.`);
                        promptMessage();
                        return;
                }
            }
            
            // Manejar atajos rápidos (mantener compatibilidad)
            const cleanMessage = input.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            
            if (['<', 'salir', '..'].includes(cleanMessage)) {
                state.currentChatId = null;
                state.isInChatLoop = false;
                // Limpiar pantalla y volver al menú
                console.clear();
                console.log('Volviendo al menú principal...\n');
                showMenu();
                return;
            }
            
            if (cleanMessage === 'mas') {
                state.messageHistoryLimit += 20;
                await showChatHistory(chat);
                promptMessage();
                return;
            }
            
            // Es un mensaje normal, enviarlo
            try {
                await client.sendMessage(chat.id._serialized, input);
                // Mostrar el mensaje enviado con el mismo formato que los recibidos
                const sentMsg = {
                    fromMe: true,
                    body: input,
                    timestamp: Math.floor(Date.now() / 1000),
                    hasMedia: false
                };
                formatMessage(sentMsg, getChatName(chat));
            } catch (error) {
                console.error('Error al enviar el mensaje:', error.message);
            }
            
            promptMessage();
        });
    };
    
    promptMessage();
}

/**
 * Maneja las opciones del menú
 */
async function handleMenuOption(option) {
    switch (option) {
        case '1':
            await loadChats();
            showMenu();
            break;

        case '2':
            rl.question('Introduce el número del chat: ', async (chatIndex) => {
                const chat = await getChatByIndex(chatIndex);
                
                if (chat) {
                    // Limpiar pantalla al entrar al chat
                    console.clear();
                    await showChatHistory(chat);
                    chatLoop(chat);
                } else {
                    console.log('Índice de chat no válido.');
                    showMenu();
                }
            });
            break;

        case '3':
            state.doNotDisturb = !state.doNotDisturb;
            // Si se activa "No Molestar", actualizar la lista de chats primero
            if (state.doNotDisturb) {
                await refreshChatList();
            }
            console.log(`Modo No Molestar ${state.doNotDisturb ? 'activado' : 'desactivado'}`);
            showMenu();
            break;

        case '4':
            console.log('Saliendo...');
            rl.close();
            process.exit(0);
            break;

        default:
            console.log('Opción no válida. Intenta de nuevo.');
            showMenu();
            break;
    }
}

// Variable para rastrear el listener activo del menú
let menuInputHandler = null;

/**
 * Muestra el menú principal
 */
function showMenu() {
    state.isInMenu = true;
    state.currentChatId = null;
    
    // Remover cualquier listener anterior
    if (menuInputHandler) {
        rl.removeListener('line', menuInputHandler);
    }
    
    // Limpiar pantalla y dibujar la vista completa del menú
    refreshMenuView(false).then(() => {
        // Mostrar el menú de opciones
        const menuText = chalk.blue(
            `Elige una opción:\n` +
            `1. Listar los últimos 20 chats\n` +
            `2. Seleccionar un chat para chatear\n` +
            `3. No Molestar (${state.doNotDisturb ? 'Activo' : 'Inactivo'})\n` +
            `4. Salir\n> `
        );
        process.stdout.write(menuText);
        
        // Crear el handler de input
        menuInputHandler = async (input) => {
            rl.removeListener('line', menuInputHandler);
            menuInputHandler = null;
            await handleMenuOption(input.trim());
        };
        
        rl.setPrompt('> ');
        rl.prompt();
        rl.once('line', menuInputHandler);
    });
}

/**
 * Limpieza de recursos antes de salir
 */
async function cleanup() {
    try {
        state.chatCache.clear();
        state.chatMetadata.clear();
        state.currentChatId = null;
    } catch (error) {
        // Ignorar errores en limpieza
    }
}

/**
 * Maneja mensajes entrantes de forma optimizada
 */
client.on('message', async (message) => {
    if (message.isStatus) {
        return;
    }
    
    const chatId = message.from;
    
    try {
        const metadata = state.chatMetadata.get(chatId);
        const sender = metadata ? metadata.name : 'Desconocido';
        
        const content = message.hasMedia 
            ? getMediaDescription(message) 
            : (message.body || '[Mensaje vacío]');
        
        // Si estamos dentro de un chat, SIEMPRE mostrar mensajes de ese chat
        if (state.currentChatId === chatId) {
            await updateChatOnNewMessage(chatId);
            // Marcar como leído automáticamente porque lo estamos viendo
            const currentMetadata = state.chatMetadata.get(chatId);
            if (currentMetadata) {
                currentMetadata.unread = false;
                currentMetadata.unreadCount = 0;
                state.chatMetadata.set(chatId, currentMetadata);
            }
            // Pausar readline temporalmente para evitar que el prompt interfiera
            rl.pause();
            // Limpiar la línea del prompt: volver al inicio y limpiar hasta el final
            process.stdout.write('\r\x1b[K');
            // Mostrar con el mismo formato que el historial (en nueva línea)
            formatMessage(message, sender);
            // Reanudar readline (readline mostrará su prompt automáticamente)
            rl.resume();
            return;
        }
        
        // Si estamos en un chat pero nos escribe OTRA persona, guardar la notificación para cuando volvamos al menú
        if (state.currentChatId && state.currentChatId !== chatId) {
            await updateChatOnNewMessage(chatId);
            // Agregar notificación al array para cuando vuelvas al menú (con chatId para poder eliminarla después)
            const notificationMsg = chalk.yellow(`💬 Nuevo mensaje de ${sender}: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`);
            addNotification(chatId, notificationMsg);
            return; // No mostrar nada en pantalla, solo guardar para después
        }
        
        // Si estamos en el menú y "No Molestar" está activo, NO actualizar la lista ni mostrar notificación
        if (state.isInMenu && state.doNotDisturb) {
            // No hacer nada, la lista no se actualiza ni se muestran notificaciones
            return;
        }
        
        // Si estamos en el menú y "No Molestar" está desactivado, SÍ actualizar y mostrar notificación
        if (state.isInMenu && !state.currentChatId) {
            await updateChatOnNewMessage(chatId);
            // Agregar notificación al array (con chatId para poder eliminarla después)
            const notificationMsg = chalk.yellow(`💬 Nuevo mensaje de ${sender}: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`);
            addNotification(chatId, notificationMsg);
            // Limpiar pantalla y redibujar todo desde cero
            rl.pause();
            // Remover el listener anterior si existe
            if (menuInputHandler) {
                rl.removeListener('line', menuInputHandler);
                menuInputHandler = null;
            }
            await refreshMenuView(false);
            // Mostrar el menú de opciones directamente
            const menuText = chalk.blue(
                `Elige una opción:\n` +
                `1. Listar los últimos 20 chats\n` +
                `2. Seleccionar un chat para chatear\n` +
                `3. No Molestar (${state.doNotDisturb ? 'Activo' : 'Inactivo'})\n` +
                `4. Salir\n> `
            );
            process.stdout.write(menuText);
            rl.resume();
            // Configurar el prompt y esperar input
            rl.setPrompt('> ');
            rl.prompt();
            // Crear nuevo handler de input
            menuInputHandler = async (input) => {
                rl.removeListener('line', menuInputHandler);
                menuInputHandler = null;
                await handleMenuOption(input.trim());
            };
            rl.once('line', menuInputHandler);
        }
    } catch (error) {
        // Ignorar errores al procesar mensajes
    }
});

// Eventos del cliente
client.on('qr', (qr) => {
    console.log('Escanea este código QR con tu teléfono:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('Cliente está listo!');
    await loadChats();
    showMenu();
    
    // Iniciar limpieza periódica de memoria cada 10 minutos como respaldo
    // (La limpieza principal se ejecuta después de cada refreshChatList)
    setInterval(periodicMemoryCleanup, 10 * 60 * 1000);
});

client.on('disconnected', (reason) => {
    console.log('Cliente desconectado:', reason);
});

client.on('auth_failure', (msg) => {
    console.error('Error de autenticación:', msg);
});

// Manejo de señales para limpieza adecuada
process.on('SIGINT', async () => {
    console.log('\nCerrando aplicación...');
    await cleanup();
    rl.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await cleanup();
    rl.close();
    process.exit(0);
});

// Inicializar cliente
client.initialize();
console.log('Inicializando cliente...');

