/**
 * ============================================================================
 * GOOGLE CLOUD FUNCTION / FIREBASE FUNCTION: OCR CLÍNICO INTELIGENTE
 * ============================================================================
 * Agente de detección en backend que procesa imágenes de etiquetas médicas
 * mediante Google Cloud Vision API y extrae de forma estructurada:
 * - Insumo / Medicamento
 * - Lote (LOT / LOTE N°)
 * - Fecha de Vencimiento (EXP.DATE / FECHA VENCE)
 * - Fecha de Fabricación (MFG.DATE / FAB)
 * - Fabricante / Laboratorio
 * - Cantidades totales y multiplicadores (ej: 20 x 50)
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const vision = require('@google-cloud/vision');

if (!admin.apps.length) {
  admin.initializeApp();
}

const client = new vision.ImageAnnotatorClient();

/**
 * Normaliza fechas detectadas a formato MM-YYYY
 */
function normalizarFecha(fechaRaw) {
  const limpia = fechaRaw.replace(/[\/\.]/g, '-');
  const partes = limpia.split('-');
  if (partes[0].length === 4) {
    return `${partes[1].padStart(2, '0')}-${partes[0]}`;
  }
  const anio = partes[1].length === 2 ? `20${partes[1]}` : partes[1];
  return `${partes[0].padStart(2, '0')}-${anio}`;
}

/**
 * Analizador de texto clínico basado en patrones Regex
 */
function analizarTextoClinico(textoCompleto) {
  const texto = textoCompleto.replace(/\r\n/g, '\n');
  const resultado = {
    insumo: null,
    cantidad: null,
    lote: null,
    vencimiento: null,
    fabricacion: null,
    fabricante: null
  };

  // 1. LOTE
  const regexLote = /(?:LOTE(?:\s*N[°º.]?)?|LOT[\s.:#-]*)\s*([A-Z0-9\-_]{3,25})/i;
  const matchLote = texto.match(regexLote);
  if (matchLote && matchLote[1]) {
    resultado.lote = matchLote[1].trim().toUpperCase();
  }

  // 2. VENCIMIENTO
  const regexVence = /(?:EXP\.?\s*DATE|FECHA\s*(?:DE\s*)?VENC(?:IMIENTO|E)?|VENCE|VTO)[\s.:#-]*([0-1]?[0-9][\/\-\.](?:20\d{2}|\d{2})|(?:20\d{2})[\/\-\.][0-1]?[0-9])/i;
  const matchVence = texto.match(regexVence);
  if (matchVence && matchVence[1]) {
    resultado.vencimiento = normalizarFecha(matchVence[1]);
  }

  // 3. FABRICACIÓN
  const regexFab = /(?:MFG(?:\.?\s*DATE)?|FECHA\s*(?:DE\s*)?FAB(?:RICACI[OÓ]N)?|FAB)[\s.:#-]*([0-1]?[0-9][\/\-\.](?:20\d{2}|\d{2})|(?:20\d{2})[\/\-\.][0-1]?[0-9])/i;
  const matchFab = texto.match(regexFab);
  if (matchFab && matchFab[1]) {
    resultado.fabricacion = normalizarFecha(matchFab[1]);
  }

  // 4. CANTIDADES (Multiplicador o Directo)
  const regexMultiplicador = /\b(\d+)\s*[xX*]\s*(\d+)\b/;
  const regexQty = /(?:Qty|Cantidad|Cant|Cont\.?(?:enido)?)\s*[:#\-]?\s*(\d+)(?:\s*(?:pcs|piezas|unidades|und|u\b))?/i;

  const matchMultiplicador = texto.match(regexMultiplicador);
  if (matchMultiplicador) {
    const f1 = parseInt(matchMultiplicador[1], 10);
    const f2 = parseInt(matchMultiplicador[2], 10);
    resultado.cantidad = (f1 * f2).toString();
  } else {
    const matchQty = texto.match(regexQty);
    if (matchQty && matchQty[1]) {
      resultado.cantidad = matchQty[1].trim();
    }
  }

  // 5. FABRICANTE
  const regexFabricante = /(?:FABRICADO\s*POR|MANUFACTURED\s*BY|MFR|LABORATORIO|LAB)[\s.:#-]+([A-Z0-9\s.,&'-]{3,35})/i;
  const matchFabr = texto.match(regexFabricante);
  if (matchFabr && matchFabr[1]) {
    resultado.fabricante = matchFabr[1].split('\n')[0].trim().toUpperCase();
  }

  // 6. INSUMO (Heurística de texto principal)
  const lineas = texto.split('\n').map(l => l.trim()).filter(l => l.length > 3);
  for (const linea of lineas) {
    const esMeta = /(LOTE|LOT|EXP|VENC|MFG|FAB|QTY|CANTIDAD|MADE IN|REF|CAT)/i.test(linea);
    if (!esMeta && !resultado.insumo) {
      resultado.insumo = linea.toUpperCase();
      break;
    }
  }

  return resultado;
}

/**
 * Cloud Function HTTP expuesta
 */
exports.detectarEtiquetaClinica = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 60, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    // Manejo de CORS
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ success: false, error: 'Método no permitido. Use POST.' });
      return;
    }

    try {
      const { imageBase64 } = req.body;
      if (!imageBase64) {
        res.status(400).json({ success: false, error: 'Falta el parámetro imageBase64.' });
        return;
      }

      // Remover cabecera base64 si viene con data:image/...
      const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const imageBuffer = Buffer.from(cleanBase64, 'base64');

      // Llamada a Google Cloud Vision API
      const [visionResult] = await client.documentTextDetection(imageBuffer);
      const fullText = visionResult.fullTextAnnotation ? visionResult.fullTextAnnotation.text : '';

      if (!fullText) {
        res.json({
          success: true,
          mensaje: 'No se detectó texto en la imagen.',
          datos: { insumo: null, cantidad: null, lote: null, vencimiento: null, fabricacion: null, fabricante: null },
          rawText: ''
        });
        return;
      }

      const datosExtraidos = analizarTextoClinico(fullText);

      res.json({
        success: true,
        datos: datosExtraidos,
        rawText: fullText
      });
    } catch (error) {
      console.error('[Cloud Function OCR Error]:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });


/**
 * ============================================================================
 * CLOUD FUNCTION: EXTRACCIÓN MULTIMODAL DE FACTURAS DE OXÍGENO (GEMINI VISION)
 * ============================================================================
 * Recibe una imagen o página de PDF en base64 (incluso rotada/escaneada) y
 * consulta la API de Gemini Vision con respuesta JSON estricta.
 * La clave se lee únicamente desde variable de entorno GEMINI_API_KEY
 * (o functions.config().gemini.api_key). Cero credenciales en el repositorio.
 */
exports.extraerFacturaOxigeno = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 60, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ success: false, error: 'Método no permitido. Use POST.' });
      return;
    }

    try {
      const apiKey = process.env.GEMINI_API_KEY || (functions.config().gemini && functions.config().gemini.api_key);
      if (!apiKey) {
        res.status(503).json({ success: false, error: 'Falta configurar GEMINI_API_KEY en el entorno de Cloud Functions.' });
        return;
      }

      const { imageBase64, mimeType } = req.body || {};
      if (!imageBase64) {
        res.status(400).json({ success: false, error: 'Falta el parámetro imageBase64.' });
        return;
      }

      const cleanBase64 = String(imageBase64).replace(/^data:[^;]+;base64,/, '');
      const mime = mimeType || 'image/jpeg';
      const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

      const prompt = [
        'Eres un extractor contable experto en Facturas Electrónicas SII Chile para servicios de oxígeno medicinal.',
        'La imagen puede venir escaneada o rotada (incluso 180°). Lee el documento completo y responde EXCLUSIVAMENTE un objeto JSON válido sin markdown ni texto adicional, con exactamente estas claves:',
        '{',
        '  "razonSocial": string,',
        '  "rutEmisor": string,',
        '  "folio": string,',
        '  "fechaEmision": "YYYY-MM-DD",',
        '  "fechaVencimiento": "YYYY-MM-DD",',
        '  "numeroOC": string,',
        '  "facturaSAP": string,',
        '  "reemplazaFactura": string,',
        '  "periodoServicio": "YYYY-MM",',
        '  "tipoServicio": "ARRIENDO" | "RECARGA" | "MIXTO",',
        '  "items": [{ "codigo": string, "descripcion": string, "cantidad": number, "unidad": string, "valorUnitario": number, "valorTotal": number }],',
        '  "neto": number,',
        '  "iva": number,',
        '  "totalBruto": number',
        '}',
        'Reglas: detecta tipoServicio como ARRIENDO si menciona RENTAL/ARRIENDO/RENTA/DIAS-CILINDRO, RECARGA si menciona RECARGA/OXIGENO/M3/GAS, o MIXTO si contiene ambos. Todos los montos en pesos chilenos enteros (sin puntos ni signo $). Si un campo no aparece, usa "" o 0 o [].'
      ].join('\n');

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const apiResp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mime, data: cleanBase64 } }
            ]
          }],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json'
          }
        })
      });

      if (!apiResp.ok) {
        const errTxt = await apiResp.text();
        res.status(502).json({ success: false, error: `Gemini API HTTP ${apiResp.status}: ${errTxt.slice(0, 300)}` });
        return;
      }

      const payload = await apiResp.json();
      const rawText = payload && payload.candidates && payload.candidates[0] && payload.candidates[0].content && payload.candidates[0].content.parts && payload.candidates[0].content.parts[0]
        ? payload.candidates[0].content.parts[0].text
        : '';

      if (!rawText) {
        res.status(502).json({ success: false, error: 'Gemini no devolvió contenido JSON.' });
        return;
      }

      const cleanJson = rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
      const datos = JSON.parse(cleanJson);
      res.json({ success: true, datos });
    } catch (error) {
      console.error('[extraerFacturaOxigeno Error]:', error);
      res.status(500).json({ success: false, error: error.message || String(error) });
    }
  });
