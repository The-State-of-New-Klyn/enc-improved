// ============================================================
// Стеганография через текстовые чанки PNG (метаданные)
// Надёжно, работает на любых PNG любого размера
// ============================================================

function makeCrcTable() {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c;
    }
    return table;
}

function crc32(data, type) {
    let crc = 0xFFFFFFFF;
    const table = makeCrcTable();
    const typeBytes = new TextEncoder().encode(type);
    const all = new Uint8Array(typeBytes.length + data.length);
    all.set(typeBytes, 0);
    all.set(data, typeBytes.length);
    for (let i = 0; i < all.length; i++) {
        crc = table[(crc ^ all[i]) & 0xFF] ^ (crc >>> 8);
    }
    return crc ^ 0xFFFFFFFF;
}

function addTextChunk(pngData, keyword, text) {
    const encoder = new TextEncoder();
    const keywordBytes = encoder.encode(keyword);
    const textBytes = encoder.encode(text);
    const chunkData = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
    chunkData.set(keywordBytes, 0);
    chunkData[keywordBytes.length] = 0;
    chunkData.set(textBytes, keywordBytes.length + 1);

    const crc = crc32(chunkData, 'tEXt');
    const chunkLength = chunkData.length;
    const lengthBytes = new Uint8Array([
        (chunkLength >> 24) & 0xFF,
        (chunkLength >> 16) & 0xFF,
        (chunkLength >> 8) & 0xFF,
        chunkLength & 0xFF
    ]);
    const typeBytes = new Uint8Array([0x74, 0x45, 0x58, 0x74]);
    const crcBytes = new Uint8Array([
        (crc >> 24) & 0xFF,
        (crc >> 16) & 0xFF,
        (crc >> 8) & 0xFF,
        crc & 0xFF
    ]);

    const newPng = new Uint8Array(8 + 12 + chunkData.length + pngData.length - 8);
    newPng.set(pngData.slice(0, 8), 0);
    let pos = 8;
    newPng.set(lengthBytes, pos); pos += 4;
    newPng.set(typeBytes, pos); pos += 4;
    newPng.set(chunkData, pos); pos += chunkData.length;
    newPng.set(crcBytes, pos); pos += 4;
    newPng.set(pngData.slice(8), pos);
    return newPng;
}

function extractTextChunk(pngData, keyword) {
    let pos = 8;
    const decoder = new TextDecoder();
    while (pos + 8 < pngData.length) {
        const length = (pngData[pos] << 24) | (pngData[pos+1] << 16) | (pngData[pos+2] << 8) | pngData[pos+3];
        const type = decoder.decode(pngData.slice(pos+4, pos+8));
        if (type === 'tEXt' || type === 'iTXt') {
            const chunkData = pngData.slice(pos+8, pos+8+length);
            const sepIndex = chunkData.indexOf(0);
            if (sepIndex !== -1) {
                const key = decoder.decode(chunkData.slice(0, sepIndex));
                const value = decoder.decode(chunkData.slice(sepIndex+1));
                if (key === keyword) {
                    return value;
                }
            }
        }
        pos += 12 + length;
    }
    return null;
}

async function embedTextToPNG(imageFile, text) {
    const arrayBuffer = await imageFile.arrayBuffer();
    const pngData = new Uint8Array(arrayBuffer);
    const newPngData = addTextChunk(pngData, 'cipher', text);
    return new Blob([newPngData], { type: 'image/png' });
}

async function extractTextFromPNG(imageFile) {
    const arrayBuffer = await imageFile.arrayBuffer();
    const pngData = new Uint8Array(arrayBuffer);
    const extracted = extractTextChunk(pngData, 'cipher');
    if (extracted === null) {
        throw new Error('Не найден чанк с данными (ключ "cipher").');
    }
    return extracted;
}

window.embedTextToPNG = embedTextToPNG;
window.extractTextFromPNG = extractTextFromPNG;