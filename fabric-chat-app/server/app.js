const express = require('express');
const { Gateway, Wallets } = require('fabric-network');
const FabricCAServices = require('fabric-ca-client');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const bcrypt = require('bcryptjs');      // NEW: For hashing passwords
const jwt = require('jsonwebtoken');     // NEW: For sessions

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- CONFIGURATION ---
const CHANNEL_NAME = 'mychannel';
const CHAINCODE_NAME = 'chat-cc';
const CONNECTION_PROFILE_PATH = path.resolve(__dirname, 'connection.json');
const WALLET_PATH = path.join(process.cwd(), 'wallet');
const JWT_SECRET = 'super_secret_key_change_this_in_prod'; // Secret key for tokens
const USER_DB_PATH = path.join(process.cwd(), 'users_db.json'); // Off-chain password store

// --- HELPER: Load/Save Local User DB ---
// In a real app, use MongoDB or PostgreSQL. This is a simple JSON file for demo.
function getLocalUsers() {
    if (!fs.existsSync(USER_DB_PATH)) fs.writeFileSync(USER_DB_PATH, JSON.stringify({}));
    return JSON.parse(fs.readFileSync(USER_DB_PATH, 'utf8'));
}
function saveLocalUser(username, passwordHash) {
    const users = getLocalUsers();
    users[username] = passwordHash;
    fs.writeFileSync(USER_DB_PATH, JSON.stringify(users, null, 2));
}

// --- HELPER: Blockchain Connection ---
async function connectGateway(userId) {
    const ccp = JSON.parse(fs.readFileSync(CONNECTION_PROFILE_PATH, 'utf8'));
    const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);
    
    // Check wallet (Blockchain Identity)
    const identity = await wallet.get(userId);
    if (!identity) throw new Error(`Blockchain identity for ${userId} missing.`);

    const gateway = new Gateway();
    await gateway.connect(ccp, {
        wallet, identity: userId, discovery: { enabled: true, asLocalhost: true } 
    });
    const network = await gateway.getNetwork(CHANNEL_NAME);
    const contract = network.getContract(CHAINCODE_NAME);
    return { gateway, contract };
}

// --- MIDDLEWARE: Verify Session Token ---
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) return res.sendStatus(401); // No token

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403); // Invalid token
        req.user = user; // user object contains { username: 'Alice' }
        next();
    });
}

// --- 1. REGISTER (Blockchain + Password) ---
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const users = getLocalUsers();
        if (users[username]) return res.status(409).json({ message: 'User already exists' });

        // A. Blockchain Registration
        const ccp = JSON.parse(fs.readFileSync(CONNECTION_PROFILE_PATH, 'utf8'));
        const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);
        const adminIdentity = await wallet.get('admin');
        if (!adminIdentity) return res.status(500).json({ message: 'Admin not found' });

        const caURL = ccp.certificateAuthorities['ca.org1.example.com'].url;
        const ca = new FabricCAServices(caURL);
        const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
        const adminUser = await provider.getUserContext(adminIdentity, 'admin');

        const secret = await ca.register({ affiliation: 'org1.department1', enrollmentID: username, role: 'client' }, adminUser);
        const enrollment = await ca.enroll({ enrollmentID: username, enrollmentSecret: secret });

        const x509Identity = {
            credentials: { certificate: enrollment.certificate, privateKey: enrollment.key.toBytes() },
            mspId: 'Org1MSP', type: 'X.509',
        };
        await wallet.put(username, x509Identity);

        // B. Blockchain Phonebook Entry
        const { gateway, contract } = await connectGateway(username);
        await contract.submitTransaction('JoinUser', username);
        await gateway.disconnect();

        // C. Save Password Locally (Hashed)
        const hashedPassword = await bcrypt.hash(password, 10);
        saveLocalUser(username, hashedPassword);

        res.status(201).json({ message: 'User registered successfully' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// --- 2. LOGIN (Verify Password -> Issue Token) ---
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const users = getLocalUsers();
        const storedHash = users[username];

        if (!storedHash) return res.status(404).json({ message: 'User not found' });

        // Check Password
        if (await bcrypt.compare(password, storedHash)) {
            // Check if they actually have a wallet identity
            const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);
            if (!await wallet.get(username)) return res.status(500).json({ message: 'Wallet identity missing' });

            // Generate Token
            const token = jwt.sign({ username: username }, JWT_SECRET, { expiresIn: '24h' });
            res.json({ token: token, username: username });
        } else {
            res.status(401).json({ message: 'Incorrect password' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- 3. SESSION CHECK (For Auto-Login) ---
app.get('/api/session', authenticateToken, (req, res) => {
    res.json({ username: req.user.username });
});

// --- 4. SECURE DATA ROUTES (Protected by Token) ---
app.get('/api/users', authenticateToken, async (req, res) => {
    try {
        const { gateway, contract } = await connectGateway('admin'); 
        const result = await contract.evaluateTransaction('GetAllUsers');
        await gateway.disconnect();
        res.status(200).json(JSON.parse(result.toString()));
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/message', authenticateToken, async (req, res) => {
    try {
        // Ensure the token user matches the sender
        const { roomId, content } = req.body;
        const userId = req.user.username; 

        const { gateway, contract } = await connectGateway(userId);
        await contract.submitTransaction('CreateMessage', roomId, userId, content);
        await gateway.disconnect();
        res.status(200).json({ message: 'Sent' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/history/:roomId', authenticateToken, async (req, res) => {
    try {
        const { roomId } = req.params;
        const { gateway, contract } = await connectGateway('admin');
        const result = await contract.evaluateTransaction('GetChatHistory', roomId);
        await gateway.disconnect();
        res.status(200).json(JSON.parse(result.toString()));
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.listen(3000, () => { console.log('Secure Server running on http://localhost:3000'); });