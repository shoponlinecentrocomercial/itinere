const socket = io();

// Pedimos un nombre de usuario básico al entrar
let username = prompt("Ingresa tu nombre de usuario para el chat:") || "Anónimo";
let currentChannel = 'general';

// Referencias a elementos del DOM
const messagesDiv = document.getElementById('messages');
const msgInput = document.getElementById('msg-input');
const sendBtn = document.getElementById('send-btn');
const channelBtns = document.querySelectorAll('.channel-btn');
const channelTitle = document.getElementById('channel-title');

// Al iniciar, nos unimos al canal por defecto
socket.emit('joinChannel', currentChannel);

// Función para enviar mensaje
function sendMessage() {
    const message = msgInput.value.trim();
    if (message) {
        socket.emit('chatMessage', { 
            channel: currentChannel, 
            username: username,
            message: message 
        });
        msgInput.value = '';
    }
}

// Escuchar click en el botón Enviar
sendBtn.addEventListener('click', sendMessage);

// Escuchar tecla "Enter" en el input
msgInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// Escuchar mensajes entrantes desde el servidor
socket.on('message', (data) => {
    const p = document.createElement('p');
    
    // Si es del sistema, lo ponemos en itálica
    if(data.user === 'Sistema') {
        p.innerHTML = `<em>${data.text}</em>`;
        p.style.color = '#888';
    } else {
        p.innerHTML = `<strong>${data.user}:</strong> ${data.text}`;
    }
    
    messagesDiv.appendChild(p);
    
    // Auto-scroll hacia abajo
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
});