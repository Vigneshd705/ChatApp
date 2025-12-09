'use strict';

const { Contract } = require('fabric-contract-api');

class ChatContract extends Contract {

    async initLedger(ctx) {
        // Initialize with a system user if needed, or leave empty
    }

    // --- MESSAGING FUNCTIONS ---
    async CreateMessage(ctx, roomId, userId, content) {
        const txTimestamp = ctx.stub.getTxTimestamp();
        const timestamp = new Date(txTimestamp.seconds.low * 1000).toISOString();

        const message = {
            docType: 'message',
            roomId: roomId,
            userId: userId,
            content: content,
            timestamp: timestamp
        };

        const compositeKey = ctx.stub.createCompositeKey('MSG', [roomId, timestamp]);
        await ctx.stub.putState(compositeKey, Buffer.from(JSON.stringify(message)));
        return JSON.stringify(message);
    }

    async GetChatHistory(ctx, roomId) {
        const allResults = [];
        const iteratorPromise = ctx.stub.getStateByPartialCompositeKey('MSG', [roomId]);
        let result = await iteratorPromise;
        
        while (true) {
            const res = await result.next();
            if (res.value && res.value.value.toString()) {
                allResults.push(JSON.parse(res.value.value.toString('utf8')));
            }
            if (res.done) {
                await result.close();
                break;
            }
        }
        return JSON.stringify(allResults);
    }

    // --- USER MANAGEMENT FUNCTIONS (NEW) ---
    async JoinUser(ctx, username) {
        // Create a key: USER~username
        const compositeKey = ctx.stub.createCompositeKey('USER', [username]);
        // We just store the username as the value (or a JSON profile if you want more data later)
        await ctx.stub.putState(compositeKey, Buffer.from(username));
        return `User ${username} joined.`;
    }

    async GetAllUsers(ctx) {
        const allUsers = [];
        // Get all keys starting with "USER"
        const iteratorPromise = ctx.stub.getStateByPartialCompositeKey('USER', []);
        let result = await iteratorPromise;

        while (true) {
            const res = await result.next();
            if (res.value && res.value.value.toString()) {
                // The value is just the username string
                allUsers.push(res.value.value.toString('utf8'));
            }
            if (res.done) {
                await result.close();
                break;
            }
        }
        return JSON.stringify(allUsers);
    }
}

module.exports = ChatContract;