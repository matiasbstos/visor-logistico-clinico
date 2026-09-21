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
