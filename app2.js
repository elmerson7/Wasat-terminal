const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const readline = require('readline');
let chalk;
import('chalk').then(module => {
    chalk = module.default;
});

const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'client2' }),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// Interfaz de línea de comandos para interacción
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Variables globales
let chats = [];
let currentChat = null;
let doNotDisturb = true; // Modo No Molestar activado por defecto
let messageHistoryLimit = 10;

// Función para inicializar el cliente y cargar los chats
client.on('qr', (qr) => {
    console.log('Escanea este código QR con tu teléfono:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('Cliente está listo!');
    await loadChats();
    showMenu();
});

// Cargar los últimos 20 chats y ordenarlos por la última actividad
async function loadChats() {
    chats = await client.getChats();
    if (chats.length > 0) {
        chats.sort((a, b) => b.timestamp - a.timestamp);
        console.log('Últimos 20 chats:');
        const last20Chats = chats.slice(0, 20);
        last20Chats.forEach((chat, index) => {
            console.log(`${index}: ${chat.name || chat.formattedTitle || chat.id.user}`);
        });
    } else {
        console.log('No hay chats disponibles.');
    }
}

// Mostrar menú principal de opciones
function showMenu() {
    // Aplicar color azul al menú
    rl.question(chalk.blue(`\nElige una opción:\n1. Listar los últimos 20 chats\n2. Seleccionar un chat para chatear\n3. No Molestar (${doNotDisturb ? 'Activo' : 'Inactivo'})\n4. Salir\n> `), async (input) => {
        switch (input.trim()) {
            case '1':
                await loadChats();
                showMenu();
                break;

            case '2':
                rl.question('Introduce el número del chat: ', async (chatIndex) => {
                    currentChat = chats[chatIndex];
                    if (currentChat) {
                        console.log(chalk.green(`Chat seleccionado: ${currentChat.name || currentChat.formattedTitle || currentChat.id.user}`));
                        showContactStatus(currentChat);
                        await showChatHistory(currentChat);
                        chatLoop(currentChat);
                    } else {
                        console.log('Índice de chat no válido.');
                        showMenu();
                    }
                });
                break;

            case '3':
                doNotDisturb = !doNotDisturb;
                console.log(`Modo No Molestar ${doNotDisturb ? 'activado' : 'desactivado'}`);
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
    });
}

// Función para obtener una descripción del contenido multimedia
function getMediaDescription(msg) {
    const sentOrReceived = msg.fromMe ? 'enviado' : 'recibido';
    switch (msg.type) {
        case 'image':
            return chalk.green(`[Imagen ${sentOrReceived}]`);
        case 'video':
            return chalk.green(`[Video ${sentOrReceived}]`);
        case 'audio':
            return chalk.green(`[Audio ${sentOrReceived}]`);
        case 'sticker':
            return chalk.green(`[Sticker ${sentOrReceived}]`);
        case 'document':
            return chalk.green(`[Documento ${sentOrReceived}]`);
        default:
            return chalk.green(`[Media ${sentOrReceived}]`);
    }
}

// Mostrar historial breve del chat seleccionado
async function showChatHistory(chat) {
    const messages = await chat.fetchMessages({ limit: messageHistoryLimit });
    console.log('--- Historial breve del chat ---');
    messages.reverse().forEach(msg => {
        const from = msg.fromMe ? 'Yo' : (chat.name || chat.formattedTitle || chat.id.user);
        let content = msg.body;

        if (msg.hasMedia) {
            content = getMediaDescription(msg);
        }

        console.log(`[${from} - ${formatDate(msg.timestamp)}]: ${content}`);
    });
    console.log('--- Fin del historial ---\n');
}

// Formatear la fecha de los mensajes
const formatDate = (timestamp) => {
    const date = new Date(timestamp * 1000);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
};

// Mostrar el estado del contacto (en línea, visto por última vez)
async function showContactStatus(chat) {
    try {
        const presence = await chat.getPresence();
        const status = presence.isOnline ? 'En línea' : `Visto por última vez el ${presence.lastSeen ? formatDate(presence.lastSeen) : 'desconocido'}`;
        console.log(`Estado del contacto: ${status}`);
    } catch (err) {
        console.log('No se pudo obtener el estado del contacto.');
    }
}

// Escuchar mensajes y notificar si se reciben de otros chats cuando no estás en uno activo
client.on('message', async (message) => {
    if (!message.isStatus) {
        const chat = chats.find(c => c.id._serialized === message.from);
        const sender = chat ? (chat.name || chat.formattedTitle || chat.id.user) : 'Desconocido';
        
        if (message.hasMedia) {
            console.log(`\nMensaje multimedia de ${sender}: ${getMediaDescription(message)}`);
        } else {
            console.log(`\nMensaje de ${sender}: ${message.body}`);
        }
    }
});

// Bucle para enviar mensajes en el chat actual con atajos para salir
function chatLoop(chat) {
    rl.question('Escribe tu mensaje (o usa "<", "salir" o ".." para volver al menú): ', (message) => {
        const cleanMessage = message.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (['<', 'salir', '..'].includes(cleanMessage)) {
            currentChat = null;
            console.log('Volviendo al menú principal...');
            showMenu();
        } else if (cleanMessage === 'mas') {
            messageHistoryLimit += 20;
            showChatHistory(chat).then(() => chatLoop(chat));
        } else {
            client.sendMessage(chat.id._serialized, message).then(() => {
                console.log(`Mensaje enviado a ${chat.name || chat.formattedTitle || chat.id.user}: ${message}`);
                chatLoop(chat);
            }).catch((err) => {
                console.error('Error al enviar el mensaje:', err);
                chatLoop(chat);
            });
        }
    });
}

client.initialize();
console.log('Inicializando cliente...');
