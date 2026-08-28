// netlify/functions/crear-pago.js
//
// Tu frontend (index.html) llama a esta función así:
//   fetch('/.netlify/functions/crear-pago', { method: 'POST', body: { amount, subject, email } })
// y espera de vuelta un JSON con { redirectUrl } para mandar al cliente a pagar.
//
// Esta función crea la orden en Flow (payment/create) y arma esa redirectUrl.
// Debe usar el MISMO método de firma y las MISMAS variables de entorno que
// confirmar-pago.js, o Flow rechazará las peticiones.

const crypto = require("crypto");

const FLOW_API_URL =
    process.env.FLOW_API_URL || "https://sandbox.flow.cl/api"; // cambia a https://www.flow.cl/api en producción

const FLOW_API_KEY = process.env.FLOW_API_KEY;
const FLOW_SECRET_KEY = process.env.FLOW_SECRET_KEY;

// Netlify define process.env.URL automáticamente con el dominio del sitio desplegado
// (ej: https://tu-sitio.netlify.app). Si prefieres fijarlo tú, define SITE_URL en
// las variables de entorno de Netlify.
const SITE_URL = process.env.SITE_URL || process.env.URL;

function firmar(params) {
    const ordenados = Object.keys(params)
        .sort()
        .map(key => `${key}${params[key]}`)
        .join("");

    return crypto
        .createHmac("sha256", FLOW_SECRET_KEY)
        .update(ordenados)
        .digest("hex");
}

exports.handler = async function (event) {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    if (!FLOW_API_KEY || !FLOW_SECRET_KEY || !SITE_URL) {
        console.error("crear-pago: faltan variables de entorno (FLOW_API_KEY, FLOW_SECRET_KEY o SITE_URL)");
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Configuración del servidor incompleta." }),
        };
    }

    try {
        const body = JSON.parse(event.body || "{}");
        const { amount, subject, email } = body;

        if (!amount || !subject || !email) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Faltan datos: amount, subject o email." }),
            };
        }

        // Orden única para identificar esta compra en tus propios registros/logs
        const commerceOrder = `scent-${Date.now()}`;

        const params = {
            apiKey: FLOW_API_KEY,
            commerceOrder,
            subject,
            currency: "CLP",
            amount: Math.round(amount),
            email,
            urlConfirmation: `${SITE_URL}/.netlify/functions/confirmar-pago`,
            urlReturn: `${SITE_URL}/gracias`, // cámbialo por la página de tu sitio que quieras mostrar al volver
        };

        params.s = firmar(params);

        const resp = await fetch(`${FLOW_API_URL}/payment/create`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams(params).toString(),
        });

        const data = await resp.json();

        if (!resp.ok || !data.url || !data.token) {
            console.error("crear-pago: Flow devolvió un error", data);
            return {
                statusCode: 502,
                body: JSON.stringify({
                    error: data.message || "Flow no pudo crear el pago.",
                }),
            };
        }

        // La URL a la que hay que redirigir al cliente para que pague
        const redirectUrl = `${data.url}?token=${data.token}`;

        return {
            statusCode: 200,
            body: JSON.stringify({ redirectUrl, flowOrder: data.flowOrder, commerceOrder }),
        };
    } catch (error) {
        console.error("crear-pago: error inesperado", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Error interno al generar el pago." }),
        };
    }
};