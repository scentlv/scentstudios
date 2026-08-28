// netlify/functions/confirmar-pago.js
//
// Flow llama a ESTA función vía POST cuando un pago se completa
// (la URL que le pasaste en "urlConfirmation" al crear el pago en crear-pago.js).
// Flow envía un "token" y espera que tú:
//   1) uses ese token para consultar el estado real del pago (payment/getStatus)
//   2) respondas con HTTP 200 en menos de 15 segundos
//
// Si esta función no existe o no responde 200 a tiempo, Flow deja el pago
// como "pendiente" para siempre, aunque el cliente sí haya pagado.

const crypto = require("crypto");

const FLOW_API_URL =
    process.env.FLOW_API_URL || "https://sandbox.flow.cl/api"; // cambia a https://www.flow.cl/api en producción

const FLOW_API_KEY = process.env.FLOW_API_KEY;
const FLOW_SECRET_KEY = process.env.FLOW_SECRET_KEY;

// Firma los parámetros igual que lo hace crear-pago.js:
// concatenar key+value ordenados alfabéticamente, y HMAC-SHA256 con el secretKey.
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

    try {
        // Flow envía el body como application/x-www-form-urlencoded: token=xxxx
        const params = new URLSearchParams(event.body);
        const token = params.get("token");

        if (!token) {
            console.error("confirmar-pago: no llegó token en el POST de Flow");
            // Igual respondemos 200: si devolvemos error, Flow reintenta y
            // nunca vamos a poder "arreglar" un token que no existe.
            return { statusCode: 200, body: "OK" };
        }

        // Consultamos el estado real del pago en Flow
        const queryParams = { apiKey: FLOW_API_KEY, token };
        queryParams.s = firmar(queryParams);

        const url = `${FLOW_API_URL}/payment/getStatus?${new URLSearchParams(
            queryParams
        ).toString()}`;

        const resp = await fetch(url, { method: "GET" });
        const data = await resp.json();

        // status: 1 = pendiente, 2 = pagada, 3 = rechazada, 4 = anulada
        console.log("confirmar-pago: estado recibido de Flow", {
            commerceOrder: data.commerceOrder,
            status: data.status,
            amount: data.amount,
        });

        if (data.status === 2) {
            // ✅ Pago confirmado.
            // Este sitio no tiene base de datos, así que por ahora solo
            // dejamos el log. Si quieres guardar el pedido, marcar stock,
            // o enviar un email de confirmación, es AQUÍ donde va esa lógica
            // (por ejemplo llamando a un servicio externo, o a una tabla en
            // Supabase/Airtable/Google Sheets, etc.).
        } else {
            console.warn("confirmar-pago: pago no exitoso, status:", data.status);
        }

        // Flow exige 200 sin importar el resultado, o reintentará el callback.
        return { statusCode: 200, body: "OK" };
    } catch (error) {
        console.error("confirmar-pago: error inesperado", error);
        // Devolvemos 200 igual para que Flow no quede reintentando indefinidamente
        // mientras depuras; una vez estable, puedes devolver 500 aquí si prefieres
        // que Flow reintente ante errores tuyos.
        return { statusCode: 200, body: "OK" };
    }
};