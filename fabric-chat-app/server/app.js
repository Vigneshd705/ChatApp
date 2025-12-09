const express = require('express');
const { Gateway, Wallets } = require('fabric-network');
const FabricCAServices = require('fabric-ca-client'); // Added for dynamic registration
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// CONFIGURATION
const CHANNEL_NAME = 'mychannel';
const CHAINCODE_NAME = 'chat-cc';
const CONNECTION_PROFILE_PATH = path.resolve(__dirname, 'connection.json');
const WALLET_PATH = path.join(process.cwd(), 'wallet');

// HELPER: Connect to Gateway as a specific user
async function connectGateway(userId) {
    const ccp = JSON.parse(fs.readFileSync(CONNECTION_PROFILE_PATH, 'utf8'));
    const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);

    // Check if user exists in wallet
    const identity = await wallet.get(userId);
    if (!identity) {
        throw new Error(`User ${userId} does not exist in the wallet. Register them first.`);
    }

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

// 1. REGISTER NEW USER
app.post('/api/register', async (req, res) => {
    const { username } = req.body;
    try {
        const ccp = JSON.parse(fs.readFileSync(CONNECTION_PROFILE_PATH, 'utf8'));
        const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);

        // Check if already exists
        const userIdentity = await wallet.get(username);
        if (userIdentity) {
            return res.status(400).json({ message: `User ${username} already exists` });
        }

        // Must use Admin to register others
        const adminIdentity = await wallet.get('admin');
        if (!adminIdentity) {
            return res.status(500).json({ message: 'Admin not found. Run enrollAdmin.js first' });
        }

        // Connect to CA
        const caURL = ccp.certificateAuthorities['ca.org1.example.com'].url;
        const ca = new FabricCAServices(caURL);

        // Register and Enroll
        const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
        const adminUser = await provider.getUserContext(adminIdentity, 'admin');

        const secret = await ca.register({
            affiliation: 'org1.department1',
            enrollmentID: username,
            role: 'client'
        }, adminUser);

        const enrollment = await ca.enroll({
            enrollmentID: username,
            enrollmentSecret: secret
        });

        const x509Identity = {
            credentials: {
                certificate: enrollment.certificate,
                privateKey: enrollment.key.toBytes(),
            },
            mspId: 'Org1MSP',
            type: 'X.509',
        };
        
        await wallet.put(username, x509Identity);
        res.status(200).json({ message: `User ${username} successfully registered` });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// 2. SEND MESSAGE (Updated to use specific userId)
app.post('/api/message', async (req, res) => {
    try {
        const { userId, roomId, content } = req.body; // userId now comes from frontend
        
        const { gateway, contract } = await connectGateway(userId);
        
        console.log(`User ${userId} sending to Room ${roomId}`);
        await contract.submitTransaction('CreateMessage', roomId, userId, content);
        
        await gateway.disconnect();
        res.status(200).json({ message: 'Sent' });
        
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// 3. GET HISTORY
app.get('/api/history/:roomId', async (req, res) => {
    try {
        const { roomId } = req.params;
        // For reading, we can use the admin or a default user
        // But let's assume 'appUser' exists as a fallback reader, or use 'admin'
        const reader = 'admin'; 
        
        const { gateway, contract } = await connectGateway(reader);
        const result = await contract.evaluateTransaction('GetChatHistory', roomId);
        
        await gateway.disconnect();
        res.status(200).json(JSON.parse(result.toString()));
        
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(3000, () => {
    console.log('API Server running on http://localhost:3000');
});