import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { kadDHT } from '@libp2p/kad-dht';
import { identify } from '@libp2p/identify';
import { bootstrap } from '@libp2p/bootstrap';
import { pipe } from 'it-pipe';
import { toString } from 'uint8arrays/to-string';
import { fromString } from 'uint8arrays/from-string';
import { Uint8ArrayList } from 'uint8arraylist';
import readline from 'readline';
import { circuitRelayServer } from '@libp2p/circuit-relay-v2';

// Bootstrap peers
const bootstrapPeers = [
  '/ip4/192.168.18.65/tcp/15001/p2p/YOUR_PEER_ID', // Replace with actual Peer ID
];

const MINER_ID = `miner-${Math.floor(Math.random() * 10000)}`;
const LOCATION_API = 'https://ipinfo.io'; // Example API to simulate geolocation (replace with actual GPS device or real API)

const textEncoder = new TextEncoder();

// Define an object to track the active status of peers
const peerStatus = {};

// Create the libp2p node
const node = await createLibp2p({
  addresses: { listen: ['/ip4/0.0.0.0/tcp/15002'] },
  transports: [tcp()],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  services: {
    dht: kadDHT({ protocol: '/ipfs/kad/1.0.0', clientMode: false }),
    identify: identify(),
    bootstrap: bootstrap({ list: bootstrapPeers }),
    relay: circuitRelayServer({}),
  },
});

await node.start();
console.log('✅ Node started with ID:', node.peerId.toString());
console.log('📡 Listening on:', node.getMultiaddrs().map(ma => ma.toString()).join('\n'));

// Function to fetch real-time location (simulated in this case)
async function fetchRealTimeLocation() {
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

// Periodically check the status of all peers
async function checkPeerStatus() {
  const peersData = await node.services.dht.get('/peer/metadata');
  
  if (!peersData) {
    console.log('No peers data found');
    return;
  }

  const peersArray = [];
  for await (const peer of peersData) {
    peersArray.push(peer);
  }

  peersArray.forEach(peer => {
    const peerId = toString(peer.key);
    pingPeer(peerId); // Ping the peer to check if it's active
  });
}

// Function to ping a peer and update its active status
async function pingPeer(peerId) {
  try {
    const stream = await node.dialProtocol(peerId, '/ping/1.0.0');
    peerStatus[peerId] = 'active';
    console.log(`✅ Peer ${peerId} is active.`);
  } catch (error) {
    peerStatus[peerId] = 'inactive';
    console.log(`❌ Peer ${peerId} is inactive.`);
  }
}

// Update the peer selection function to only select active peers
async function selectOptimalPeer() {
  const peersData = await node.services.dht.get('/peer/metadata');
  
  if (!peersData) {
    console.log('No peers data found');
    return null;
  }

  const peerInfo = [];
  for await (const peer of peersData) {
    try {
      const parsedValue = JSON.parse(toString(peer.value));
      if (peerStatus[parsedValue.id] === 'active') {
        peerInfo.push(parsedValue);
      }
    } catch (err) {
      console.error("Failed to parse peer data:", err);
    }
  }

  const optimalPeers = peerInfo
    .filter(peer => isWithinLocationRange(peer.location, currentLocation))
    .sort((a, b) => {
      const distanceA = calculateDistance(a.location, currentLocation);
      const distanceB = calculateDistance(b.location, currentLocation);

      const latencyDiff = a.latency - b.latency;
      const bandwidthDiff = b.bandwidth - a.bandwidth;

      return distanceA - distanceB || latencyDiff || bandwidthDiff;
    });

  return optimalPeers[0]; // Return the best peer
}

function isWithinLocationRange(peerLocation, currentLocation) {
  const distance = calculateDistance(peerLocation, currentLocation);
  return distance < 1000; // Max acceptable distance in km
}

function calculateDistance(loc1, loc2) {
  const lat1 = loc1.latitude;
  const lon1 = loc1.longitude;
  const lat2 = loc2.latitude;
  const lon2 = loc2.longitude;

  const R = 6371; // Radius of Earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

// Example usage of peer selection
async function runPeerSelection() {
  await checkPeerStatus(); // Check peer status first
  const optimalPeer = await selectOptimalPeer();
  if (optimalPeer) {
    console.log('Selected optimal peer:', optimalPeer.id);
    const stream = await node.dialProtocol(optimalPeer.id, '/chat/1.0.0');
  }
}

runPeerSelection();

// Interactive chat input
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function sendMessage(targetPeerId) {
  try {
    const stream = await node.dialProtocol(targetPeerId, '/chat/1.0.0');
    rl.on('line', async (message) => {
      await pipe([fromString(message)], stream.sink);
      console.log('📨 Message sent!');
    });
  } catch (err) {
    console.error('❌ Failed to send message:', err);
  }
}
