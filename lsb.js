        // ==================== БАЗОВЫЕ ФУНКЦИИ (Base85, крипто) ====================
        const B85_CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#";

        function toBase85(wordArray) {
            const words = wordArray.words;
            const sigBytes = wordArray.sigBytes;
            let base85Str = "";
            const padding = (4 - (sigBytes % 4)) % 4;
            const totalBytes = sigBytes + padding;
            for (let i = 0; i < totalBytes; i += 4) {
                const wIdx = i >>> 2;
                const word = words[wIdx] || 0;
                let b1 = (word >>> 24) & 0xff;
                let b2 = (word >>> 16) & 0xff;
                let b3 = (word >>> 8) & 0xff;
                let b4 = word & 0xff;
                if (i + 1 >= sigBytes && padding > 2) b2 = 0;
                if (i + 2 >= sigBytes && padding > 1) b3 = 0;
                if (i + 3 >= sigBytes && padding > 0) b4 = 0;
                let val = ((b1 << 24) >>> 0) + (b2 << 16) + (b3 << 8) + b4;
                let chunk = "";
                for (let j = 0; j < 5; j++) {
                    chunk = B85_CHARS[val % 85] + chunk;
                    val = Math.floor(val / 85);
                }
                base85Str += chunk;
            }
            return base85Str + padding;
        }

        function fromBase85(str) {
            if (!str || typeof str !== 'string') return CryptoJS.lib.WordArray.create();
            str = str.trim();
            if (str.length === 0) return CryptoJS.lib.WordArray.create();
            const lastChar = str.slice(-1);
            if (!/^[0-4]$/.test(lastChar)) throw new Error('Некорректный паддинг в Base85 строке');
            const padding = parseInt(lastChar, 10);
            const b85Data = str.slice(0, -1);
            if (b85Data.length % 5 !== 0) throw new Error('Неверная длина Base85 данных');
            const words = [];
            for (let i = 0; i < b85Data.length; i += 5) {
                let val = 0;
                for (let j = 0; j < 5; j++) {
                    const code = B85_CHARS.indexOf(b85Data[i + j]);
                    if (code === -1) throw new Error(`Недопустимый символ '${b85Data[i + j]}'`);
                    val = val * 85 + code;
                }
                words.push(val | 0);
            }
            const sigBytes = (words.length * 4) - padding;
            if (sigBytes < 0) throw new Error('Паддинг превышает размер данных');
            return CryptoJS.lib.WordArray.create(words, sigBytes);
        }

        function arrayBufferToWordArray(ab) {
            const u8 = new Uint8Array(ab);
            const words = [];
            for (let i = 0; i < u8.length; i++) {
                words[i >>> 2] |= u8[i] << (24 - (i % 4) * 8);
            }
            return CryptoJS.lib.WordArray.create(words, u8.length);
        }

        function wordArrayToUint8Array(wordArray) {
            const words = wordArray.words;
            const sigBytes = wordArray.sigBytes;
            const u8 = new Uint8Array(sigBytes);
            for (let i = 0; i < sigBytes; i++) {
                u8[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
            }
            return u8;
        }

        // ==================== ШИФРОВАНИЕ / ДЕШИФРОВАНИЕ ТЕКСТА ====================

        async function encryptText() {
            const inputText = document.getElementById('inputText').value;
            const password = document.getElementById('key').value;
            if (!inputText || !password) { alert("Введите текст и ключ."); return; }
            try {
                const salt = CryptoJS.lib.WordArray.random(16);
                const iv = CryptoJS.lib.WordArray.random(16);
                const key = CryptoJS.PBKDF2(password, salt, {
                    keySize: 256 / 32,
                    iterations: 100000,
                    hasher: CryptoJS.algo.SHA256
                });
                const encrypted = CryptoJS.AES.encrypt(inputText, key, {
                    iv: iv,
                    mode: CryptoJS.mode.CBC,
                    padding: CryptoJS.pad.Pkcs7
                });
                const combined = salt.clone().concat(iv).concat(encrypted.ciphertext);
                const result = toBase85(combined);
                document.getElementById('resultText').value = result;
                updateCharCount();
                document.getElementById('inputText').value = "";
            } catch (e) {
                alert("Ошибка шифрования: " + e.message);
            }
        }

        async function decryptText() {
            const input = document.getElementById('inputText').value.trim();
            const password = document.getElementById('key').value;
            if (!input || !password) { alert("Введите текст и ключ для дешифрования."); return; }
            try {
                const combined = fromBase85(input);
                const salt = CryptoJS.lib.WordArray.create(combined.words.slice(0, 4), 16);
                const iv = CryptoJS.lib.WordArray.create(combined.words.slice(4, 8), 16);
                const cipherBytes = CryptoJS.lib.WordArray.create(combined.words.slice(8), combined.sigBytes - 32);
                const key = CryptoJS.PBKDF2(password, salt, {
                    keySize: 256 / 32,
                    iterations: 100000,
                    hasher: CryptoJS.algo.SHA256
                });
                const decrypted = CryptoJS.AES.decrypt(
                    { ciphertext: cipherBytes },
                    key,
                    { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
                );
                const originalText = decrypted.toString(CryptoJS.enc.Utf8);
                if (originalText) {
                    document.getElementById('resultText').value = originalText;
                    updateCharCount();
                } else {
                    alert("Неверный ключ или данные повреждены.");
                }
            } catch (e) {
                alert("Ошибка дешифрования: " + e.message);
            }
        }

        // ==================== ШИФРОВАНИЕ ФАЙЛОВ ====================

        async function encryptFile() {
            const file = document.getElementById('fileInput').files[0];
            const password = document.getElementById('key').value;
            if (!file || !password) { alert("Выберите файл и введите ключ."); return; }
            try {
                const buffer = await file.arrayBuffer();
                const salt = CryptoJS.lib.WordArray.random(16);
                const iv = CryptoJS.lib.WordArray.random(16);
                const key = CryptoJS.PBKDF2(password, salt, {
                    keySize: 256 / 32,
                    iterations: 100000,
                    hasher: CryptoJS.algo.SHA256
                });
                const fileNameBytes = new TextEncoder().encode(file.name);
                const fileData = new Uint8Array(buffer);
                const metaLength = fileNameBytes.length;
                const combinedData = new Uint8Array(2 + metaLength + fileData.length);
                combinedData[0] = (metaLength >> 8) & 0xff;
                combinedData[1] = metaLength & 0xff;
                combinedData.set(fileNameBytes, 2);
                combinedData.set(fileData, 2 + metaLength);
                const encrypted = CryptoJS.AES.encrypt(
                    arrayBufferToWordArray(combinedData.buffer),
                    key,
                    { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
                );
                const finalData = salt.clone().concat(iv).concat(encrypted.ciphertext);
                const encText = toBase85(finalData);
                const blob = new Blob([encText], { type: 'application/octet-stream' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = file.name + ".enc";
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                alert("Файл успешно зашифрован.");
            } catch (e) {
                alert("Ошибка: " + e.message);
            }
        }

        async function decryptFile() {
            const file = document.getElementById('fileInput').files[0];
            const password = document.getElementById('key').value;
            if (!file || !password) { alert("Выберите .enc файл и введите ключ."); return; }
            if (!file.name.endsWith(".enc")) { alert("Разрешены только файлы .enc"); return; }
            try {
                const encryptedText = await file.text();
                const combined = fromBase85(encryptedText.trim());
                const salt = CryptoJS.lib.WordArray.create(combined.words.slice(0, 4), 16);
                const iv = CryptoJS.lib.WordArray.create(combined.words.slice(4, 8), 16);
                const cipherText = CryptoJS.lib.WordArray.create(combined.words.slice(8), combined.sigBytes - 32);
                const key = CryptoJS.PBKDF2(password, salt, {
                    keySize: 256 / 32,
                    iterations: 100000,
                    hasher: CryptoJS.algo.SHA256
                });
                const decrypted = CryptoJS.AES.decrypt(
                    { ciphertext: cipherText },
                    key,
                    { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
                );
                const bytes = wordArrayToUint8Array(decrypted);
                const fileNameLength = (bytes[0] << 8) | bytes[1];
                const fileName = new TextDecoder().decode(bytes.slice(2, 2 + fileNameLength));
                const fileContent = bytes.slice(2 + fileNameLength);
                const blob = new Blob([fileContent]);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                alert("Файл успешно дешифрован.");
            } catch (e) {
                alert("Неверный ключ или файл повреждён.");
            }
        }

        function updateCharCount() {
            const result = document.getElementById('resultText').value;
            document.getElementById('charCount').textContent = `Символов: ${result.length.toLocaleString('ru-RU')}`;
        }

        function downloadResultFile() {
            const result = document.getElementById('resultText').value;
            if (!result) { alert("Результат пуст."); return; }
            const blob = new Blob([result], { type: 'text/plain;charset=utf-8' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `result_${new Date().toISOString().slice(0, 10)}.txt`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        }

        function copyToClipboard() {
            const resultTextarea = document.getElementById('resultText');
            resultTextarea.select();
            document.execCommand('copy');
            alert('Результат скопирован в буфер обмена!');
        }

        // ==================== ФУНКЦИЯ РАСШИФРОВКИ Base85 (используется стегано) ====================
        // Явно объявляем, чтобы была доступна
        function decryptBase85(base85text, password) {
            if (!base85text || typeof base85text !== 'string') {
                throw new Error('Извлечённый текст пуст или не является строкой');
            }
            try {
                const combined = fromBase85(base85text);
                if (combined.sigBytes < 32) {
                    throw new Error('Недостаточно данных для соли и IV');
                }
                const salt = CryptoJS.lib.WordArray.create(combined.words.slice(0, 4), 16);
                const iv = CryptoJS.lib.WordArray.create(combined.words.slice(4, 8), 16);
                const cipherBytes = CryptoJS.lib.WordArray.create(combined.words.slice(8), combined.sigBytes - 32);
                const key = CryptoJS.PBKDF2(password, salt, {
                    keySize: 256 / 32,
                    iterations: 100000,
                    hasher: CryptoJS.algo.SHA256
                });
                const decrypted = CryptoJS.AES.decrypt(
                    { ciphertext: cipherBytes },
                    key,
                    { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
                );
                return decrypted.toString(CryptoJS.enc.Utf8);
            } catch (e) {
                throw new Error('Не удалось расшифровать: ' + e.message);
            }
        }

        // ==================== ОБРАБОТЧИКИ СТЕГАНОГРАФИИ (вызывают внешние функции) ====================

        async function hideToPNG() {
            const resultText = document.getElementById('resultText').value.trim();
            if (!resultText) {
                alert('Сначала зашифруйте текст, чтобы получить зашифрованную строку.');
                return;
            }
            const fileInput = document.getElementById('stegoFileInput');
            if (!fileInput.files || fileInput.files.length === 0) {
                alert('Выберите PNG‑файл для встраивания.');
                return;
            }
            const file = fileInput.files[0];
            if (!file.type.startsWith('image/png')) {
                alert('Поддерживаются только PNG‑изображения.');
                return;
            }
            try {
                const blob = await window.embedTextToPNG(file, resultText);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'stego_' + file.name;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                alert('Текст успешно спрятан в PNG. Файл скачан.');
            } catch (e) {
                alert('Ошибка: ' + e.message);
            }
        }

        async function extractAndDecrypt() {
            const fileInput = document.getElementById('stegoFileInput');
            if (!fileInput.files || fileInput.files.length === 0) {
                alert('Выберите PNG‑файл для извлечения.');
                return;
            }
            const file = fileInput.files[0];
            if (!file.type.startsWith('image/png')) {
                alert('Поддерживаются только PNG‑изображения.');
                return;
            }
            const password = document.getElementById('key').value.trim();
            if (!password) {
                alert('Введите ключ для расшифровки.');
                return;
            }
            try {
                const extracted = await window.extractTextFromPNG(file);
                console.log('Извлечено (сырое):', extracted);
                if (!extracted) {
                    alert('Не удалось извлечь текст из изображения.');
                    return;
                }
                // Вызываем нашу функцию decryptBase85
                const plaintext = decryptBase85(extracted, password);
                if (!plaintext) {
                    alert('Расшифровка вернула пустой результат. Проверьте ключ.');
                    return;
                }
                document.getElementById('resultText').value = plaintext;
                updateCharCount();
                alert('Текст успешно извлечён и расшифрован.');
            } catch (e) {
                alert('Ошибка: ' + e.message);
            }
        }

        // ==================== ИНИЦИАЛИЗАЦИЯ ====================
        document.addEventListener('DOMContentLoaded', function() {
            document.getElementById('resultText').addEventListener('input', updateCharCount);
        });