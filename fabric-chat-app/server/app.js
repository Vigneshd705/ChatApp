const express = require('express');
const { Gateway, Wallets } = require('fabric-network');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // <--- ADD THIS LINE
// CONFIGURATION
const CHANNEL_NAME = 'mychannel';
const CHAINCODE_NAME = 'chat-cc';
const MSP_ID = 'Org1MSP';
const CONNECTION_PROFILE_PATH = path.resolve(__dirname, 'connection.json');
const WALLET_PATH = path.join(process.cwd(), 'wallet');

// HELPER: Connect to Gateway
async function connectGateway(userId) {
    const ccp = JSON.parse(fs.readFileSync(CONNECTION_PROFILE_PATH, 'utf8'));
    const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);

    const gateway = new Gateway();
    await gateway.connect(ccp, {
        wallet,
        identity: userId,
        discovery: { enabled: true, asLocalhost: true } 
    });

    const network = await gateway.getNetwork(CHANNEL_NAME);
    const contract = network.getContract(CHAINCODE_NAME);

    return { gateway, contract };
}

// ROUTE 1: Send Message
app.post('/api/message', async (req, res) => {
    try {
        const { roomId, content } = req.body;
        const userId = 'appUser'; // In prod, get this from the logged-in session
        
        const { gateway, contract } = await connectGateway(userId);

        console.log(`Submitting Transaction for user: ${userId}`);
        
        // 'CreateMessage' must match the function name in your chaincode
        await contract.submitTransaction('CreateMessage', roomId, userId, content);
        
        await gateway.disconnect();
        res.status(200).json({ message: 'Message saved to blockchain' });
        
    } catch (error) {
        console.error(`Failed to submit transaction: ${error}`);
        res.status(500).json({ error: error.message });
    }
});

// ROUTE 2: Get History
app.get('/api/history/:roomId', async (req, res) => {
    try {
        const { roomId } = req.params;
        const userId = 'appUser'; 
        
        const { gateway, contract } = await connectGateway(userId);

        const result = await contract.evaluateTransaction('GetChatHistory', roomId);
        
        await gateway.disconnect();
        res.status(200).json(JSON.parse(result.toString()));
        
    } catch (error) {
        console.error(`Failed to evaluate transaction: ${error}`);
        res.status(500).json({ error: error.message });
    }
});

app.listen(3000, () => {
    console.log('API Server running on http://localhost:3000');
});