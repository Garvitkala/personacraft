import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("personas.db");
console.log("Database connection established: personas.db");

// Verify connection and table
try {
  const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='personas'").get();
  if (tableCheck) {
    const count = db.prepare("SELECT COUNT(*) as count FROM personas").get() as { count: number };
    console.log(`Database verified. 'personas' table exists with ${count.count} records.`);
  } else {
    console.log("Database initialized. 'personas' table will be created.");
  }
} catch (err) {
  console.error("Database verification failed:", err);
}

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS personas (
    id TEXT PRIMARY KEY,
    name TEXT,
    description TEXT,
    personality TEXT,
    avatarPrompt TEXT,
    avatarData TEXT,
    avatarFront TEXT,
    avatarBack TEXT,
    avatarSide TEXT,
    avatarFull TEXT,
    avatarHead TEXT,
    voiceName TEXT,
    voiceProperties TEXT,
    voiceSampleUrl TEXT
  )
`);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json({ limit: '50mb' }));

const PORT = 3000;

// WebSocket Progress Tracking
const clients = new Set<WebSocket>();

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log("Client connected to WebSocket");

  ws.on("message", (message) => {
    // Broadcast progress updates to all clients
    const data = JSON.parse(message.toString());
    if (data.type === "PROGRESS_UPDATE") {
      clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(data));
        }
      });
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log("Client disconnected from WebSocket");
  });
});

// API Routes
app.get("/api/personas", (req, res) => {
  try {
    const personas = db.prepare("SELECT * FROM personas").all() as any[];
    console.log(`API: Returning ${personas.length} personas from DB`);
    personas.forEach(p => {
      console.log(`  - ${p.name}: hasAvatarData=${!!p.avatarData} (len: ${p.avatarData?.length || 0}), hasVoice=${!!p.voiceSampleUrl}`);
    });
    res.json(personas);
  } catch (err) {
    console.error("API Error fetching personas:", err);
    res.status(500).json({ error: "Failed to fetch personas" });
  }
});

app.post("/api/personas", (req, res) => {
  try {
    const { 
      id, name, description, personality, avatarPrompt, avatarData,
      avatarFront, avatarBack, avatarSide, avatarFull, avatarHead,
      voiceName, voiceProperties, voiceSampleUrl
    } = req.body;
    
    console.log(`API: Saving persona ${name} (${id})`);
    console.log(`  - avatarData present: ${!!avatarData} (length: ${avatarData?.length || 0})`);
    console.log(`  - voiceSampleUrl present: ${!!voiceSampleUrl} (length: ${voiceSampleUrl?.length || 0})`);
    
    const upsert = db.prepare(`
      REPLACE INTO personas (
        id, name, description, personality, avatarPrompt, avatarData,
        avatarFront, avatarBack, avatarSide, avatarFull, avatarHead,
        voiceName, voiceProperties, voiceSampleUrl
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = upsert.run(
      id, name, description, personality, avatarPrompt, avatarData,
      avatarFront, avatarBack, avatarSide, avatarFull, avatarHead,
      voiceName, voiceProperties, voiceSampleUrl
    );
    
    console.log(`  - Upsert result: changes=${result.changes}, lastInsertRowid=${result.lastInsertRowid}`);
    
    res.json({ success: true });
  } catch (err) {
    console.error("API Error saving persona:", err);
    res.status(500).json({ error: "Failed to save persona" });
  }
});

// Vite middleware for development
if (process.env.NODE_ENV !== "production") {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(__dirname, "dist")));
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "dist", "index.html"));
  });
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
