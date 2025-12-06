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
    isInChatLoop: false
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
 * Formatea la fecha de los mensajes
 */
function formatDate(timestamp) {
    const date = new Date(timestamp * 1000);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
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
 * Carga y cachea solo los últimos 20 chats con datos mínimos
 */
async function loadChats() {
    try {
        const allChats = await client.getChats();
        
        if (allChats.length === 0) {
            console.log('No hay chats disponibles.');
            return;
        }

        // Ordenar por timestamp
        const sortedChats = allChats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        const last20Chats = sortedChats.slice(0, 20);

        // Limpiar cache anterior
        state.chatCache.clear();
        state.chatMetadata.clear();

        // Almacenar solo datos esenciales
        last20Chats.forEach((chat, index) => {
            const chatId = chat.id._serialized;
            state.chatCache.set(index, chatId);
            state.chatMetadata.set(chatId, {
                name: getChatName(chat),
                timestamp: chat.timestamp || 0
            });
        });

        console.log('Últimos 20 chats:');
        last20Chats.forEach((chat, index) => {
            console.log(`${index}: ${getChatName(chat)}`);
        });
    } catch (error) {
        console.error('Error al cargar chats:', error.message);
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
        
        console.log('--- Historial breve del chat ---');
        
        // Procesar mensajes en orden inverso sin almacenarlos
        const chatName = getChatName(chat);
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            const from = msg.fromMe ? 'Yo' : chatName;
            let content = msg.body || '';

            if (msg.hasMedia) {
                content = getMediaDescription(msg);
            }

            console.log(`[${from} - ${formatDate(msg.timestamp)}]: ${content}`);
        }
        
        console.log('--- Fin del historial ---\n');
        
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
    
    const promptMessage = () => {
        rl.question('Escribe tu mensaje (o usa "<", "salir" o ".." para volver al menú): ', async (message) => {
            const cleanMessage = message.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            
            if (['<', 'salir', '..'].includes(cleanMessage)) {
                state.currentChatId = null;
                state.isInChatLoop = false;
                console.log('Volviendo al menú principal...');
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
                console.log(`Mensaje enviado a ${getChatName(chat)}: ${message}`);
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
                        console.log(chalk.green(`Chat seleccionado: ${getChatName(chat)}`));
                        await showContactStatus(chat);
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
    
    // Solo mostrar mensajes si no estamos en modo No Molestar o si no es del chat actual
    if (state.doNotDisturb && state.currentChatId === message.from) {
        return;
    }
    
    try {
        const chatId = message.from;
        const metadata = state.chatMetadata.get(chatId);
        const sender = metadata ? metadata.name : 'Desconocido';
        
        const content = message.hasMedia 
            ? getMediaDescription(message) 
            : (message.body || '[Mensaje vacío]');
        
        console.log(`\nMensaje de ${sender}: ${content}`);
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

