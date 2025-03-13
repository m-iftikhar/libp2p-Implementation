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
import ping from 'ping' // Install via `npm install ping`
import os from 'os'

// Bootstrap peers
const bootstrapPeers = [
  '/ip4/192.168.18.65/tcp/15001/p2p/YOUR_PEER_ID', // Replace with actual Peer ID
]

const MINER_ID = `miner-${Math.floor(Math.random() * 10000)}`
const LOCATION_API = "https://ipinfo.io" // Simulated geolocation API (replace with real GPS)

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
})

await node.start()
console.log('✅ Node started with ID:', node.peerId.toString())
console.log('📡 Listening on:', node.getMultiaddrs().map(ma => ma.toString()).join('\n'))

// Function to fetch real-time location (simulated)
async function fetchRealTimeLocation() {
  try {
    const response = await fetch(`${LOCATION_API}/json`)
    const data = await response.json()
    return {
      city: data.city,
      region: data.region,
      country: data.country,
      latitude: parseFloat(data.loc.split(',')[0]),
      longitude: parseFloat(data.loc.split(',')[1]),
    }
  } catch (error) {
    console.error('❌ Failed to fetch location:', error)
    return null
  }
}

// Function to measure bandwidth (simulated)
function getBandwidth() {
  // Simulate bandwidth measurement (replace with real speed test logic)
  return Math.floor(Math.random() * 100) + 10 // Random bandwidth in Mbps
}

// Function to measure network latency (ping to a well-known server)
async function getLatency() {
  try {
    const res = await ping.promise.probe('8.8.8.8') // Google DNS
    return res.time // Latency in ms
  } catch (error) {
    console.error('❌ Failed to measure latency:', error)
    return null
  }
}

// Function to store/update miner's information in DHT
async function updateMinerStatus() {
  const location = await fetchRealTimeLocation()
  const bandwidth = getBandwidth()
  const latency = await getLatency()

  const minerInfo = JSON.stringify({
    id: MINER_ID,
    location,
    bandwidth: bandwidth + ' Mbps',
    latency: latency ? latency + ' ms' : 'N/A',
  })

  const minerKey = new TextEncoder().encode(MINER_ID)
  const minerValue = new TextEncoder().encode(minerInfo)

  // Store updated miner info in DHT
  await node.services.dht.put(minerKey, minerValue)
  console.log(`[+] Miner ${MINER_ID} status updated in DHT:`, { location, bandwidth, latency })
}

// Update miner's status every 30 seconds
setInterval(updateMinerStatus, 30000)

// Handle incoming messages (Chat)
node.handle('/chat/1.0.0', async ({ stream, connection }) => {
  try {
    const senderPeerId = connection.remotePeer.toString()

    await pipe(
      stream.source,
      async function (source) {
        for await (let chunk of source) {
          if (chunk instanceof Uint8ArrayList) {
            chunk = chunk.subarray()
          }
          
          const message = toString(chunk)
          console.log('📨 Incoming message detected')
          console.log(`💬 Received message from [${senderPeerId}]:`, message)
        }
      }
    )
  } catch (error) {
    console.error('❌ Error reading message:', error)
  }
})

// Interactive chat input
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

async function sendMessage(targetPeerId) {
  try {
    const stream = await node.dialProtocol(targetPeerId, '/chat/1.0.0')
    rl.question('Enter message: ', async (message) => {
      await pipe([fromString(message)], stream.sink)
      console.log('📨 Message sent!')
      sendMessage(targetPeerId) // Recursively ask for more messages
    })
  } catch (err) {
    console.error('❌ Failed to send message:', err)
  }
}
