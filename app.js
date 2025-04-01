const { createBot, createProvider, createFlow, addKeyword } = require('@bot-whatsapp/bot');
const QRPortalWeb = require('@bot-whatsapp/portal');
const BaileysProvider = require('@bot-whatsapp/provider/baileys');
const MockAdapter = require('@bot-whatsapp/database/mock');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'bd_catalogo',
};

const connectToDatabase = async () => {
    try {
        const connection = await mysql.createConnection(dbConfig);
        console.log("Conexión a la base de datos establecida.");
        return connection;
    } catch (error) {
        console.error("Error en la conexión a la BD:", error);
        throw error;
    }
};

const flowPrincipal = addKeyword(['hola', 'ole', 'alo']).addAnswer('👋 ¡Hola! ¿En qué puedo ayudarte?');

const userConnections = {};
const QR_PORT = 3002;

const getSessionPath = (userId) => {
    const sessionPath = path.join(__dirname, `session_${userId}.qr.png`);
    return sessionPath;
};

const closeUserConnection = async (userId) => {
    if (userConnections[userId]) {
        const { adapterProvider } = userConnections[userId];
        if (adapterProvider.ws) {
            try {
                adapterProvider.ws.close();
                console.log(`WebSocket cerrado para el usuario ${userId}`);
            } catch (error) {
                console.error(`Error cerrando WebSocket para el usuario ${userId}:`, error);
            }
        } else {
            console.warn(`WebSocket no está disponible en adapterProvider para el usuario ${userId}`);
        }
        delete userConnections[userId];
        console.log(`❌ Sesión de usuario ${userId} cerrada.`);
    }
};

const createUserConnection = async (userId) => {
    if (userConnections[userId] && userConnections[userId].authenticated) {
        console.log(`El usuario ${userId} ya está autenticado.`);
        return;
    }

    await closeUserConnection(userId);

    const sessionPath = getSessionPath(userId);

    console.log(`📂 Ruta de sesión para el usuario ${userId}: ${sessionPath}`);

    const adapterProvider = createProvider(BaileysProvider, { 
        name: `session_${userId}`,
        path: sessionPath, 
        restartOnAuthFail: true,
        qrTimeout: 300_000,
        authTimeout: 120_000
    });

    adapterProvider.on('qr', async (qr) => {
        console.log(`🔹 QR para ${userId}:`, qr);
        const qrFilePath = sessionPath;
        await qrcode.toFile(qrFilePath, qr);
        console.log(`✅ Código QR guardado en: ${qrFilePath}`);
    });

    adapterProvider.on('ready', async () => {
        if (!userConnections[userId].authenticated) {
            userConnections[userId].authenticated = true;
            console.log(`✅ Usuario ${userId} autenticado correctamente`);
            console.log('Proveedor conectado y listo');
        }
    });

    adapterProvider.on('auth_failure', (msg) => {
        console.error(`❌ Error de autenticación en ${userId}:`, msg);
    });

    adapterProvider.on('disconnected', (reason) => {
        console.warn(`⚠️ Usuario ${userId} desconectado:`, reason);
        closeUserConnection(userId);
    });

    adapterProvider.on('timeout', (error) => {
        console.error(`⚠️ Tiempo de espera agotado para el usuario ${userId}:`, error);
        setTimeout(() => {
            createUserConnection(userId);
        }, 5000);
    });

    const bot = createBot({
        flow: createFlow([flowPrincipal]),
        provider: adapterProvider,
        database: new MockAdapter(),
    });

    userConnections[userId] = { bot, adapterProvider, authenticated: false };

    console.log(`✅ QR generado en http://200.58.107.170/${QR_PORT}/session_${userId}.qr.png para el usuario ${userId}`);
};

app.use('/', express.static(path.join(__dirname)));

app.post('/generate-qr', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: "ID de usuario obligatorio" });

        await createUserConnection(userId);
        const qrCodeURL = `http://200.58.107.170/${QR_PORT}/session_${userId}.qr.png`;

        console.log(`🔹 QR generado para el usuario ${userId}: ${qrCodeURL}`);
        return res.json({ success: true, url: qrCodeURL });
    } catch (error) {
        console.error("❌ Error generando QR:", error);
        return res.status(500).json({ error: "Error interno del servidor" });
    }
});

app.post('/qr/manejarQrEscaneado', async (req, res) => {
    try {
        const { qrData, userId } = req.body;
        console.log(`QR escaneado recibido: ${qrData}`);
        console.log(`ID de usuario: ${userId}`);

        // Aquí se puede manejar cualquier otra lógica necesaria cuando se escanea un QR
        console.log(`✅ QR escaneado por el usuario ${userId} con datos: ${qrData}`);

        return res.json({ success: true });
    } catch (error) {
        console.error("❌ Error manejando el QR escaneado:", error);
        return res.status(500).json({ error: "Error interno del servidor" });
    }
});

app.post('/close-session', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId || !userConnections[userId]) return res.status(400).json({ error: "Usuario no tiene sesión activa" });

        await closeUserConnection(userId);
        return res.json({ success: true, message: `Sesión de usuario ${userId} cerrada correctamente.` });
    } catch (error) {
        console.error("Error cerrando sesión:", error);
        return res.status(500).json({ error: "Error interno del servidor" });
    }
});

app.post('/send-message', async (req, res) => {
    try {
        const { numbers, message, mediaUrl, userId } = req.body;
        if (!userId || !userConnections[userId]) return res.status(400).json({ error: "Usuario no autenticado" });

        const { adapterProvider } = userConnections[userId];
        if (!numbers || !message) return res.status(400).json({ error: "Número y mensaje obligatorios" });

        const phoneNumbers = Array.isArray(numbers) ? numbers : [numbers];
        const validNumbers = phoneNumbers.filter(num => typeof num === "string" && num.trim() !== "");

        if (validNumbers.length === 0) return res.status(400).json({ error: "No hay números válidos" });

        const results = await Promise.all(validNumbers.map(async (number) => {
            try {
                await adapterProvider.sendMessage(number, message, mediaUrl ? { media: mediaUrl } : undefined);
                return { number, status: "success" };
            } catch (error) {
                console.error(`Error enviando a ${number}:`, error);
                return { number, status: "error", error: error.message };
            }
        }));

        return res.json({ success: true, results });
    } catch (error) {
        console.error("Error enviando mensaje:", error);
        return res.status(500).json({ error: "Error interno del servidor" });
    }
});

const main = async () => {
    app.listen(3001, () => {
        console.log(`🚀 Servidor corriendo en el puerto 3001`);
    });

    app.listen(QR_PORT, () => {
        console.log(`🚀 Servidor QR corriendo en el puerto ${QR_PORT}`);
    });
};

main();