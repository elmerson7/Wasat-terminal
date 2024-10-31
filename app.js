const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const readline = require('readline');

const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'client1' }),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// Interfaz de línea de comandos para interacción
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Almacenar los chats y el chat actual
let chats = [];
let currentChat = null;

client.on('qr', (qr) => {
    console.log('Escanea este código QR con tu teléfono:');
    qrcode.generate(qr, { small: true }); // Mostrar el código QR en la terminal
});

client.on('ready', async () => {
    console.log('Cliente está listo!');
    // Cargar los últimos 20 chats y mostrar el menú principal
    await loadChats();
    showMenu();
});

// Cargar los últimos 20 chats y ordenarlos por el último mensaje recibido
async function loadChats() {
    chats = await client.getChats();
    if (chats.length > 0) {
        // Ordenar los chats por última actividad
        chats.sort((a, b) => b.timestamp - a.timestamp);

        console.log('Últimos 20 chats:');
        const last20Chats = chats.slice(0, 20); // Tomar los primeros 20 chats más recientes
        last20Chats.forEach((chat, index) => {
            console.log(`${index}: ${chat.name || chat.formattedTitle || chat.id.user}`);
        });
    } else {
        console.log('No hay chats disponibles.');
    }
}

// Mostrar el menú principal
function showMenu() {
    rl.question('\nElige una opción: \n1. Listar los últimos 20 chats \n2. Seleccionar un chat para chatear \n3. Salir\n> ', async (input) => {
        switch (input.trim()) {
            case '1':
                // Listar los últimos 20 chats
                await loadChats();
                showMenu();
                break;

            case '2':
                // Seleccionar un chat para chatear
                rl.question('Introduce el número del chat: ', async (chatIndex) => {
                    currentChat = chats[chatIndex];
                    if (currentChat) {
                        console.log(`Chat seleccionado: ${currentChat.name || currentChat.formattedTitle || currentChat.id.user}`);
                        
                        // Mostrar el historial de chat breve (últimos 10 mensajes)
                        await showChatHistory(currentChat);
                        
                        chatLoop(currentChat);
                    } else {
                        console.log('Índice de chat no válido.');
                        showMenu();
                    }
                });
                break;

            case '3':
                // Salir
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

// Mostrar un historial breve del chat
async function showChatHistory(chat) {
    const messages = await chat.fetchMessages({ limit: 10 }); // Obtener los últimos 10 mensajes
    console.log('--- Historial breve del chat ---');
    messages.reverse().forEach(msg => {
        const from = msg.fromMe ? 'Yo' : (chat.name || chat.formattedTitle || chat.id.user);
        console.log(`[${from}]: ${msg.body}`);
    });
    console.log('--- Fin del historial ---\n');
}

// Escuchar mensajes entrantes y mostrarlos si pertenecen al chat actual
client.on('message', (message) => {
    if (currentChat && message.from === currentChat.id._serialized) {
        console.log(`\n[${currentChat.name || currentChat.formattedTitle || currentChat.id.user}]: ${message.body}`);
        // Volver a mostrar el prompt de entrada de texto
        rl.prompt(true);
    }
});

// Bucle para enviar mensajes al chat seleccionado
function chatLoop(chat) {
    rl.question('Escribe tu mensaje (o "salir" para volver al menú principal): ', (message) => {
        if (message.trim().toLowerCase() === 'salir') {
            currentChat = null; // Limpiar el chat actual
            console.log('Volviendo al menú principal...');
            showMenu();
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
