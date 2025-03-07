import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { kadDHT } from '@libp2p/kad-dht'
import { bootstrap } from '@libp2p/bootstrap'
import { identify } from '@libp2p/identify'  
import { multiaddr } from '@multiformats/multiaddr' // Ensure multiaddr is used for dialing

const bootstrapNodes = [
  '/ip4/127.0.0.1/tcp/15001/p2p/QmBootstrapNodeID' // Replace with actual bootstrap node Peer ID
]

const node = await createLibp2p({
  addresses: {
    listen: ['/ip4/127.0.0.1/tcp/0']
  },
  transports: [tcp()],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  peerDiscovery: [
    bootstrap({ list: bootstrapNodes, interval: 1000 })
  ],
  services: {
    dht: kadDHT(),
    identify: identify()
  }
})

await node.start()
console.log('✅ Node started with ID:', node.peerId.toString())
console.log('📡 Listening on:\n', node.getMultiaddrs().map(ma => `   ${ma.toString()}`).join('\n'))

// Event: Peer Discovery
node.addEventListener('peer:discovery', async (evt) => {
  const peerId = evt.detail.id.toString()
  console.log('🔍 Discovered peer:', peerId)

  // Ensure the peer has valid addresses before dialing
  if (!evt.detail.multiaddrs || evt.detail.multiaddrs.length === 0) {
    console.log(`⚠️ No valid addresses found for peer ${peerId}, skipping connection.`)
    return
  }

  try {
    // Select the first valid multiaddress and attempt to connect
    const peerAddress = evt.detail.multiaddrs[0].toString()
    console.log(`🔗 Attempting to connect to peer: ${peerId} at ${peerAddress}`)
    
    await node.dial(multiaddr(peerAddress))
    console.log(`✅ Successfully connected to peer: ${peerId}`)
  } catch (error) {
    console.error(`❌ Failed to connect to peer ${peerId}:`, error)
  }
})

// Event: Peer Connected
node.addEventListener('peer:connect', (evt) => {
  console.log('✅ Connected to peer:', evt.detail.toString())
})

// Event: Peer Disconnected
node.addEventListener('peer:disconnect', (evt) => {
  console.log('❌ Disconnected from peer:', evt.detail.toString())
})
