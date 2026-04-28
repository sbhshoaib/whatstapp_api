const express = require("express")
const fs = require("fs")
const QRCode = require("qrcode")

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys")

const app = express()
app.use(express.json())

let sock = null
let contacts = {}

// 🧠 message save
function saveMessage(text) {
    let data = ""

    if (fs.existsSync("messages.txt")) {
        data = fs.readFileSync("messages.txt", "utf-8")
    }

    let lines = data.split("\n").filter(Boolean)

    lines.push(text)

    if (lines.length > 50) {
        lines = lines.slice(-50)
    }

    fs.writeFileSync("messages.txt", lines.join("\n") + "\n")
}

// 🧠 sleep system
let sleepTimer = null
function resetSleepTimer() {
    if (sleepTimer) clearTimeout(sleepTimer)

    sleepTimer = setTimeout(() => {
        console.log("😴 Sleeping (safe mode)...")

        if (sock) {
            try {
                sock.end()
                sock = null
            } catch (e) {}
        }

    }, 15000)
}

// 🚀 start bot
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth")
    const { version } = await fetchLatestBaileysVersion()

    sock = makeWASocket({
        version,
        auth: state,
        browser: ["Railway", "Chrome", "1.0.0"]
    })

    sock.ev.on("creds.update", saveCreds)

    // contacts
    sock.ev.on("contacts.upsert", (data) => {
        data.forEach(c => {
            if (c.id) {
                contacts[c.id] = c.notify || c.name || c.id
            }
        })
    })

    // connection
    sock.ev.on("connection.update", async (update) => {
        const { connection, qr, lastDisconnect } = update

        if (qr) {
            await QRCode.toFile("qr.png", qr)
        }

        if (connection === "open") {
            console.log("✅ WhatsApp Connected")
            if (fs.existsSync("qr.png")) fs.unlinkSync("qr.png")
        }

        if (connection === "close") {
            const reason = lastDisconnect?.error?.output?.statusCode

            if (reason !== DisconnectReason.loggedOut) {
                setTimeout(startBot, 5000)
            }
        }
    })

    // incoming message
    sock.ev.on("messages.upsert", async (m) => {
        try {
            const msg = m.messages[0]
            if (!msg.message) return
            if (msg.key.fromMe) return

            const sender = msg.key.remoteJid
            let number = sender

            if (contacts[sender]) {
                number = contacts[sender]
            } else if (sender.includes("@s.whatsapp.net")) {
                number = sender.split("@")[0]
                if (number.startsWith("880")) {
                    number = "+" + number
                }
            } else if (sender.includes("@lid")) {
                number = "Hidden User"
            }

            const text =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                "Media message"

            console.log("📩", number, ":", text)

            saveMessage(`${number} : ${text}`)

            if (text.toLowerCase() === "hi" || text.toLowerCase() === "hello") {
                await sock.sendMessage(sender, {
                    text: "Hello bro 👋"
                })
            }

        } catch (err) {
            console.log(err)
        }
    })
}

startBot()

// 🌐 Home
app.get("/", (req, res) => {
    res.send("WhatsApp API Running ✅")
})

// 📱 QR
app.get("/qr", (req, res) => {
    if (fs.existsSync("qr.png")) {
        res.sendFile(__dirname + "/qr.png")
    } else {
        res.send("QR not ready")
    }
})

// 📩 Send text
app.post("/send", async (req, res) => {
    try {
        if (!sock || !sock.user) {
            return res.json({ status: false, msg: "WhatsApp not connected" })
        }

        const { number, message } = req.body

        if (!number || !message) {
            return res.json({ status: false, msg: "number & message required" })
        }

        const jid = number.includes("@s.whatsapp.net")
            ? number
            : number + "@s.whatsapp.net"

        await sock.sendMessage(jid, { text: message })

        res.json({ status: true, msg: "Message sent" })

    } catch (err) {
        res.json({ status: false, error: err.message })
    }
})

// 📄 Send document (🔥 FIXED STABLE VERSION)
app.post("/send-doc", async (req, res) => {
    try {
        if (!sock || !sock.user) {
            return res.json({ status: false, msg: "WhatsApp not connected" })
        }

        const { number, url, filename, message } = req.body

        if (!number || !url) {
            return res.json({ status: false, msg: "number & url required" })
        }

        const jid = number.includes("@s.whatsapp.net")
            ? number
            : number + "@s.whatsapp.net"

        // ✅ 1. document send
        await sock.sendMessage(jid, {
            document: { url },
            mimetype: "application/pdf",
            fileName: filename || "file.pdf"
        })

        // ✅ 2. message send (separate)
        if (message) {
            await new Promise(r => setTimeout(r, 500))

            await sock.sendMessage(jid, {
                text: message
            })
        }

        res.json({ status: true, msg: "Document + message sent" })

    } catch (err) {
        res.json({ status: false, error: err.message })
    }
})

// 📜 View messages
app.get("/messages", (req, res) => {
    if (fs.existsSync("messages.txt")) {
        const data = fs.readFileSync("messages.txt", "utf-8")
        res.send(`<pre>${data}</pre>`)
    } else {
        res.send("No messages yet")
    }
})

// 🧹 Clear
app.get("/clear", (req, res) => {
    fs.writeFileSync("messages.txt", "")
    res.send("Messages cleared ✅")
})

// 🔐 Logout
app.get("/logout", async (req, res) => {
    if (sock) await sock.logout()
    if (fs.existsSync("auth")) fs.rmSync("auth", { recursive: true, force: true })
    res.send("Logged out")
})

// 🧪 Check
app.get("/check", (req, res) => {
    res.send("NEW CODE ACTIVE")
})

app.listen(3000, () => {
    console.log("Server running on port 3000")
})
