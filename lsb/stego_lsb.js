// ============================================================
// Стеганография LSB (младшие биты пикселей) с тройным повторением длины
// Работает на изображениях любого размера (устойчива к цветокоррекции)
// ============================================================

/**
 * Преобразует строку в битовый массив (без маркеров)
 */
function textToBits(text) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    const bits = [];
    for (let b of bytes) {
        for (let i = 7; i >= 0; i--) {
            bits.push((b >> i) & 1);
        }
    }
    return bits;
}

/**
 * Преобразует битовый массив в строку
 */
function bitsToText(bits) {
    const bytes = [];
    for (let i = 0; i < bits.length; i += 8) {
        if (i + 8 > bits.length) break;
        let byte = 0;
        for (let j = 0; j < 8; j++) {
            byte = (byte << 1) | (bits[i + j] || 0);
        }
        bytes.push(byte);
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
}

/**
 * Встраивание текста в PNG через LSB.
 * Длина данных записывается с тройным повторением в первых 32 пикселях (96 бит).
 * Это обеспечивает устойчивость к единичным ошибкам.
 */
async function embedTextToPNG(imageFile, text) {
    const bitmap = await createImageBitmap(imageFile, { colorSpaceConversion: 'none' });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    const bits = textToBits(text);
    const totalBits = data.length / 4 * 3; // RGB каналы
    // 32 бита длины + сама длина * 8 бит
    if (bits.length + 32 > totalBits) {
        throw new Error(`Недостаточно места. Нужно ${bits.length + 32} бит, доступно ${totalBits}.`);
    }

    // ---- Подготавливаем биты длины (4 байта) ----
    const len = bits.length;
    const lenBytes = new Uint8Array(4);
    lenBytes[0] = (len >> 24) & 0xFF;
    lenBytes[1] = (len >> 16) & 0xFF;
    lenBytes[2] = (len >> 8) & 0xFF;
    lenBytes[3] = len & 0xFF;
    const lenBits = [];
    for (let b of lenBytes) {
        for (let i = 7; i >= 0; i--) {
            lenBits.push((b >> i) & 1);
        }
    }

    // Повторяем каждый бит длины 3 раза (избыточность)
    const repeatedLenBits = [];
    for (let bit of lenBits) {
        repeatedLenBits.push(bit, bit, bit);
    }

    // ---- Встраиваем повторённую длину в первые 96 бит (32 пикселя) ----
    let bitIndex = 0;
    for (let i = 0; i < data.length && bitIndex < repeatedLenBits.length; i += 4) {
        for (let ch = 0; ch < 3 && bitIndex < repeatedLenBits.length; ch++) {
            data[i + ch] = (data[i + ch] & 0xFE) | repeatedLenBits[bitIndex++];
        }
    }

    // ---- Встраиваем сами данные (начиная с 33-го пикселя) ----
    let dataBitIndex = 0;
    for (let i = 0; i < data.length && dataBitIndex < bits.length; i += 4) {
        // Пропускаем первые 32 пикселя (96 бит) – они уже заняты длиной
        if (i < 32 * 4) continue;
        for (let ch = 0; ch < 3 && dataBitIndex < bits.length; ch++) {
            data[i + ch] = (data[i + ch] & 0xFE) | bits[dataBitIndex++];
        }
    }

    ctx.putImageData(imageData, 0, 0);
    return new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/png');
    });
}

/**
 * Извлечение текста из PNG через LSB.
 * Сначала читаются первые 96 бит (32 пикселя), из них голосованием большинства
 * восстанавливается длина, затем читается ровно столько бит данных.
 */
async function extractTextFromPNG(imageFile) {
    const bitmap = await createImageBitmap(imageFile, { colorSpaceConversion: 'none' });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // ---- Читаем повторённую длину (первые 96 бит = 32 пикселя) ----
    const repeatedLenBits = [];
    let bitCount = 0;
    for (let i = 0; i < data.length && bitCount < 96; i += 4) {
        for (let ch = 0; ch < 3 && bitCount < 96; ch++) {
            repeatedLenBits.push(data[i + ch] & 1);
            bitCount++;
        }
    }
    if (bitCount < 96) {
        throw new Error('Недостаточно пикселей для чтения длины (нужно 32 пикселя)');
    }

    // Восстанавливаем длину голосованием большинства по тройкам
    const lenBits = [];
    for (let i = 0; i < repeatedLenBits.length; i += 3) {
        const a = repeatedLenBits[i];
        const b = repeatedLenBits[i+1];
        const c = repeatedLenBits[i+2];
        const bit = (a + b + c) >= 2 ? 1 : 0;
        lenBits.push(bit);
    }
    // Преобразуем 32 бита в число
    let dataLen = 0;
    for (let i = 0; i < 32; i++) {
        dataLen = (dataLen << 1) | lenBits[i];
    }
    console.log('extractTextFromPNG: восстановленная длина (бит):', dataLen);

    if (dataLen <= 0 || dataLen > 10000000) {
        throw new Error('Некорректная длина (возможно, изображение повреждено)');
    }

    // ---- Читаем ровно dataLen бит данных, начиная с позиции после длины ----
    const dataBits = [];
    let readBits = 0;
    let pixelIndex = 32; // начиная с 33-го пикселя (индекс 32)
    while (readBits < dataLen && pixelIndex < data.length / 4) {
        const base = pixelIndex * 4;
        for (let ch = 0; ch < 3 && readBits < dataLen; ch++) {
            dataBits.push(data[base + ch] & 1);
            readBits++;
        }
        pixelIndex++;
    }
    if (readBits < dataLen) {
        throw new Error(`Недостаточно пикселей для данных: нужно ${dataLen} бит, доступно ${readBits}`);
    }

    // Преобразуем биты в текст
    const text = bitsToText(dataBits);
    console.log('extractTextFromPNG: извлечённый текст (первые 200 символов):', text.slice(0, 200));
    return text;
}

// Экспортируем функции в глобальную область для использования в HTML
window.embedTextToPNG = embedTextToPNG;
window.extractTextFromPNG = extractTextFromPNG;