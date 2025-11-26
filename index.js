 // Blockly is loaded via CDN in index.html and is available globally.

function initApp() {
    // בדיקה אם הדפדפן תומך ואם אנחנו בסביבה מאובטחת
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        const warning = document.getElementById('https-warning');
        if (warning) warning.style.display = 'block';
    }

    // ==========================================
    // 1. הגדרת בלוקים מותאמים אישית (Custom Blocks)
    // ==========================================

    // בלוק: הדלקת/כיבוי לד
    if (!Blockly.Blocks['microbit_led']) {
        Blockly.Blocks['microbit_led'] = {
            init: function() {
                this.appendDummyInput()
                    .appendField("💡 נורות LED")
                    .appendField(new Blockly.FieldDropdown([["הדלק (לב)","ON"], ["כבה","OFF"]]), "STATE");
                this.setPreviousStatement(true, null);
                this.setNextStatement(true, null);
                this.setColour(230);
                this.setTooltip("שולח פקודה למיקרוביט להציג צורה או לכבות מסך");
            }
        };
    }

    Blockly.JavaScript['microbit_led'] = function(block) {
        var state = block.getFieldValue('STATE');
        var command = state === 'ON' ? 'LED_ON' : 'LED_OFF';
        // שימוש ב-await כדי שהפקודות יישלחו אחת אחרי השנייה ולא במכה אחת
        return 'await sendCommand("' + command + '");\n';
    };

    // בלוק: המתנה
    if (!Blockly.Blocks['microbit_wait']) {
        Blockly.Blocks['microbit_wait'] = {
            init: function() {
                this.appendDummyInput()
                    .appendField("⏳ חכה")
                    .appendField(new Blockly.FieldTextInput("1"), "SECONDS")
                    .appendField("שניות");
                this.setPreviousStatement(true, null);
                this.setNextStatement(true, null);
                this.setColour(230);
                this.setTooltip("ממתין לפני הפקודה הבאה");
            }
        };
    }

    Blockly.JavaScript['microbit_wait'] = function(block) {
        var seconds = block.getFieldValue('SECONDS');
        return 'await wait(' + seconds + ');\n';
    };

    // ==========================================
    // 2. אתחול סביבת העבודה (Workspace)
    // ==========================================
    
    var workspace = Blockly.inject('blocklyDiv', {
        toolbox: document.getElementById('toolbox'),
        scrollbars: true,
        rtl: true // כיוון מימין לשמאל
    });

    // ==========================================
    // 3. לוגיקת Web Bluetooth
    // ==========================================

    // קבועים של שירות ה-UART של Nordic
    const UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
    const UART_TX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // לכתיבה

    let bluetoothDevice = null;
    let uartCharacteristic = null;

    const connectBtn = document.getElementById('connectBtn');
    const runBtn = document.getElementById('runBtn');
    const statusSpan = document.getElementById('status');

    if (connectBtn) {
        connectBtn.addEventListener('click', async () => {
            try {
                if (!navigator.bluetooth) {
                    alert('הדפדפן שלך לא תומך ב-Web Bluetooth. נא להשתמש ב-Chrome או Edge.');
                    return;
                }

                console.log('מחפש התקן Micro:bit...');
                // שינוי: חיפוש לפי שירות ה-UART במקום לפי שם. זו שיטה אמינה יותר.
                bluetoothDevice = await navigator.bluetooth.requestDevice({
                    filters: [{
                        services: [UART_SERVICE_UUID]
                    }]
                });

                // מאזינים לניתוק
                bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);

                if (statusSpan) statusSpan.innerText = '🟡 מתחבר...';
                
                const server = await bluetoothDevice.gatt.connect();
                const service = await server.getPrimaryService(UART_SERVICE_UUID);
                uartCharacteristic = await service.getCharacteristic(UART_TX_UUID);

                onConnected();

            } catch (error) {
                // אם המשתמש סוגר את חלון בחירת ההתקן, אל תציג שגיאה
                if (error.name === 'NotFoundError') {
                    console.log('User cancelled the device selection dialog.');
                    return; // יוצאים מהפונקציה בשקט
                }

                console.error('שגיאה בהתחברות:', error);
                
                const errorMessage = error.name === 'SecurityError' && error.message.includes('permissions policy') 
                    ? 'שגיאת אבטחה (SecurityError): הגישה לבלוטות\' נחסמה על ידי מדיניות ההרשאות. אנא הרץ את היישום מחוץ לסביבת ה-Sandbox הנוכחית (כלומר, הפעל שרת מקומי ופתח בדפדפן הראשי).'
                    : 'ההתחברות נכשלה: ' + error.message;

                alert(errorMessage);
                onDisconnected();
            }
        });
    }

    function onConnected() {
        if (statusSpan) {
            statusSpan.innerText = '🟢 מחובר!';
            statusSpan.classList.add('connected');
        }
        if (connectBtn) {
            connectBtn.disabled = true;
            connectBtn.innerText = 'מחובר';
        }
        if (runBtn) {
            runBtn.disabled = false;
        }
    }

    function onDisconnected() {
        if (statusSpan) {
            statusSpan.innerText = '🔴 מנותק';
            statusSpan.classList.remove('connected');
        }
        if (connectBtn) {
            connectBtn.disabled = false;
            connectBtn.innerText = '🔌 התחבר ל-Micro:bit';
        }
        if (runBtn) {
            runBtn.disabled = true;
        }
        uartCharacteristic = null;
        bluetoothDevice = null;
    }

    // ==========================================
    // 4. פונקציות עזר להרצה (Runtime)
    // ==========================================

    // פונקציה ששולחת טקסט למיקרוביט
    async function sendCommand(cmd) {
        if (!uartCharacteristic) {
            console.warn("לא מחובר, הפקודה לא נשלחה:", cmd);
            return;
        }
        try {
            // הוספת תו ירידת שורה (\n) בסוף הפקודה היא קריטית לפרוטוקול UART
            let encoder = new TextEncoder();
            await uartCharacteristic.writeValue(encoder.encode(cmd + "\n"));
            console.log("נשלח למיקרוביט:", cmd);
        } catch (err) {
            console.error("שגיאה בשליחה:", err);
        }
    }

    // פונקציית המתנה (Promise based)
    // We expose these to the window so they can be called from the eval() context
    window.wait = function(seconds) {
        return new Promise(resolve => setTimeout(resolve, seconds * 1000));
    };
    window.sendCommand = sendCommand;

    // ==========================================
    // 5. הרצת הקוד
    // ==========================================

    if (runBtn) {
        runBtn.addEventListener('click', () => {
            // יצירת קוד JS מהבלוקים
            const code = Blockly.JavaScript.workspaceToCode(workspace);
            
            // עוטפים בפונקציה אסינכרונית כדי לאפשר שימוש ב-await (להמתנות)
            const asyncWrapper = `
            (async function() {
                try {
                    console.log("מתחיל ריצה...");
                    ${code}
                    console.log("הריצה הסתיימה.");
                } catch (e) {
                    console.error("שגיאה בזמן ריצה:", e);
                    alert("שגיאה בקוד: " + e.message);
                }
            })();
            `;

            console.log("הקוד שנוצר:\n", asyncWrapper);
            
            // הרצת הקוד בפועל
            try {
                eval(asyncWrapper); 
            } catch (e) {
                alert(e);
            }
        });
    }
}

// Run init when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
