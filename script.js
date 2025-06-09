class SerialDeviceTester {
    constructor() {
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.isReading = false;
        this.deviceAddress = 1;
        this.timeout = 2000; // 2 seconds timeout
        this.currentRequest = null;
        this.registerQueue = [];
        this.currentRegisterIndex = 0;
        
        // Регистры для чтения (адрес, длина, тип, название)
        this.registersToRead = [
            { address: 0x0000, length: 1, type: 'uint16', name: 'deviceId' },
            { address: 0x010C, length: 1, type: 'uint16', name: 'stopReason' },
            { address: 0x010F, length: 1, type: 'status', name: 'deviceStatus' },
            { address: 0x0110, length: 6, type: 'string12', name: 'totalVolume' },
            { address: 0x011D, length: 6, type: 'string12', name: 'totalMass' },
            { address: 0x0116, length: 4, type: 'string8', name: 'currentVolumeDose' },
            { address: 0x011A, length: 3, type: 'string6', name: 'volumeFlow' },
            { address: 0x0123, length: 4, type: 'string8', name: 'currentMassDose' },
            { address: 0x012A, length: 3, type: 'string6', name: 'massFlow' },
            { address: 0x0127, length: 2, type: 'float32', name: 'density' }
        ];
        
        // DOM elements
        this.connectBtn = document.getElementById('connectBtn');
        this.startBtn = document.getElementById('startBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.setVolumeDoseBtn = document.getElementById('setVolumeDose');
        this.setMassDoseBtn = document.getElementById('setMassDose');
        this.logOutput = document.getElementById('logOutput');
        this.statusTable = document.getElementById('statusTable');
        this.volumeDoseInput = document.getElementById('volumeDose');
        this.massDoseInput = document.getElementById('massDose');
        
        // Register event listeners
        this.connectBtn.addEventListener('click', () => this.toggleConnection());
        this.startBtn.addEventListener('click', () => this.writeStartCommand());
        this.stopBtn.addEventListener('click', () => this.writeStopCommand());
        this.setVolumeDoseBtn.addEventListener('click', () => this.setVolumeDose());
        this.setMassDoseBtn.addEventListener('click', () => this.setMassDose());
        
        // Initialize status table
        this.initializeStatusTable();
        
        // Start reading loop if already connected
        this.readRegisterLoop();
    }
    
    initializeStatusTable() {
        const statusItems = [
            { id: 'deviceId', label: 'ID устройства', value: '-' },
            { id: 'stopReason', label: 'Причина останова', value: '-' },
            { id: 'deviceStatus', label: 'Состояние', value: '-' },
            { id: 'totalVolume', label: 'Объем сумм', value: '-' },
            { id: 'totalMass', label: 'Масса сумм', value: '-' },
            { id: 'currentVolumeDose', label: 'Текущая доза объем', value: '-' },
            { id: 'volumeFlow', label: 'Расход объем', value: '-' },
            { id: 'currentMassDose', label: 'Текущая доза масса', value: '-' },
            { id: 'massFlow', label: 'Расход масса', value: '-' },
            { id: 'density', label: 'Плотность', value: '-' }
        ];
        
        this.statusTable.innerHTML = '';
        statusItems.forEach(item => {
            const div = document.createElement('div');
            div.className = 'status-item';
            div.innerHTML = `<span class="status-label">${item.label}:</span> <span id="${item.id}" class="status-text">${item.value}</span>`;
            this.statusTable.appendChild(div);
        });
    }
    
    async toggleConnection() {
        if (this.port) {
            await this.disconnect();
        } else {
            await this.connect();
        }
    }
    
    async connect() {
        try {
            // Get device address from input
            this.deviceAddress = parseInt(document.getElementById('deviceAddress').value) || 1;
            
            // Request serial port
            this.port = await navigator.serial.requestPort();
            
            // Get port settings from UI
            const baudRate = parseInt(document.getElementById('baudRate').value) || 115200;
            const parity = document.getElementById('parity').value;
            
            // Configure port
            await this.port.open({ baudRate, parity });
            
            // Update UI
            this.connectBtn.textContent = 'Отключиться';
            this.connectBtn.style.backgroundColor = '#f44336';
            this.log('Успешное подключение к порту');
            
            // Start reading loop
            this.readRegisterLoop();
            
        } catch (error) {
            this.log(`Ошибка подключения: ${error.message}`);
        }
    }
    
    async disconnect() {
        try {
            if (this.reader) {
                await this.reader.cancel();
            }
            
            if (this.writer) {
                await this.writer.close();
            }
            
            if (this.port) {
                await this.port.close();
            }
            
            this.port = null;
            this.reader = null;
            this.writer = null;
            
            // Update UI
            this.connectBtn.textContent = 'Подключиться';
            this.connectBtn.style.backgroundColor = '#4CAF50';
            this.log('Отключено от порта');
            
        } catch (error) {
            this.log(`Ошибка отключения: ${error.message}`);
        }
    }
    
    async readRegisterLoop() {
        if (!this.port || this.isReading) return;
        
        // Если очередь пустая, заполняем ее всеми регистрами
        if (this.registerQueue.length === 0) {
            this.registerQueue = [...this.registersToRead];
        }
        
        // Берем следующий регистр из очереди
        const register = this.registerQueue.shift();
        this.isReading = true;
        
        try {
            const response = await this.readHoldingRegisters(register.address, register.length);
            if (response) {
                this.processRegisterResponse(register, response);
            }
        } catch (error) {
            this.log(`Ошибка чтения регистра ${register.address.toString(16)}: ${error.message}`);
        } finally {
            this.isReading = false;
            
            // Запланировать следующее чтение
            if (this.port) {
                setTimeout(() => this.readRegisterLoop(), 300);
            }
        }
    }
    
    processRegisterResponse(register, response) {
        // Проверяем, что ответ соответствует ожидаемой длине
        if (response.length < 5 + register.length * 2) {
            this.log(`Неверная длина ответа для регистра ${register.address.toString(16)}`);
            return;
        }
        
        // Извлекаем данные регистров из ответа
        const data = response.slice(3, 3 + register.length * 2);
        
        // Обрабатываем данные в зависимости от типа регистра
        switch (register.type) {
            case 'uint16':
                const uint16Value = (data[0] << 8) | data[1];
                document.getElementById(register.name).textContent = uint16Value;
                break;
                
            case 'float32':
                // Для float32 предполагаем, что читаем 2 регистра (4 байта)
                const buffer = new ArrayBuffer(4);
                const view = new DataView(buffer);
                view.setUint16(0, (data[0] << 8) | data[1]);
                view.setUint16(2, (data[2] << 8) | data[3]);
                const floatValue = view.getFloat32(0, false); // Big-endian
                document.getElementById(register.name).textContent = floatValue.toFixed(3);
                break;
                
            case 'string6':
                // 6 байт (3 регистра) в формате ASCII
                const str6 = String.fromCharCode(...data.slice(0, 6));
                document.getElementById(register.name).textContent = str6;
                break;
                
            case 'string8':
                // 8 байт (4 регистра) в формате ASCII
                const str8 = String.fromCharCode(...data.slice(0, 8));
                document.getElementById(register.name).textContent = str8;
                break;
                
            case 'string12':
                // 12 байт (6 регистров) в формате ASCII
                const str12 = String.fromCharCode(...data.slice(0, 12));
                document.getElementById(register.name).textContent = str12;
                break;
                
            case 'status':
                // Обработка статуса устройства
                const statusValue = (data[0] << 8) | data[1];
                this.updateDeviceStatus(statusValue);
                break;
                
            default:
                // По умолчанию отображаем как HEX
                const hexValue = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
                document.getElementById(register.name).textContent = hexValue;
        }
        
        this.log(`Регистр ${register.address.toString(16)}: ${document.getElementById(register.name).textContent}`);
    }
    
    updateDeviceStatus(statusValue) {
        const statusElement = document.getElementById('deviceStatus');
        let statusText = '';
        let statusClass = '';
        
        switch (statusValue) {
            case 0:
                statusText = 'Ожидание';
                statusClass = 'status-waiting';
                break;
            case 10:
                statusText = 'Разрешение';
                statusClass = 'status-ready';
                break;
            case 20:
                statusText = 'Отпуска';
                statusClass = 'status-dispensing';
                break;
            case 30:
                statusText = 'Останов (пауза)';
                statusClass = 'status-paused';
                break;
            case 40:
                statusText = 'Разрешение после останова';
                statusClass = 'status-ready-after-pause';
                break;
            case 50:
                statusText = 'ПОЛНЫЙ';
                statusClass = 'status-full';
                break;
            case 60:
                statusText = 'Ошибка';
                statusClass = 'status-error';
                break;
            default:
                statusText = `Неизвестное состояние (${statusValue})`;
                statusClass = 'status-error';
        }
        
        statusElement.textContent = statusText;
        statusElement.className = 'status-text ' + statusClass;
    }
    
    async readHoldingRegisters(startAddress, count) {
        if (!this.port || !this.port.writable || this.currentRequest) {
            this.log('Ошибка: Порт не готов или другая операция выполняется');
            return null;
        }
        
        this.currentRequest = 'read';
        
        try {
            // MODBUS RTU frame for function 03 (read holding registers)
            const frame = new Uint8Array(8);
            
            // Device address
            frame[0] = this.deviceAddress;
            
            // Function code (03)
            frame[1] = 0x03;
            
            // Starting address (big-endian)
            frame[2] = (startAddress >> 8) & 0xFF;
            frame[3] = startAddress & 0xFF;
            
            // Number of registers (big-endian)
            frame[4] = (count >> 8) & 0xFF;
            frame[5] = count & 0xFF;
            
            // Calculate CRC
            const crc = this.calculateCRC(frame.slice(0, 6));
            frame[6] = crc & 0xFF;
            frame[7] = (crc >> 8) & 0xFF;
            
            // Write to port
            this.writer = this.port.writable.getWriter();
            await this.writer.write(frame);
            await this.writer.releaseLock();
            this.writer = null;
            
            this.log(`Запрос чтения регистров ${startAddress.toString(16)}-${(startAddress + count - 1).toString(16)}`);
            
            // Wait for response with timeout
            return await this.waitForResponse(this.timeout);
            
        } catch (error) {
            this.log(`Ошибка чтения регистров: ${error.message}`);
            return null;
        } finally {
            this.currentRequest = null;
        }
    }
    
    async writeSingleRegister(address, value) {
        if (!this.port || !this.port.writable || this.currentRequest) {
            this.log('Ошибка: Порт не готов или другая операция выполняется');
            return false;
        }
        
        this.currentRequest = 'write';
        
        try {
            // MODBUS RTU frame for function 06 (write single register)
            const frame = new Uint8Array(8);
            
            // Device address
            frame[0] = this.deviceAddress;
            
            // Function code (06)
            frame[1] = 0x06;
            
            // Register address (big-endian)
            frame[2] = (address >> 8) & 0xFF;
            frame[3] = address & 0xFF;
            
            // Value to write (big-endian)
            frame[4] = (value >> 8) & 0xFF;
            frame[5] = value & 0xFF;
            
            // Calculate CRC
            const crc = this.calculateCRC(frame.slice(0, 6));
            frame[6] = crc & 0xFF;
            frame[7] = (crc >> 8) & 0xFF;
            
            // Write to port
            this.writer = this.port.writable.getWriter();
            await this.writer.write(frame);
            await this.writer.releaseLock();
            this.writer = null;
            
            this.log(`Запись значения ${value} в регистр ${address.toString(16)}`);
            
            // Wait for response with timeout
            const response = await this.waitForResponse(this.timeout);
            return response !== null;
            
        } catch (error) {
            this.log(`Ошибка записи регистра: ${error.message}`);
            return false;
        } finally {
            this.currentRequest = null;
        }
    }
    
    async writeMultipleRegisters(address, values) {
        if (!this.port || !this.port.writable || this.currentRequest) {
            this.log('Ошибка: Порт не готов или другая операция выполняется');
            return false;
        }
        
        this.currentRequest = 'write';
        
        try {
            // MODBUS RTU frame for function 16 (write multiple registers)
            const byteCount = values.length * 2;
            const frame = new Uint8Array(9 + byteCount);
            
            // Device address
            frame[0] = this.deviceAddress;
            
            // Function code (16)
            frame[1] = 0x10;
            
            // Register address (big-endian)
            frame[2] = (address >> 8) & 0xFF;
            frame[3] = address & 0xFF;
            
            // Number of registers (big-endian)
            frame[4] = (values.length >> 8) & 0xFF;
            frame[5] = values.length & 0xFF;
            
            // Byte count
            frame[6] = byteCount;
            
            // Values
            for (let i = 0; i < values.length; i++) {
                frame[7 + i*2] = (values[i] >> 8) & 0xFF;
                frame[8 + i*2] = values[i] & 0xFF;
            }
            
            // Calculate CRC
            const crc = this.calculateCRC(frame.slice(0, 7 + byteCount));
            frame[7 + byteCount] = crc & 0xFF;
            frame[8 + byteCount] = (crc >> 8) & 0xFF;
            
            // Write to port
            this.writer = this.port.writable.getWriter();
            await this.writer.write(frame);
            await this.writer.releaseLock();
            this.writer = null;
            
            this.log(`Запись ${values.length} регистров начиная с ${address.toString(16)}`);
            
            // Wait for response with timeout
            const response = await this.waitForResponse(this.timeout);
            return response !== null;
            
        } catch (error) {
            this.log(`Ошибка записи регистров: ${error.message}`);
            return false;
        } finally {
            this.currentRequest = null;
        }
    }
    
    async waitForResponse(timeout) {
        return new Promise((resolve, reject) => {
            if (!this.port || !this.port.readable) {
                reject(new Error('Порт не доступен для чтения'));
                return;
            }
            
            const reader = this.port.readable.getReader();
            let timeoutId;
            let responseBuffer = new Uint8Array(0);
            
            const cleanup = () => {
                clearTimeout(timeoutId);
                reader.releaseLock();
            };
            
            timeoutId = setTimeout(() => {
                cleanup();
                reject(new Error('Таймаут ожидания ответа'));
            }, timeout);
            
            const readChunk = async () => {
                try {
                    const { value, done } = await reader.read();
                    if (done) {
                        cleanup();
                        resolve(null);
                        return;
                    }
                    
                    // Добавляем новые данные в буфер
                    const newBuffer = new Uint8Array(responseBuffer.length + value.length);
                    newBuffer.set(responseBuffer);
                    newBuffer.set(value, responseBuffer.length);
                    responseBuffer = newBuffer;
                    
                    // Проверяем, является ли ответ полным
                    if (this.isCompleteModbusResponse(responseBuffer)) {
                        cleanup();
                        resolve(responseBuffer);
                    } else {
                        // Читаем следующий чанк
                        readChunk();
                    }
                } catch (error) {
                    cleanup();
                    reject(error);
                }
            };
            
            readChunk();
        });
    }
    
    isCompleteModbusResponse(data) {
        if (data.length < 5) return false; // Минимальная длина ответа
        
        const functionCode = data[1];
        const expectedLength = this.getExpectedResponseLength(functionCode, data);
        
        return data.length >= expectedLength;
    }
    
    getExpectedResponseLength(functionCode, data) {
        switch (functionCode) {
            case 0x03: // Read holding registers
                if (data.length < 3) return 255; // Ждем больше данных
                const byteCount = data[2];
                return 5 + byteCount; // Адрес (1) + функция (1) + байт счетчик (1) + данные (N) + CRC (2)
                
            case 0x06: // Write single register
                return 8; // Фиксированная длина ответа
                
            case 0x10: // Write multiple registers
                return 8; // Фиксированная длина ответа
                
            default:
                return 255; // Ждем больше данных для неизвестных функций
        }
    }
    
    calculateCRC(data) {
        let crc = 0xFFFF;
        
        for (let i = 0; i < data.length; i++) {
            crc ^= data[i];
            
            for (let j = 0; j < 8; j++) {
                if (crc & 0x0001) {
                    crc = (crc >> 1) ^ 0xA001;
                } else {
                    crc = crc >> 1;
                }
            }
        }
        
        return crc;
    }
    
    async writeStartCommand() {
        const success = await this.writeSingleRegister(0x010F, 16);
        if (success) {
            this.log('Команда "Пуск" отправлена');
        } else {
            this.log('Ошибка отправки команды "Пуск"');
        }
    }
    
    async writeStopCommand() {
        const success = await this.writeSingleRegister(0x010F, 0);
        if (success) {
            this.log('Команда "Стоп" отправлена');
        } else {
            this.log('Ошибка отправки команды "Стоп"');
        }
    }
    
    async setVolumeDose() {
        const value = parseFloat(this.volumeDoseInput.value);
        if (isNaN(value)) {
            this.log('Ошибка: Некорректное значение дозы объема');
            return;
        }
        
        // Конвертируем число в строку с фиксированной длиной 12 символов
        const valueStr = value.toFixed(3).padStart(12, '0');
        
        // Разбиваем строку на 6 регистров (по 2 символа на регистр)
        const registers = [];
        for (let i = 0; i < 6; i++) {
            const char1 = valueStr.charCodeAt(i*2);
            const char2 = valueStr.charCodeAt(i*2 + 1);
            registers.push((char1 << 8) | char2);
        }
        
        // Записываем в регистры 0x012E-0x0133
        const success = await this.writeMultipleRegisters(0x012E, registers);
        
        if (success) {
            this.log(`Заданная доза объема установлена: ${value}`);
        } else {
            this.log('Ошибка установки дозы объема');
        }
    }
    
    async setMassDose() {
        const value = parseFloat(this.massDoseInput.value);
        if (isNaN(value)) {
            this.log('Ошибка: Некорректное значение дозы массы');
            return;
        }
        
        // Конвертируем число в строку с фиксированной длиной 12 символов
        const valueStr = value.toFixed(3).padStart(12, '0');
        
        // Разбиваем строку на 6 регистров (по 2 символа на регистр)
        const registers = [];
        for (let i = 0; i < 6; i++) {
            const char1 = valueStr.charCodeAt(i*2);
            const char2 = valueStr.charCodeAt(i*2 + 1);
            registers.push((char1 << 8) | char2);
        }
        
        // Записываем в регистры 0x0132-0x0137
        const success = await this.writeMultipleRegisters(0x0132, registers);
        
        if (success) {
            this.log(`Заданная доза массы установлена: ${value}`);
        } else {
            this.log('Ошибка установки дозы массы');
        }
    }
    
    log(message) {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.textContent = `[${timestamp}] ${message}`;
        this.logOutput.appendChild(logEntry);
        this.logOutput.scrollTop = this.logOutput.scrollHeight;
    }
}

// Initialize the tester when the page loads
window.addEventListener('DOMContentLoaded', () => {
    if ('serial' in navigator) {
        const tester = new SerialDeviceTester();
    } else {
        alert('Web Serial API не поддерживается в вашем браузере. Пожалуйста, используйте Chrome или Edge.');
    }
});