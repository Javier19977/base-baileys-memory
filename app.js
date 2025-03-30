const { createBot, createProvider, createFlow, addKeyword } = require('@bot-whatsapp/bot');
const QRPortalWeb = require('@bot-whatsapp/portal');
const BaileysProvider = require('@bot-whatsapp/provider/baileys');
const MockAdapter = require('@bot-whatsapp/database/mock');
const express = require('express');
const app = express();
app.use(express.json());

const flowSecundario = addKeyword(['2', 'siguiente']).addAnswer(['📄 Aquí tenemos el flujo secundario']);

const flowPrincipal = addKeyword(['hola', 'ole', 'alo'])
    .addAnswer('👋 ¡Hola! Deja tu consulta y en un momento me comunico contigo.');

const main = async () => {
    const adapterDB = new MockAdapter();
    const adapterFlow = createFlow([flowPrincipal]);
    const adapterProvider = createProvider(BaileysProvider);

    const bot = createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    });

    // Cambia el puerto de QRPortalWeb a 3001
    QRPortalWeb({ port: 3002 });

    // Lógica para enviar mensajes a través de un endpoint HTTP
    app.post('/send-message', async (req, res) => {
        try {
            let { numbers, message, mediaUrl } = req.body;

            console.log("Received Request:", { numbers, message, mediaUrl }); // Add debug log

            // Validación de datos
            if (!numbers || !message) {
                return res.status(400).json({ error: "Los números y el mensaje son obligatorios." });
            }

            // Asegurar que numbers sea un array
            const phoneNumbers = Array.isArray(numbers) ? numbers : [numbers];

            // Filtrar números inválidos
            const validNumbers = phoneNumbers.filter(num => typeof num === "string" && num.trim() !== "");

            if (validNumbers.length === 0) {
                return res.status(400).json({ error: "No se proporcionaron números válidos." });
            }

            // Enviar los mensajes en paralelo
            const results = await Promise.all(validNumbers.map(async (number) => {
                try {
                    console.log(`Sending message to ${number} with media: ${mediaUrl}`); // Add debug log
                    await adapterProvider.sendMessage(number, message, mediaUrl ? { media: mediaUrl } : undefined);
                    return { number, status: "success" };
                } catch (error) {
                    console.error(`Error con ${number}:`, error);
                    return { number, status: "error", error: error.message };
                }
            }));

            return res.json({ success: true, results });
        } catch (error) {
            console.error("Error en la API:", error);
            return res.status(500).json({ error: "Error interno en el servidor." });
        }
    });

    // Inicia el servidor HTTP
    const port = process.env.PORT || 3001; // Cambia este puerto si es necesario
    app.listen(port, () => {
        console.log(`Servidor corriendo en puerto ${port}`);
    });
};

main();