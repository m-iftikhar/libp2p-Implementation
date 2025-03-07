import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { kadDHT } from '@libp2p/kad-dht'
import { identify } from '@libp2p/identify'
import { bootstrap } from '@libp2p/bootstrap'
import { pipe } from 'it-pipe'
import { toString } from 'uint8arrays/to-string'
import { fromString } from 'uint8arrays/from-string' 
import { Uint8ArrayList } from 'uint8arraylist'
import readline from 'readline'
import { circuitRelayServer } from '@libp2p/circuit-relay-v2'

// Bootstrap peers
const bootstrapPeers = [
  '/ip4/192.168.18.65/tcp/15001/p2p/YOUR_PEER_ID', // Replace with actual Peer ID
]

const MINER_ID = `miner-${Math.floor(Math.random() * 10000)}`
const LOCATION_API = "https://ipinfo.io" // Example API to simulate geolocation (replace with actual GPS device or real API)

const textEncoder = new TextEncoder()

// Create the libp2p node
const node = await createLibp2p({
  addresses: { listen: ['/ip4/0.0.0.0/tcp/15001'] },
  transports: [tcp()],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  services: {
    dht: kadDHT({ protocol: '/ipfs/kad/1.0.0', clientMode: false }),
    identify: identify(),
    bootstrap: bootstrap({ list: bootstrapPeers }),
    relay: circuitRelayServer({}),
  },
})

await node.start()
console.log('✅ Node started with ID:', node.peerId.toString())
console.log('📡 Listening on:', node.getMultiaddrs().map(ma => ma.toString()).join('\n'))

// Function to fetch real-time location (simulated in this case)
async function fetchRealTimeLocation() {
  // Simulate fetching location from an API or GPS (replace this with your actual method)
  const response = await fetch(`${LOCATION_API}/json`);
  const data = await response.json();
  const location = {
    city: data.city,
    region: data.region,
    country: data.country,
    loc: data.loc.split(','),
    latitude: parseFloat(data.loc.split(',')[0]),
    longitude: parseFloat(data.loc.split(',')[1]),
  };

  return location;
}

// Function to store/update miner's location in DHT
async function updateMinerLocation() {
  const location = await fetchRealTimeLocation();

  const minerInfo = JSON.stringify({
    id: MINER_ID,
    location: location,
    bandwidth: 54, // You can keep bandwidth static or dynamically update it
  });

  const minerKey = textEncoder.encode(MINER_ID);
  const minerValue = textEncoder.encode(minerInfo);

  // Update the DHT with the latest miner location
  await node.services.dht.put(minerKey, minerValue);
  console.log(`[+] Miner ${MINER_ID} location updated in DHT:`, location);
}

// Update miner's location every 30 seconds
setInterval(updateMinerLocation, 30000); // Update every 30 seconds

// Handle incoming messages (Chat)
node.handle('/chat/1.0.0', async ({ stream, connection }) => {
  try {
    const senderPeerId = connection.remotePeer.toString();

    await pipe(
      stream.source,
      async function (source) {
        for await (let chunk of source) {
          if (chunk instanceof Uint8ArrayList) {
            chunk = chunk.subarray();
          }
          
          const message = toString(chunk);
          console.log('📨 Incoming message detected');
          console.log(`💬 Received message from [${senderPeerId}]:`, message);
        }
      }
    );
  } catch (error) {
    console.error('❌ Error reading message:', error);
  }
});

// Interactive chat input
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function sendMessage(targetPeerId) {
  try {
    const stream = await node.dialProtocol(targetPeerId, '/chat/1.0.0');
    rl.question('Enter message: ', async (message) => {
      await pipe([fromString(message)], stream.sink);
      console.log('📨 Message sent!');
      sendMessage(targetPeerId); // Recursively ask for more messages
    });
  } catch (err) {
    console.error('❌ Failed to send message:', err);
  }
}
