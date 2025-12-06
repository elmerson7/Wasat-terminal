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

// Cache de mensajes recientes para evitar recargas innecesarias
const messageCache = new WeakMap();

/**
 * Obtiene el nombre del chat de forma eficiente
 */
function getChatName(chat) {
    return chat.name || chat.formattedTitle || chat.id.user || 'Sin nombre';
}

/**
 * Formatea la hora de los mensajes con formato inteligente (estilo WhatsApp)
 */
function formatTime(timestamp) {
    const msgDate = new Date(timestamp * 1000);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const msgDay = new Date(msgDate.getFullYear(), msgDate.getMonth(), msgDate.getDate());
    
    const timeStr = msgDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    
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
        const dayName = msgDate.toLocaleDateString('es-ES', { weekday: 'short' });
        return `${dayName} ${timeStr}`;
    }
    
    // Si es del mismo año, mostrar día/mes
    if (msgDate.getFullYear() === now.getFullYear()) {
        return `${msgDate.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })} ${timeStr}`;
    }
    
    // Si es de otro año, mostrar día/mes/año
    return `${msgDate.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${timeStr}`;
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
        state.chatMetadata.set(chatId, {
            name: getChatName(updatedChat),
            timestamp: updatedChat.timestamp || Date.now() / 1000,
            // Si estamos dentro de este chat, no marcar como no leído (ya lo estamos viendo)
            // Si no estamos en este chat, marcar como no leído
            unread: state.currentChatId !== chatId ? true : (existingMetadata?.unread || false)
        });
        
        // Reordenar y actualizar cache
        await refreshChatList();
        
        // Si estamos en el menú principal, refrescar visualización
        if (state.isInMenu && !state.currentChatId) {
            await displayChatList();
        }
    } catch (error) {
        // Ignorar errores silenciosamente
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
            if (!state.chatMetadata.has(chatId)) {
                state.chatMetadata.set(chatId, {
                    name: getChatName(chat),
                    timestamp: chat.timestamp || 0,
                    unread: false // Chats nuevos no tienen mensajes no leídos inicialmente
                });
            }
        });
    } catch (error) {
        // Ignorar errores
    }
}

/**
 * Muestra la lista de chats en pantalla
 */
async function displayChatList() {
    // Limpiar pantalla (opcional, puede ser molesto)
    // console.clear(); // Descomenta si quieres limpiar pantalla
    
    console.log('\n═══════════════════════════════════════════════════');
    console.log('Últimos 20 chats:');
    
    for (let i = 0; i < 20; i++) {
        const chatId = state.chatCache.get(i);
        if (chatId) {
            const metadata = state.chatMetadata.get(chatId);
            if (metadata) {
                // Mostrar 🔔 solo si tiene mensajes no leídos
                const indicator = metadata.unread ? ' 🔔' : '';
                console.log(`${i}: ${metadata.name}${indicator}`);
            }
        }
    }
    
    console.log('═══════════════════════════════════════════════════\n');
}

/**
 * Carga y cachea solo los últimos 20 chats con datos mínimos
 */
async function loadChats() {
    await refreshChatList();
    await displayChatList();
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
        
        // Procesar mensajes en orden inverso sin almacenarlos
        for (let i = messages.length - 1; i >= 0; i--) {
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
 * Bucle principal para enviar mensajes en un chat
 */
function chatLoop(chat) {
    if (state.isInChatLoop) {
        return; // Evitar múltiples loops simultáneos
    }
    
    state.isInChatLoop = true;
    state.currentChatId = chat.id._serialized;
    state.isInMenu = false; // Establecer a false cuando entras a un chat
    
    // Marcar el chat como leído cuando entras
    const chatId = chat.id._serialized;
    const metadata = state.chatMetadata.get(chatId);
    if (metadata) {
        metadata.unread = false;
        state.chatMetadata.set(chatId, metadata);
    }
    
    const promptMessage = () => {
        rl.question('> ', async (message) => {
            // Limpiar inmediatamente la línea del prompt que readline mostró
            readline.moveCursor(process.stdout, 0, -1);
            readline.clearLine(process.stdout, 0);
            
            const cleanMessage = message.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            
            if (['<', 'salir', '..'].includes(cleanMessage)) {
                state.currentChatId = null;
                state.isInChatLoop = false;
                console.log('\nVolviendo al menú principal...\n');
                showMenu();
                return;
            }
            
            if (cleanMessage === 'mas') {
                state.messageHistoryLimit += 20;
                await showChatHistory(chat);
                promptMessage();
                return;
            }
            
            if (!message.trim()) {
                promptMessage();
                return;
            }
            
            try {
                await client.sendMessage(chat.id._serialized, message);
                // Mostrar el mensaje enviado con el mismo formato que los recibidos
                const sentMsg = {
                    fromMe: true,
                    body: message,
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
 * Muestra el menú principal
 */
function showMenu() {
    state.isInMenu = true;
    state.currentChatId = null;
    
    const menuText = chalk.blue(
        `\nElige una opción:\n` +
        `1. Listar los últimos 20 chats\n` +
        `2. Seleccionar un chat para chatear\n` +
        `3. No Molestar (${state.doNotDisturb ? 'Activo' : 'Inactivo'})\n` +
        `4. Salir\n> `
    );
    
    rl.question(menuText, async (input) => {
        const option = input.trim();
        
        switch (option) {
            case '1':
                await loadChats();
                showMenu();
                break;

            case '2':
                rl.question('Introduce el número del chat: ', async (chatIndex) => {
                    const chat = await getChatByIndex(chatIndex);
                    
                    if (chat) {
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
                console.log(`Modo No Molestar ${state.doNotDisturb ? 'activado' : 'desactivado'}`);
                showMenu();
                break;

            case '4':
                console.log('Saliendo...');
                await cleanup();
                rl.close();
                process.exit(0);
                break;

            default:
                console.log('Opción no válida. Intenta de nuevo.');
                showMenu();
                break;
        }
    });
}

/**
 * Limpieza de recursos antes de salir
 */
async function cleanup() {
    try {
        state.chatCache.clear();
        state.chatMetadata.clear();
        messageCache.clear();
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
    
    // Actualizar el chat en la lista automáticamente
    await updateChatOnNewMessage(chatId);
    
    try {
        const metadata = state.chatMetadata.get(chatId);
        const sender = metadata ? metadata.name : 'Desconocido';
        
        const content = message.hasMedia 
            ? getMediaDescription(message) 
            : (message.body || '[Mensaje vacío]');
        
        // Si estamos dentro de un chat, SIEMPRE mostrar mensajes de ese chat
        if (state.currentChatId === chatId) {
            // Marcar como leído automáticamente porque lo estamos viendo
            const currentMetadata = state.chatMetadata.get(chatId);
            if (currentMetadata) {
                currentMetadata.unread = false;
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
        
        // Si estamos en el menú y el modo "No Molestar" está activo, no mostrar notificaciones
        if (state.isInMenu && state.doNotDisturb) {
            return; // No mostrar notificación, pero la lista ya se actualizó arriba
        }
        
        // Si estamos en el menú y el modo "No Molestar" está desactivado, mostrar notificación
        if (state.isInMenu && !state.currentChatId) {
            console.log(chalk.yellow(`\n💬 Nuevo mensaje de ${sender}: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`));
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

