// Blockly is loaded via CDN in index.html and is available globally.

function initApp() {
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
    // 3. לוגיקת Web Serial (חיבור USB)
    // ==========================================

    let port = null;
    let writer = null;
    const encoder = new TextEncoder();

    const connectBtn = document.getElementById('connectBtn');
    const runBtn = document.getElementById('runBtn');
    const statusSpan = document.getElementById('status');

    async function connect() {
        try {
            if (!("serial" in navigator)) {
                alert("הדפדפן שלך לא תומך ב-Web Serial API. נא להשתמש ב-Chrome או Edge עדכניים.");
                return;
            }

            console.log("מבקש מהמשתמש לבחור יציאה טורית...");
            port = await navigator.serial.requestPort({
                // פילטר עבור Micro:bit (יצרן ARM)
                filters: [{ usbVendorId: 0x0d28 }]
            });
            
            // פותחים את החיבור
            await port.open({ baudRate: 115200 });
            
            writer = port.writable.getWriter();
            
            onConnected();

        } catch (error) {
            if (error.name === 'NotFoundError') {
                console.log('המשתמש ביטל את בחירת היציאה.');
                return;
            }
            console.error('שגיאה בהתחברות:', error);
            alert('ההתחברות נכשלה: ' + error.message);
            onDisconnected();
        }
    }

    async function disconnect() {
        if (writer) {
            try {
                await writer.releaseLock();
            } catch (e) {
                console.error("שגיאה בשחרור נעילה:", e);
            }
        }
        if (port) {
            try {
                await port.close();
            } catch (e) {
                console.error("שגיאה בסגירת פורט:", e);
            }
        }
        
        onDisconnected();
        console.log("החיבור נותק.");
    }

    if (connectBtn) {
        connectBtn.addEventListener('click', async () => {
            if (port) { // אם כבר מחובר, נתק
                await disconnect();
            } else { // אם מנותק, חבר
                await connect();
            }
        });
    }

    function onConnected() {
        if (statusSpan) {
            statusSpan.innerText = '🟢 מחובר!';
            statusSpan.classList.add('connected');
        }
        if (connectBtn) {
            connectBtn.innerText = '🔌 נתק חיבור';
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
            connectBtn.innerText = '🔌 התחבר עם כבל USB';
        }
        if (runBtn) {
            runBtn.disabled = true;
        }
        writer = null;
        port = null;
    }

    // ==========================================
    // 4. פונקציות עזר להרצה (Runtime)
    // ==========================================

    // פונקציה ששולחת טקסט למיקרוביט
    async function sendCommand(cmd) {
        if (!writer) {
            console.warn("לא מחובר, הפקודה לא נשלחה:", cmd);
            return;
        }
        try {
            // הוספת תו ירידת שורה (\n) בסוף הפקודה היא קריטית לפרוטוקול UART
            await writer.write(encoder.encode(cmd + "\n"));
            console.log("נשלח למיקרוביט:", cmd);
        } catch (err) {
            console.error("שגיאה בשליחה:", err);
            alert("שגיאה בשליחת נתונים. ייתכן שההתקן נותק.");
            disconnect(); // נתק באופן יזום אם יש שגיאת כתיבה
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
