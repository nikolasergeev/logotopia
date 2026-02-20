const express = require('express');
const http = require('http');
const { execSync } = require('child_process');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const Anthropic = require('@anthropic-ai/sdk');

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

const AI_SYSTEM_PROMPT = `You are a game world modifier for a Three.js flight simulator called Logotopia. You receive natural language requests and output ONLY executable JavaScript code. No markdown fences, no explanation, no comments — just code.

Available globals:
- scene, camera, renderer (Three.js r128)
- THREE (the Three.js library, r128)
- terrain (the terrain mesh), water (the water plane)
- airplane (player's airplane Group), walkingPilot (pilot object)
- sunLight (DirectionalLight), ambientLight (AmbientLight), hemiLight (HemisphereLight)
- sunOrb (the sun mesh), auroraGroup (aurora borealis Group), flowerGroup (Group of flowers)
- flight (object: position, quaternion, speed, throttle, boost, altitude)
- player (object: position, yaw, speed, onGround, swimming)
- controlMode ("flying" or "walking")
- state ("start", "playing", or "crashed")
- zombies (array), villagers (array), targets (array), collectibleFlowers (array), mooseList (array), bullets (array)

Creation functions:
- createAirplane() — returns airplane Group, add to scene
- createZombie() — returns zombie object, already added to scene & zombies array
- createVillager(x, z, outfitIdx) — creates villager at position
- createTarget(x, y, z) — creates ring target
- createMoose() — returns moose, already added to scene & mooseList
- createCloud(x, y, z) — creates cloud at position
- createHouse(x, z, scale, rotation) — creates house
- createMaypole(x, z) — creates maypole
- createBoat(x, z) — creates boat
- createBarn(x, z, rotation) — creates barn
- createHayBale(x, z) — creates hay bale

Spawn functions (batch spawn with default placement):
- spawnZombies(), spawnTargets(), spawnCollectibleFlowers(), spawnMoose(), spawnVillagers()

Utility:
- getTerrainHeight(x, z) — returns terrain Y at world (x, z)
- TERRAIN_SIZE = 8000, TERRAIN_HEIGHT = 300

Output ONLY executable JS. No markdown, no backticks, no explanation.`;

const app = express();

// Webhook for auto-deploy on git push
app.post('/webhook', express.json(), (req, res) => {
  // Verify signature if secret is set
  if (WEBHOOK_SECRET) {
    const sig = req.headers['x-hub-signature-256'] || '';
    const expected = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(JSON.stringify(req.body)).digest('hex');
    if (sig !== expected) return res.status(403).send('Bad signature');
  }

  // Only deploy on pushes to main
  if (req.body.ref !== 'refs/heads/main') return res.status(200).send('Ignored');

  console.log('Webhook received — deploying...');
  res.status(200).send('Deploying');

  try {
    execSync('git pull origin main && npm install --production', { cwd: __dirname, timeout: 30000 });
    console.log('Pull complete — restarting via pm2...');
    execSync('pm2 restart logotopia', { timeout: 10000 });
  } catch (e) {
    console.error('Deploy failed:', e.message);
  }
});

app.use(express.static(__dirname));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const MAX_PLAYERS = 8;
const STALE_TIMEOUT = 15000;
const players = new Map();

wss.on('connection', (ws) => {
  if (players.size >= MAX_PLAYERS) {
    ws.send(JSON.stringify({ type: 'full' }));
    ws.close();
    return;
  }

  const id = uuidv4();
  players.set(id, { ws, lastSeen: Date.now(), state: null });

  // Send welcome with assigned id
  ws.send(JSON.stringify({ type: 'welcome', id, players: getPlayerStates() }));

  // Broadcast join to others
  broadcast({ type: 'join', id }, id);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'state') {
        const p = players.get(id);
        if (p) {
          p.lastSeen = Date.now();
          p.state = msg.data;
        }
        broadcast({ type: 'state', id, data: msg.data }, id);
      } else if (msg.type === 'ai' && msg.prompt && msg.apiKey) {
        const prompt = msg.prompt.slice(0, 500);
        console.log('AI request from', id, ':', prompt);
        handleAI(id, prompt, msg.apiKey);
      } else if (msg.type === 'ai') {
        ws.send(JSON.stringify({ type: 'code_error', error: 'Missing API key or prompt', prompt: msg.prompt || '' }));
      } else if (msg.type === 'narrative' && msg.apiKey) {
        console.log('Narrative request from', id, 'for settlement', msg.name);
        handleNarrative(id, msg);
      }
    } catch (e) { console.error('WS message error:', e); }
  });

  ws.on('close', () => {
    players.delete(id);
    broadcast({ type: 'leave', id });
  });
});

function getPlayerStates() {
  const list = [];
  for (const [id, p] of players) {
    if (p.state) list.push({ id, data: p.state });
  }
  return list;
}

function broadcast(msg, excludeId) {
  const raw = JSON.stringify(msg);
  for (const [id, p] of players) {
    if (id !== excludeId && p.ws.readyState === 1) {
      p.ws.send(raw);
    }
  }
}

function broadcastAll(msg) {
  const raw = JSON.stringify(msg);
  for (const [, p] of players) {
    if (p.ws.readyState === 1) p.ws.send(raw);
  }
}

async function handleAI(authorId, prompt, apiKey) {
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      system: AI_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    let code = response.content[0].text.trim();
    // Strip markdown fences if Claude included them anyway
    if (code.startsWith('```')) {
      code = code.replace(/^```(?:javascript|js)?\n?/, '').replace(/\n?```$/, '');
    }

    broadcastAll({ type: 'code', code, prompt, author: authorId });
  } catch (e) {
    console.error('AI error:', e.message);
    // Send error only to the requesting player
    const p = players.get(authorId);
    if (p && p.ws.readyState === 1) {
      p.ws.send(JSON.stringify({ type: 'code_error', error: e.message, prompt }));
    }
  }
}

const NARRATIVE_SYSTEM_PROMPT = `You are the narrator for a living village in a Scandinavian-themed game world called Logotopia. Each day, the villagers gather at their church, and you evolve their ongoing story.

You will receive:
- A story seed (the foundational lore of this world)
- The settlement name
- A list of NPCs with their names, roles, and current moods
- Previous narrative history
- The current narrative state

Your job: Write the NEXT chapter of this settlement's story. Evolve relationships, introduce small conflicts or joys, reflect the seasons and the passage of time. Keep it grounded in the Scandinavian village setting. Each NPC should feel like they have their own inner life.

Respond with ONLY valid JSON (no markdown, no backticks):
{
  "summary": "A 1-2 sentence summary of what happened today",
  "currentNarrative": "A 2-4 paragraph narrative of today's gathering and events (max 500 words)",
  "npcUpdates": [
    { "name": "NPC_NAME", "mood": "one-word mood", "detail": "Brief note about what happened to them today" }
  ]
}

Valid moods: content, happy, excited, anxious, melancholy, angry, hopeful, tired, curious, proud, grieving, love-struck, determined, fearful, peaceful

IMPORTANT: Only update NPCs whose stories meaningfully changed. You don't need to update every NPC every day. Return 3-8 NPC updates per gathering.`;

async function handleNarrative(authorId, msg) {
  try {
    const client = new Anthropic({ apiKey: msg.apiKey });

    const userMessage = `Settlement: ${msg.name}
Story Seed: ${msg.storySeed || '(none provided)'}

NPCs present:
${(msg.npcList || []).map(n => `- ${n.name} (${n.role}, mood: ${n.mood})`).join('\n')}

Previous events:
${(msg.history || []).join('\n') || '(first gathering)'}

Current narrative:
${msg.currentNarrative || '(none yet — this is the first gathering)'}

Write the next chapter of this village's story.`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      system: NARRATIVE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    let text = response.content[0].text.trim();
    // Strip markdown fences if present
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const result = JSON.parse(text);
    broadcastAll({
      type: 'narrative_result',
      settlementId: msg.settlementId,
      result,
    });
    console.log('Narrative result for', msg.name, ':', result.summary);
  } catch (e) {
    console.error('Narrative error for', msg.name, ':', e.message);
    const p = players.get(authorId);
    if (p && p.ws.readyState === 1) {
      p.ws.send(JSON.stringify({
        type: 'narrative_error',
        settlementId: msg.settlementId,
        error: e.message,
      }));
    }
  }
}

// Stale cleanup
setInterval(() => {
  const now = Date.now();
  for (const [id, p] of players) {
    if (now - p.lastSeen > STALE_TIMEOUT) {
      p.ws.terminate();
      players.delete(id);
      broadcast({ type: 'leave', id });
    }
  }
}, 10000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Logotopia running on http://0.0.0.0:${PORT}`));
